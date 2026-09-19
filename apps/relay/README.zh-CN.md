# `@cypheria/cypheria-relay`

用于可选远程 Cypheria 连接的 Go relay 数据平面，只转发不透明的端到端加密 WebSocket frame，不保存产品 payload。

## 本地运行

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=127.0.0.1:6770
```

Single mode 在一个进程中组合 gateway 与 worker，使用内存 coordination，且只能运行一个 replica。Cluster mode 使用 `--mode=cluster --role=gateway|worker`、外部 etcd ownership metadata 与 internal mTLS。

## 验证

```sh
pnpm --filter @cypheria/cypheria-relay check
pnpm --filter @cypheria/cypheria-relay test
pnpm --filter @cypheria/cypheria-relay test:race
```

TOML 示例位于 [config](config)。Kubernetes 资源位于 [deploy/kustomize/base](deploy/kustomize/base)；其中有意不包含 etcd、public ingress、certificate issuance 或 OpenTelemetry Collector。

完整说明见 [Relay 指南](../../docs/relay.zh-CN.md)。
