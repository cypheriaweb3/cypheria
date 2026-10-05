---
title: Relay
---

# Relay

`apps/relay` 是用于远程 Cypheria 连接的可选 Go 数据平面，在客户端和用户控制的 Server 之间转发不透明的端到端加密 WebSocket frame。`@cypheria/relay` 负责两端使用的配对、channel encryption 和 transport helpers。

## 信任模型

Relay 认证路由角色并执行 admission、limits 和 backpressure，但无法解密应用流量。它不存储 Projects、Threads、Timeline、credentials 或 keys。Relay 被攻破时不应泄露明文，也不能让一个方向的 ciphertext 在反方向被接受。

经认证的 Server endpoint 创建 `ConnectionOfferV2`，其中包含 Server ID、X25519 public key 和公开 relay endpoint。完整 offer 通过带外方式传输，作为配对 capability。直接 Server Bearer token 永远不会包含其中。

## Wire 流程

公开 endpoint 为 `/ws`，relay protocol 为 `v=2`：

- Server 为其 Server ID 打开一个 control socket；
- 客户端为该 Server ID 打开 socket；
- Relay 分配 connection ID 并通知 control socket；
- Server 为该 connection 打开一个 data socket；
- 两端完成 `e2ee_hello` 与 `e2ee_ready`，随后交换加密 Cypheria frames。

Relay 校验 handshake shape 和 frame limit，但不解析明文。一个远程客户端通常占用两个长连接数据平面 socket；每个已连接 Server 另有一个 control socket。

## 加密

端点使用 X25519 key agreement 与 XSalsa20-Poly1305 authenticated encryption。区分域的 client-to-Server 和 Server-to-client subkeys 防止反射。每个加密 bundle 包含 24-byte nonce、ciphertext 和 16-byte authenticator。

Channel 会拒绝全零 shared secret、不同 key 的重复 hello、无效认证、重放 nonce、明文应用 frame 和无界握手前缓冲。`e2ee_hello` 与 `e2ee_ready` 仍是小型 JSON 文本握手 frame；所有加密 Cypheria 应用 frame 都使用二进制，并承载 CBOR 明文。不再协商 ciphertext 格式。

## 单进程模式

```sh
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single --public-addr=127.0.0.1:6770
```

Single mode 在一个进程中运行 gateway、worker hub 和内存 coordination，不使用 etcd，也不打开 internal listener。只能部署一个 replica；负载均衡器后的多个独立 replica 可能把 Server control socket 与客户端分离。

该模式适合本地开发，以及可接受单一故障域和重连停机的小型部署。

## 集群模式

```text
公开客户端与 Servers -> gateway replicas -> mTLS -> worker replicas
                                      \-> 外部 etcd coordination
```

Cluster mode 要求每个进程只选择一个 role：

- gateway 接受公开 WebSocket，在 etcd 解析 ownership，并通过 mTLS 代理到 worker；
- worker 注册带 lease 的稳定 node identity，拥有 socket pair 并转发 frame。

etcd 只保存区域 ownership metadata。Node 和 owner record 使用 lease；worker 无法续租时会 self-fence。没有有效 owner 时使用 rendezvous hashing 选择 live owner。Payload 和 pairing secret 永远不会进入 etcd。

## 配置与部署

TOML 示例位于 `apps/relay/config`，环境变量可覆盖部署值。`apps/relay/deploy/kustomize/base` 的 Kubernetes Kustomize 资源提供 gateway 与 worker deployments、services、probes、topology spreading、resources 和 disruption budgets。

Base 有意不安装 etcd、OpenTelemetry Collector、certificate issuance 或 public ingress。生产 overlay 必须固定不可变 image，提供区域 etcd 与 internal mTLS credentials，只为 gateway 配置 TLS WebSocket ingress，并保持 worker 私有。

不使用 Kubernetes 时，应在 process supervisor 下运行静态 binary 或 container，使用非特权账户、只读安装、充足 file descriptors、restart policy，以及至少 45 秒 graceful-stop window。

## 容量与 backpressure

Gateway 按 admission 与新连接速率扩容。Worker 按 active sockets、memory、ingress/egress bytes、queue pressure 和 slow-peer disconnect 扩容。CPU 不能单独作为 worker autoscaling 指标，因为 scale-in 会丢弃所属 socket，并依赖端点重连。

每个连接的 queue 和 frame size 都有上限。慢速或停滞 peer 会被断开，不能让单个连接耗尽进程内存。

## 可观测性

两种 role 都提供 health 与 readiness，并可通过 OTLP/gRPC 导出 OpenTelemetry 数据。必需信号包括 accepted/rejected connections、active control/client/data sockets、handshake failures、queue depth、dropped frames、forwarded bytes、etcd lease health、ownership moves、proxy failures 和 graceful-shutdown progress。

Telemetry 不得包含 pairing offer、超出必要 fingerprint 的 public key、ciphertext body、Server token 或应用 payload。

## 验证

```sh
pnpm --filter @cypheria/cypheria-relay check
pnpm --filter @cypheria/cypheria-relay test
pnpm --filter @cypheria/cypheria-relay test:race
```

协议与加密测试也位于 `@cypheria/relay` 和 Server relay integration tests 中。
