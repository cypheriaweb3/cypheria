# @cypheria/cypheria-relay

Cypheria relay 的 Go 实现。本地运行：

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=0.0.0.0:6770
```

`single` 模式让 gateway、worker 和内存 coordinator 共存于一个进程，不使用 etcd 和内部
listener，但必须只运行一个副本。集群部署使用 `--mode=cluster --role=gateway|worker`，并要求
etcd 和内部 mTLS。

TOML 示例位于 [config](config)，Kubernetes Kustomize 资源位于
[deploy/kustomize/base](deploy/kustomize/base)；这些清单刻意不部署 etcd 或 OpenTelemetry
Collector。

使用 `pnpm --filter @cypheria/cypheria-relay check` 检查，使用
`pnpm --filter @cypheria/cypheria-relay test:race` 运行竞态检测。协议、配置、部署拓扑、容量、可观测性与地域设计参见
[../../docs/relay.zh-CN.md](../../docs/relay.zh-CN.md)。
