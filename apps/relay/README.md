# `@cypheria/cypheria-relay`

> Status: Current implementation

The Go relay data plane for optional remote Cypheria connections. It forwards opaque end-to-end encrypted WebSocket frames and stores no product payloads.

## Run locally

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=127.0.0.1:6770
```

Single mode combines gateway and worker in one process, uses in-memory coordination, and must run as exactly one replica. Cluster mode uses `--mode=cluster --role=gateway|worker`, external etcd for ownership metadata, and internal mTLS.

## Verify

```sh
pnpm --filter @cypheria/cypheria-relay check
pnpm --filter @cypheria/cypheria-relay test
pnpm --filter @cypheria/cypheria-relay test:race
```

TOML examples are in [config](config). Kubernetes resources are in [deploy/kustomize/base](deploy/kustomize/base); they intentionally omit etcd, public ingress, certificate issuance, and the OpenTelemetry Collector.

See the complete [Relay guide](../../docs/relay.md).
