# @cypheria/cypheria-relay

The Go implementation of the Cypheria relay. Run locally with:

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=0.0.0.0:6770
```

In `single` mode, gateway and worker share one process and an in-memory coordinator; etcd and the
internal listener are not used. Run exactly one replica. Cluster deployments use
`--mode=cluster --role=gateway|worker` and require etcd and internal mTLS.

TOML examples are in [config](config). Kubernetes Kustomize resources are in
[deploy/kustomize/base](deploy/kustomize/base); they intentionally do not deploy etcd or an
OpenTelemetry Collector.

Run checks with `pnpm --filter @cypheria/cypheria-relay check` and the race detector with
`pnpm --filter @cypheria/cypheria-relay test:race`. See
[../../docs/relay.md](../../docs/relay.md) for protocol, configuration, topology, capacity,
observability, and regional design.
