# Cypheria Server

`apps/server` 是 Cypheria client 与本地特权能力之间的进程边界。它复用了 Paseo daemon 中有价值的结构：稳定 supervisor、可替换 worker、显式 session handshake、health 与 diagnostics、PID ownership、crash recovery 和 graceful lifecycle control，同时以 Hono 替代 Express。

当前运行中的基础 server 仍不分发 agent、project、wallet、policy 或 automation 产品 service。它只托管一个裸 `CypheriaRuntime`；runtime 内置的 `runtime.info`、`runtime.health` 与 `runtime.services` 足以验证 transport。`@cypheria/protocol` 现在已经在 `agent.codex.*` 下预留完整 Codex App Server API；server 侧 Codex dispatch 仍是独立的后续实现步骤。

## 进程模型

```txt
cypheria-server CLI
  -> supervisor process
       -> 持有 $CYPHERIA_HOME/config/server.pid
       -> 监控 heartbeat 与 restart budget
       -> worker process
            -> Hono HTTP server
            -> WebSocket session registry
            -> CypheriaRuntime lifecycle
            -> 内置 Expo web application
```

Supervisor 会在显式 restart 或意外 failure 后重启 worker，采用有界指数退避；一分钟内失败五次后停止；worker 忽略 shutdown 时会被强制终止。Worker 每五秒发送 heartbeat。进程日志追加到 `$CYPHERIA_HOME/logs/server.log`；稳定 server identity 以仅 owner 可访问的权限保存在 `$CYPHERIA_HOME/config/server-id`。

Server CLI 支持：

```sh
cypheria-server start
cypheria-server start --foreground
cypheria-server status
cypheria-server restart
cypheria-server stop
```

## Client Protocol

`@cypheria/protocol` 持有 Cypheria wire protocol 与 generated Codex App Server 产物。Codex DTO 不会手写：TypeScript、JSON Schema、response mapping、validator 与提交到仓库的 dotted API registry 都在本 package 中统一生成或派生。`@cypheria/codex-bridge` 只消费专用 protocol subpath。所有 HTTP 与 WebSocket boundary value 都使用 Zod 或 generated Codex JSON Schema 校验。

WebSocket client 使用 `cypheria.v1` subprotocol 连接 `/api/v1/ws`。第一条消息必须是 `session.hello`，包含 protocol version、client identity、client kind 与 capabilities。Server 返回 `session.ready` 和稳定 session ID。每个 request 都带 caller 提供的 request ID；runtime event 广播不带 request ID。

基础消息如下：

| Client message | Server result | 用途 |
| --- | --- | --- |
| `session.hello` | `session.ready` | 协商 protocol 与 client metadata |
| `server.ping` | `server.pong` | Liveness 与 latency timestamps |
| `server.info` | `server.info.result` | Identity、version、runtime state 与 connection count |
| `server.diagnostics` | `server.diagnostics.result` | Process、memory、connection 与 runtime diagnostics |
| `runtime.request` | `runtime.response` | 转发经过校验的 runtime method |
| `server.restart` / `server.shutdown` | `server.lifecycle.accepted` | 请求 supervised lifecycle action |
| `session.goodbye` | connection close | Client graceful disconnect |

无效消息返回 `server.error`。Server 会拒绝 binary frame、重复的 in-flight request ID、不兼容 protocol version、超大消息，以及未在 deadline 内发送 hello 的 session。Transport-level ping/pong heartbeat 会终止 stale socket，避免运维 connection registry 无限保留已失效 client。

### Codex agent API 命名

完整 Codex App Server surface 使用新的 Cypheria dotted name，并进入 live client/server union：

```txt
agent.codex.<operation>.request
agent.codex.<operation>.response
agent.codex.<operation>.notification
```

上游 slash separator 转成 dot，camel-case segment 转成 snake case。例如：

```txt
thread/start                 -> agent.codex.thread.start.request
thread/memoryMode/set        -> agent.codex.thread.memory_mode.set.request
threadSection/list           -> agent.codex.thread_section.list.request
getConversationSummary      -> agent.codex.get_conversation_summary.request
```

普通 RPC 由 client 发送 `{ type, requestId, ...params }`，server 返回 `{ type, payload: { requestId, ...result } }`。这遵循 Paseo 当前约定：request field 位于消息顶层，带关联信息的 response field 位于 `payload`。审批等 App Server 发起的反向 RPC 则由 server 发送 request、具备对应能力的 client 返回 response。Server notification 把上游 notification params 直接放入 `payload`；App Server 的 `initialized` client notification 不带 payload。

生成的 registry 覆盖 158 个 client-initiated RPC、11 个 server-initiated RPC、83 个 server notification 与 1 个 client notification，同时记录每项上游 Params/Response type name 和反向 wire-name lookup。Protocol build、typecheck 和 test 之前都会执行生成一致性检查，因此 Codex 升级后不会无提示地让公共 Cypheria API catalog 漂移。

## HTTP 运维接口

| Method | Path | 认证 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | 无 | Process liveness |
| `GET` | `/api/v1/ready` | 无 | Runtime/listener readiness |
| `GET` | `/api/v1/status` | 配置时使用 Bearer | Server information |
| `GET` | `/api/v1/diagnostics` | 配置时使用 Bearer | Operational diagnostics |
| `POST` | `/api/v1/runtime/request` | 配置时使用 Bearer | Runtime request forwarding |
| `POST` | `/api/v1/lifecycle/restart` | 配置时使用 Bearer | Supervised worker restart |
| `POST` | `/api/v1/lifecycle/shutdown` | 配置时使用 Bearer | 关闭整个 daemon |

API route 不会落入 SPA fallback。Request body 与 runtime method namespace 都有边界并经过校验。

## 安全默认值

默认 listener 是 `127.0.0.1:6768`。未配置 `CYPHERIA_SERVER_TOKEN` 时，绑定任何非 loopback 地址都会被拒绝。HTTP 使用 `Authorization: Bearer <token>`。浏览器 WebSocket API 不能设置 authorization header，因此 browser-compatible client 用 `cypheria.bearer.<token>` subprotocol 携带同一个 token。

没有 `Origin` header 的 native client 可以连接。Browser WebSocket 默认只允许 same-origin。Cross-origin HTTP 与 WebSocket 必须通过 `CYPHERIA_SERVER_ALLOWED_ORIGINS` 显式加入 allowlist。Token 不接受 URL 传递，Expo bundle 也不会把 server token 编译进公共 client code。

配置变量：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | Listener address |
| `CYPHERIA_SERVER_PORT` | `6768` | Listener port；`0` 选择临时端口 |
| `CYPHERIA_SERVER_TOKEN` | 未设置 | 共享运维 credential；非 loopback 必填 |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | 未设置 | 逗号分隔的 cross-origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body 与 WebSocket frame 上限 |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello deadline |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | HTTP graceful-shutdown deadline |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | 启用内置 Expo web hosting |
| `CYPHERIA_SERVER_WEB_DIR` | 内置 `dist/web` | 覆盖 static directory |

TLS termination 刻意放在 Node process 外。任何非 loopback 部署除了认证与显式 origin allowlist，还应把 server 放在可信 TLS reverse proxy 后。

## Expo 打包

`apps/expo` 使用 Expo SDK 57 与 Expo Router，启用 React Native new architecture 和 React Compiler。一套 source tree 面向 iOS、Android 与 web。Web 使用 static output：

```sh
pnpm --filter @cypheria/expo build
```

Server 将 Expo 声明为 workspace build dependency。Server build 使用 tsdown 打包 Node entrypoint，移除旧的 embedded web directory，并把准确的 Expo `dist` output 复制到 `apps/server/dist/web`：

```sh
pnpm --filter @cypheria/server... build
```

Hono 先提供真实 asset，再为 client route fallback 到 `index.html`。HTML 不缓存；带 fingerprint 的静态 asset 使用 immutable cache。`/api/*` 始终是严格 JSON namespace。

Expo client 按以下规则选择 server：

- Web production 使用页面的 same origin。
- `EXPO_PUBLIC_CYPHERIA_SERVER_URL` 可覆盖 server URL，但不携带 credential。
- Native development 默认使用 `ws://127.0.0.1:6768/api/v1/ws`；Android emulator 或真机开发应设置设备可访问的地址。

## Desktop 迁移边界

本次没有修改 `apps/desktop`。它仍与此前完全一致，在 Electron main 中启动 `CypheriaRuntime` 与 Codex App Server。等这个 server 通过评审后，可在独立变更中让 desktop 成为 Cypheria protocol client，并让 Electron main 承担“确保本地 server 正在运行”的特殊职责。迁移必须保留 Electron-only dApp `WebContents`、preload、secure storage、OS integration 与 approval UI 边界，不能过早移动这些能力。
