package telemetry

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
)

type Shutdown func(context.Context) error

func Setup(ctx context.Context, endpoint string) (Shutdown, error) {
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName("cypheria-relay"),
	))
	if err != nil {
		return nil, err
	}
	traceExporter, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpointURL(endpoint))
	if err != nil {
		return nil, err
	}
	metricExporter, err := otlpmetricgrpc.New(ctx, otlpmetricgrpc.WithEndpointURL(endpoint))
	if err != nil {
		_ = traceExporter.Shutdown(ctx)
		return nil, err
	}
	tracerProvider := trace.NewTracerProvider(trace.WithBatcher(traceExporter), trace.WithResource(res))
	meterProvider := metric.NewMeterProvider(
		metric.WithReader(metric.NewPeriodicReader(metricExporter, metric.WithInterval(15*time.Second))),
		metric.WithResource(res),
	)
	otel.SetTracerProvider(tracerProvider)
	otel.SetMeterProvider(meterProvider)
	return func(shutdownContext context.Context) error {
		return errors.Join(meterProvider.Shutdown(shutdownContext), tracerProvider.Shutdown(shutdownContext))
	}, nil
}
