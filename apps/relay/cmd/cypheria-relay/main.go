package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/KimMachineGun/automemlimit/memlimit"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/config"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/coordinator"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/relay"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/telemetry"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/tlsconfig"
)

func main() {
	if err := run(); err != nil {
		slog.Error("cypheria relay stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	_, _ = memlimit.Set(memlimit.WithRatio(0.9))
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	settings, err := config.Parse(os.Args[1:], os.Getenv)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	shutdownTelemetry, err := telemetry.Setup(ctx, settings.OTLPEndpoint)
	if err != nil {
		return err
	}
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	var serverTLS, clientTLS *tls.Config
	if !settings.Single() {
		serverTLS, clientTLS, err = tlsconfig.Load(settings.InternalCAFile, settings.InternalCertFile, settings.InternalKeyFile)
		if err != nil {
			return err
		}
	}
	var hub *relay.Hub
	if settings.ServesWorker() {
		hub = relay.NewHub(logger, settings.MaxDataBytes, settings.MaxControlBytes, settings.IngressBudgetBytes, settings.AttachTimeout, settings.DeliveryTimeout, settings.TransportTimeout)
	}
	localNode := coordinator.Node{ID: settings.NodeID, Internal: settings.AdvertiseInternal}
	var coord coordinator.Coordinator
	if settings.Single() {
		coord = coordinator.NewMemory(localNode)
		logger.Warn("single relay topology enabled", "mode", settings.Mode, "requiredReplicas", 1)
	} else {
		var registeredNode *coordinator.Node
		if settings.Role == config.RoleWorker {
			registeredNode = &localNode
		}
		coord, err = coordinator.NewEtcd(ctx, settings.EtcdEndpoints, registeredNode, clientTLS)
		if err != nil {
			return err
		}
	}
	proxyTLS := clientTLS
	if clientTLS != nil && settings.InternalServerName != "" {
		proxyTLS = clientTLS.Clone()
		proxyTLS.ServerName = settings.InternalServerName
	}
	service, err := relay.NewService(relay.Components{Gateway: settings.ServesGateway(), Worker: settings.ServesWorker()}, settings.NodeID, hub, coord, logger, proxyTLS)
	if err != nil {
		return err
	}

	publicServer := &http.Server{Addr: settings.PublicAddr, Handler: service.PublicHandler(), ReadHeaderTimeout: 5 * time.Second}
	errChannel := make(chan error, 2)
	go func() {
		logger.Info("relay public listener started", "address", settings.PublicAddr, "mode", settings.Mode, "role", settings.Role)
		errChannel <- publicServer.ListenAndServe()
	}()

	var internalServer *http.Server
	if settings.Mode == config.ModeCluster && settings.Role == config.RoleWorker {
		internalServer = &http.Server{Addr: settings.InternalAddr, Handler: service.InternalHandler(), ReadHeaderTimeout: 5 * time.Second, TLSConfig: serverTLS}
		go func() {
			logger.Info("relay internal mTLS listener started", "address", settings.InternalAddr)
			errChannel <- internalServer.ListenAndServeTLS("", "")
		}()
	}

	select {
	case <-ctx.Done():
	case <-coord.Healthy():
		err = errors.New("relay coordinator lease was lost; node fenced")
		cancel()
	case err = <-errChannel:
		if !errors.Is(err, http.ErrServerClosed) {
			cancel()
		}
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	shutdownErrors := []error{publicServer.Shutdown(shutdownCtx), service.Shutdown(shutdownCtx)}
	if internalServer != nil {
		shutdownErrors = append(shutdownErrors, internalServer.Shutdown(shutdownCtx))
	}
	return errors.Join(shutdownErrors...)
}
