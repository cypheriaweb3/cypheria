package relay

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/cypheriaweb3/cypheria/apps/relay/internal/coordinator"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/time/rate"
)

type Service struct {
	components  Components
	nodeID      string
	coordinator coordinator.Coordinator
	hub         *Hub
	logger      *slog.Logger
	proxyClient *http.Transport
	tracer      trace.Tracer
	connections metric.Int64Counter
	rejections  metric.Int64Counter
	limitersMu  sync.Mutex
	limiters    map[string]*admissionLimiter
}

type Components struct {
	Gateway bool
	Worker  bool
}

type admissionLimiter struct {
	lastSeen time.Time
	limiter  *rate.Limiter
}

func NewService(components Components, nodeID string, hub *Hub, coord coordinator.Coordinator, logger *slog.Logger, clientTLS *tls.Config) (*Service, error) {
	if !components.Gateway && !components.Worker {
		return nil, fmt.Errorf("relay service must enable a gateway or worker component")
	}
	if components.Worker && hub == nil {
		return nil, fmt.Errorf("relay worker component requires a hub")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = clientTLS
	meter := otel.Meter("github.com/cypheriaweb3/cypheria/apps/relay")
	connections, err := meter.Int64Counter("cypheria.relay.connections")
	if err != nil {
		return nil, err
	}
	rejections, err := meter.Int64Counter("cypheria.relay.rejections")
	if err != nil {
		return nil, err
	}
	if hub != nil {
		_, err = meter.Int64ObservableGauge(
			"cypheria.relay.active_connections",
			metric.WithInt64Callback(func(_ context.Context, observer metric.Int64Observer) error {
				observer.Observe(hub.Stats().Active)
				return nil
			}),
		)
		if err != nil {
			return nil, err
		}
	}
	return &Service{
		components: components, nodeID: nodeID, coordinator: coord, hub: hub, logger: logger,
		proxyClient: transport, tracer: otel.Tracer("cypheria-relay"),
		connections: connections, rejections: rejections,
		limiters: make(map[string]*admissionLimiter),
	}, nil
}

func (s *Service) PublicHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /readyz", s.ready)
	if s.components.Gateway {
		mux.HandleFunc("GET /ws", s.route)
	}
	return mux
}

func (s *Service) InternalHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /readyz", s.ready)
	if s.components.Worker {
		mux.HandleFunc("GET /internal/ws", s.hub.ServeWS)
	}
	return mux
}

func (s *Service) ready(response http.ResponseWriter, _ *http.Request) {
	select {
	case <-s.coordinator.Healthy():
		http.Error(response, "relay node is fenced", http.StatusServiceUnavailable)
	default:
		response.WriteHeader(http.StatusNoContent)
	}
}

func (s *Service) route(response http.ResponseWriter, request *http.Request) {
	select {
	case <-s.coordinator.Healthy():
		http.Error(response, "relay node is fenced", http.StatusServiceUnavailable)
		return
	default:
	}
	if !s.allow(request.RemoteAddr) {
		s.rejections.Add(request.Context(), 1, metric.WithAttributes(attribute.String("reason", "rate_limited")))
		http.Error(response, "relay admission rate exceeded", http.StatusTooManyRequests)
		return
	}
	serverID := strings.TrimSpace(request.URL.Query().Get("serverId"))
	if serverID == "" {
		s.rejections.Add(request.Context(), 1, metric.WithAttributes(attribute.String("reason", "invalid_attachment")))
		http.Error(response, "serverId is required", http.StatusBadRequest)
		return
	}
	ctx, span := s.tracer.Start(request.Context(), "relay.route", trace.WithSpanKind(trace.SpanKindServer))
	node, err := s.coordinator.Route(ctx, coordinator.ServerKey(serverID))
	if err != nil {
		s.rejections.Add(ctx, 1, metric.WithAttributes(attribute.String("reason", "no_worker")))
		span.End()
		http.Error(response, "no relay worker is available", http.StatusServiceUnavailable)
		return
	}
	span.SetAttributes(attribute.Bool("relay.local", node.ID == s.nodeID))
	span.End()
	if node.ID == s.nodeID && s.hub != nil {
		s.connections.Add(ctx, 1, metric.WithAttributes(attribute.String("route", "local")))
		s.hub.ServeWS(response, request)
		return
	}
	if node.Internal == "" {
		http.Error(response, "relay owner has no internal address", http.StatusServiceUnavailable)
		return
	}
	s.connections.Add(ctx, 1, metric.WithAttributes(attribute.String("route", "proxy")))
	s.proxy(node, response, request)
}

func (s *Service) allow(remoteAddress string) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	now := time.Now()
	s.limitersMu.Lock()
	defer s.limitersMu.Unlock()
	entry := s.limiters[host]
	if entry == nil {
		entry = &admissionLimiter{lastSeen: now, limiter: rate.NewLimiter(20, 40)}
		s.limiters[host] = entry
	}
	entry.lastSeen = now
	if len(s.limiters) > 4096 {
		cutoff := now.Add(-5 * time.Minute)
		for key, candidate := range s.limiters {
			if candidate.lastSeen.Before(cutoff) {
				delete(s.limiters, key)
			}
		}
	}
	return entry.limiter.Allow()
}

func (s *Service) proxy(node coordinator.Node, response http.ResponseWriter, request *http.Request) {
	target, err := url.Parse(node.Internal)
	if err != nil {
		http.Error(response, "relay owner address is invalid", http.StatusServiceUnavailable)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = s.proxyClient
	originalDirector := proxy.Director
	proxy.Director = func(outgoing *http.Request) {
		originalDirector(outgoing)
		outgoing.URL.Path = "/internal/ws"
		outgoing.Host = target.Host
		outgoing.Header.Set("X-Cypheria-Relay-Internal", "1")
	}
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, proxyErr error) {
		s.logger.Warn("relay internal proxy failed", "error", proxyErr, "worker", node.ID)
		http.Error(writer, "relay worker unavailable", http.StatusServiceUnavailable)
	}
	proxy.ServeHTTP(response, request)
}

func (s *Service) Shutdown(ctx context.Context) error {
	if err := s.coordinator.Close(); err != nil {
		return fmt.Errorf("close coordinator: %w", err)
	}
	return nil
}
