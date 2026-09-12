package relay

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cypheriaweb3/cypheria/apps/relay/internal/coordinator"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestServiceExportsOTelMetricsWithoutPrometheusEndpoint(t *testing.T) {
	previous := otel.GetMeterProvider()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	otel.SetMeterProvider(provider)
	defer func() {
		otel.SetMeterProvider(previous)
		_ = provider.Shutdown(context.Background())
	}()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, 1024, 1024, 4096, time.Second, time.Second, time.Second)
	service, err := NewService(Components{Gateway: true, Worker: true}, "test", hub, coordinator.NewMemory(coordinator.Node{ID: "test"}), logger, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	service.PublicHandler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
	var metrics metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &metrics); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, scope := range metrics.ScopeMetrics {
		for _, item := range scope.Metrics {
			if item.Name == "cypheria.relay.rejections" {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("relay rejection metric was not exported through OpenTelemetry")
	}
}
