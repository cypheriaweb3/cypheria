# Cypheria Server

`apps/server` 是 Cypheria client 与本地特权能力之间的进程边界。它复用了 Paseo 中有价值的进程结构：稳定 supervisor、可替换 worker、显式 session handshake、health 与 diagnostics、PID ownership、crash recovery 和 graceful lifecycle control；Cypheria 对进程与 API 统一使用 server 命名，并以 Hono 替代 Express。

Server 持有基于 SQLite 的 project、thread、section、timeline 与 Schedule services。它在接收连接前初始化固定 pinned section 并恢复持久 schedules，随后分派相应的版本化 logical-session message。Server 同时托管 `CypheriaRuntime` 与下文所述的 Agent surface；wallet、policy 与 browser service 在从 Desktop 搬出前仍属于分阶段实施工作。

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

Supervisor 会在显式 restart 或意外 failure 后重启 worker，采用有界指数退避；一分钟内失败五次后停止；graceful shutdown 超时后会终止 worker 进程组。Liveness 是双向的：worker heartbeat 让 supervisor 发现卡死的 worker；每秒一次的 supervisor heartbeat 加上 parent/IPC 检查，则保证 supervisor 消失后 worker 不会作为孤儿进程继续运行。进程日志追加到 `$CYPHERIA_HOME/logs/server.log`；稳定 server identity 以仅 owner 可访问的权限保存在 `$CYPHERIA_HOME/config/server-id`。

Server CLI 支持：

```sh
cypheria-server start
cypheria-server start --foreground
cypheria-server status
cypheria-server restart
cypheria-server stop
```

## Client Protocol

`@cypheria/protocol` 持有 Cypheria wire protocol 与 generated Codex App Server 产物。Codex DTO 不会手写：TypeScript、JSON Schema、response mapping、validator 与提交到仓库的 dotted API registry 都在本 package 中统一生成或派生。Codex-generated TypeScript 继续作为 compile-time source of truth；固定版本的 Hey API generation 把 Codex JSON Schema definitions 转换为提交到仓库的静态 Zod 4 validators。the Server Codex adapter 只消费专用 protocol subpath。所有 HTTP 与 WebSocket boundary value 都使用 Zod 校验。

`@cypheria/client` 是该 contract 的可复用 consumer。其内部 `ServerClient` 持有 transport、WebSocket session、请求关联、订阅、超时处理与重连策略；`createCypheriaApi()` 暴露不带连接控制权的借用能力门面；`createCypheriaClient()` 创建持有 connection lifecycle 的门面。公开 API 暴露 provider-neutral 的 `agent`、`thread`、`projectThread` 与 `server` action；provider runtime 与 session 由 server 持有。

WebSocket client 继续使用现有的 `cypheria.v2` subprotocol 连接 `/api/v1/ws`。Wire format 采用 Paseo 的两层结构：WebSocket 顶层消息只有 `hello`、`ping`、`pong` 与 `session`；Agent、Thread、project/section 与 server operation 都是逻辑 session 消息，通过 `{ type: "session", message }` 承载。除 `ping` 外，client 的第一条消息必须是顶层 `hello`，其中包含 protocol version、client identity、client type、可选 app version 和可选的 transport capabilities。支持的 client type 是 `desktop`、`mobile`、`web`、`cli`、`mcp` 与 `hub`。不再有 `session.ready`；server 通过逻辑 `server.status.notification` 消息确认挂接。

内存 registry 以 authenticated principal 和 `clientId` 作为逻辑 session key。当前直连 token 与 relay pairing 的 admission 都解析为单一本地 owner principal。同一个逻辑 session 可以同时挂接多条物理 WebSocket 或解密后的 relay channel。有关联的 response 只返回来源 transport，status broadcast则发给全部已挂接 transport。只有最后一条 transport 离开后才开始 reconnect grace period；同一 authenticated principal 与 `clientId` 重连时会自动恢复逻辑 session，不存在公开 session ID、resume token 或 `session.goodbye` 消息。Client close 只关闭自身物理 transport。Worker 重启后不会保留逻辑 session。

基础消息如下：

| 层级 / Client message | Server result | 用途 |
| --- | --- | --- |
| WebSocket `hello` | session `server.status.notification` | 挂接 transport 并声明 peer metadata |
| WebSocket `ping` | WebSocket `pong` | Transport liveness |
| `server.status.request` | `server.status.response` | Identity、version、runtime state 与 connection count |
| `server.diagnostics.request` | `server.diagnostics.response` | Process、memory、connection 与 runtime diagnostics |
| `server.config.get.request` | `server.config.get.response` | 读取 server desired config |
| `server.config.patch.request` | `server.config.patch.response` | 持久化部分 server desired config |
| `server.config.reload.request` | `server.config.reload.response` | 从磁盘重新加载 server desired config |

表中未标注 WebSocket 的行都是逻辑 session 消息，因此会放在顶层 `session` envelope 内传输。发送无效或不支持的逻辑消息会导致连接关闭。Server 会拒绝 binary frame、同一来源 transport 上重复的 in-flight request ID、不兼容 protocol version、超大消息，以及未在 deadline 内发送 hello 的连接。RFC 6455 heartbeat 也会终止 stale direct socket，避免 operational registry 无限期保留 dead client。

### 内部 provider adapter contract

完整 Codex App Server surface 作为内部 validated adapter catalog 使用 Cypheria dotted name，不进入 live public client/server union：

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

普通 RPC 的内层逻辑消息由 client 发送 `{ type, requestId, ...params }`，server 的内层响应为 `{ type, payload: { requestId, ...result } }`；两个方向都再由顶层 `session` envelope 包装。这遵循 Paseo 当前约定：request field 位于消息顶层，带关联信息的 response field 位于 `payload`。审批等 App Server 发起的反向 RPC 则由 server 发送 request、具备对应能力的 client 返回 response。Server notification 把上游 notification params 直接放入 `payload`；App Server 的 `initialized` client notification 不带 payload。

生成的 registry 覆盖 158 个 client-initiated RPC、11 个 server-initiated RPC、83 个 server notification 与 1 个 client notification，同时记录每项上游 Params/Response type name 和反向 wire-name lookup。Protocol build、typecheck 和 test 之前都会执行生成一致性检查，因此 Codex 升级后不会无提示地让公共 Cypheria API catalog 漂移。

### ACP agent 消息

ACP traffic 会先规范化成可直接判别的逻辑 session 消息，再进入顶层 `session` envelope。规范化 method 与方向暴露在 `type` 中；稳定 v1 与 draft v2 则由数字 `protocolVersion` discriminator 选择：

```ts
{
  type: "agent.acp.session.new.request"
  protocolVersion: 1
  requestId: 7
  cwd: "/workspace"
}

{
  type: "agent.acp.session.new.response"
  protocolVersion: 1
  payload: { requestId: 7; result: { sessionId: "session-1" } }
}
```

已知 request 将 method params 与 `type`、`protocolVersion`、`requestId` 平铺；notification 将 method params 放在 `payload`；response 在 `payload` 中携带 `requestId`，以及 `result` 或 `error` 中恰好一个。每个已知 params/result 都返回其官方 SDK validator 生成的规范形式。Extension method 使用 `agent.acp.extension.request|response|notification`，要求 `method` 以 underscore 开头，并把该 method 与可选 `params` 嵌套在 `payload` 中。协议取消使用 `agent.acp.cancel_request.notification`，且必须携带 request ID payload。

ACP v2 batch 使用带 `protocolVersion: 2` 的专用 `agent.acp.batch` type，并把非空逻辑消息放在 `payload.messages`。该数组自身使用基于 `type` 的嵌套 discriminated union。call 与 response entry 不得混合，initialize request 与 response 都必须是 batch 中唯一的 entry，v1 则没有 batch message。Session schema 先按 `type` 嵌套 ACP family，ACP family 再按 `protocolVersion` 判别，随后由各版本自己的 `type` discriminator 分派。

生成 catalog 来自官方 SDK handler declaration，并在 protocol build、test 与 typecheck 前检查。它目前覆盖 v1/v2 共 51 组 RPC 与 22 个 notification。每个已知 request、response 和 notification 都使用相应 SDK-generated method-specific Zod schema。Client adapter 会还原 SDK 的原始 JSON-RPC stream，并在 SDK response 需要恢复逻辑 response type 时使用 connection-local request-ID correlation。

SDK 1.4.0 发布了这些 generated Zod module，但没有通过 package exports 暴露它们。Workspace 使用一个最小且固定版本的 pnpm patch 暴露 `@agentclientprotocol/sdk/zod` 与 `@agentclientprotocol/sdk/experimental/v2/zod`；Cypheria 直接导入上游 module，而不是复制 generated definition。

`Acp-Connection-Id` 是 ACP HTTP transport header，而不是 ACP JSON-RPC field。因此它不会嵌入这些 WebSocket envelope；Cypheria session 及其 server-owned ACP connection 提供 routing context。

### Claude Code agent 消息

Protocol 精确固定 `@anthropic-ai/claude-agent-sdk@0.3.270`，将选定的网络安全顶层函数、全部 `Query` control method、可序列化 query option 以及 40 种 `SDKMessage` 输出映射为 `agent.claude.*` 逻辑消息。Request 与 response 通过 `requestId` 配对，client 选择的 `queryId` 标识一条正在运行的 async iterator。文本 prompt 直接传输；`AsyncIterable<SDKUserMessage>` 则由 stream prompt 加上有序 input notification 和 input-complete notification 表示。`startup()`、`tool()` 与 `createSdkMcpServer()` 明确不属于该远程 surface。

SDK 输出在 `payload` 中保持 provider-transparent，但每个上游 `type`/`subtype` 分支都有具体的 Cypheria notification type，例如 `agent.claude.assistant.notification`、`agent.claude.result.success.notification` 和 `agent.claude.system.status.notification`。Generated registry 与 lifecycle check 会检测 SDK message union、`Query` method、option key、exported function 和固定版本的漂移。携带 callback 的 hook、permission handler、自定义 SDK MCP server、process factory、abort controller 与 session-store object 刻意留在 server 本地。完整映射与排除项见 [Claude Agent SDK Protocol](claude-agent-sdk-protocol.zh-CN.md)。

## HTTP 运维接口

| Method | Path | 认证 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | 无 | Process liveness |
| `GET` | `/api/v1/ready` | 无 | Runtime/listener readiness |
| `GET` | `/api/v1/status` | 配置时使用 Bearer | Server information |
| `GET` | `/api/v1/state` | 配置时使用 Bearer | Live operational state |
| `GET` | `/api/v1/diagnostics` | 配置时使用 Bearer | Operational diagnostics |
| `GET` | `/api/v1/config` | 配置时使用 Bearer | Desired config 与 restart status |
| `POST` | `/api/v1/config/patch` | 配置时使用 Bearer | 校验并原子持久化 config patch |
| `POST` | `/api/v1/config/reload` | 配置时使用 Bearer | 从磁盘重新读取 desired config |
| `GET` | `/api/v1/relay/pairing-offer` | 配置时使用 Bearer | E2EE relay offer 与连接状态 |
| `POST` | `/api/v1/runtime/request` | 配置时使用 Bearer | Runtime request forwarding |
| `POST` | `/api/v1/lifecycle/restart` | 配置时使用 Bearer | Supervised worker restart |
| `POST` | `/api/v1/lifecycle/shutdown` | 配置时使用 Bearer | 关闭整个 server |

API route 不会落入 SPA fallback。Request body 与 runtime method namespace 都有边界并经过校验。

## 安全默认值

默认 listener 是 `127.0.0.1:6768`。未配置 `CYPHERIA_SERVER_TOKEN` 时，绑定任何非 loopback 地址都会被拒绝。HTTP 使用 `Authorization: Bearer <token>`。浏览器 WebSocket API 不能设置 authorization header，因此 browser-compatible client 用 `cypheria.bearer.<token>` subprotocol 携带同一个 token。

没有 `Origin` header 的 native client 可以连接。Browser WebSocket 默认只允许 same-origin。Cross-origin HTTP 与 WebSocket 必须通过 `CYPHERIA_SERVER_ALLOWED_ORIGINS` 显式加入 allowlist。Token 不接受 URL 传递，Expo bundle 也不会把 server token 编译进公共 client code。

## 配置与状态

Desired config 存储在 `$CYPHERIA_HOME/config/server.json`，schema version 为 `1`。文件不存在时使用安全默认值，但不会仅因读取而写入用户状态。Patch 会先作为完整配置进行校验，再以仅 owner 可访问的权限原子写入。运行中的 worker 保持 resolved startup snapshot 不变：变化字段通过 `restartRequiredPaths` 返回；由启动环境变量控制的值通过 `overrideControlledPaths` 返回，不会被错误标记为由配置文件控制。

持久化文档负责 listener、CORS、message limit、relay、session deadline、shutdown 与 embedded web 设置。`CYPHERIA_SERVER_TOKEN` 只从环境读取，config/state API 永远不会返回它。Live state 与配置分离，报告 active/retained session、relay 连接状态、runtime lifecycle、worker/supervisor PID，以及 desired config 是否要求 restart。PID ownership 仍在 `$CYPHERIA_HOME/config/server.pid`；identity 与 relay key 继续使用独立的 owner-only 文件。

环境变量覆盖：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | Listener address |
| `CYPHERIA_SERVER_PORT` | `6768` | Listener port；`0` 选择临时端口 |
| `CYPHERIA_SERVER_TOKEN` | 未设置 | 共享运维 credential；非 loopback 必填 |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | 未设置 | 逗号分隔的 cross-origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body 与 WebSocket frame 上限 |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello deadline |
| `CYPHERIA_SERVER_RECONNECT_GRACE_MS` | `30000` | Transport 断开后保留逻辑 session 的时间 |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | HTTP graceful-shutdown deadline |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | 启用内置 Expo web hosting |
| `CYPHERIA_SERVER_WEB_DIR` | 内置 `dist/web` | 覆盖 static directory |
| `CYPHERIA_SERVER_RELAY_ENABLED` | `false` | 让 server 连接 relay |
| `CYPHERIA_SERVER_RELAY_ENDPOINT` | 未设置 | 面向 server 的 relay endpoint |
| `CYPHERIA_SERVER_RELAY_USE_TLS` | `true` | server-facing endpoint 的默认 scheme |
| `CYPHERIA_SERVER_RELAY_PUBLIC_ENDPOINT` | server endpoint | pairing offer 公布的 endpoint |
| `CYPHERIA_SERVER_RELAY_PUBLIC_USE_TLS` | server TLS 设置 | offer 公布的默认 scheme |

TLS termination 刻意放在 Node process 外。任何非 loopback 部署除了认证与显式 origin allowlist，还应把 server 放在可信 TLS reverse proxy 后。

启用 relay 后，server 保持一条 control socket，并为每个远程 client 创建一条加密 data
socket。X25519 key 以 `0600` 模式保存在 `$CYPHERIA_HOME/config/relay-key.json`。pairing
endpoint 继续使用正常的 HTTP Bearer 策略，而 relay data socket 不携带该 token。详见
[Cypheria Relay](relay.zh-CN.md)。

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
