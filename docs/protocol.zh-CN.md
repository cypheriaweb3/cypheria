# 客户端与 Server 协议

`@cypheria/protocol` 是公开 Cypheria 客户端/Server 契约的事实来源，导出严格 TypeScript 类型、编译后的 Zod 校验器、序列化器、能力常量，以及 Server adapter 内部使用的生成型上游产物。

## 范围

公开协议覆盖 Server 运维、Agents、Projects、Threads、Sections、Canonical Timeline、Integrations、Schedules、Terminals 和 Web3。Agent 原生协议不是公开客户端 API，而是 `apps/server` 背后经过校验的 adapter 输入。

生成的 Codex App Server 文件位于 `packages/protocol/src/generated/codex/`。其[生成参考](codex-app-server-api.zh-CN.md)服务于 adapter 开发，不用于客户端直接调用。

## 传输

客户端通过 WebSocket subprotocol `cypheria.v1` 连接 `/api/v1/ws`。所有应用 frame 都是二进制，并包含由 `cbor2` 编码的确定性 CBOR 消息；文本 frame 会被拒绝。公开 profile 允许 null、boolean、string、有限 number、以 `number` 或 `bigint` 表示的整数、以 `Uint8Array` 表示的 byte string、array，以及仅使用 string key 的 map。值为 `undefined` 的可选对象属性会在编码前被省略；其他位置的 `undefined` 会被拒绝，且永远不会出现在 wire 上。该 profile 还拒绝自定义 tagged type、非 string map key、重复 key 和超过协议限制深度的结构。每个解码值仍会经过对应方向的 Zod Schema 校验。

顶层消息为：

```ts
{ type: "hello", clientId, clientType, protocolVersion, appVersion?, capabilities? }
{ type: "ping" }
{ type: "pong" }
{ type: "session", message: logicalMessage }
```

除 ping 外的第一条客户端消息必须是 `hello`。支持的 client kind 为 `desktop`、`mobile`、`web`、`cli`、`mcp` 和 `hub`。附着成功由 `server.status.notification` 确认；协议不公开 session ID 或 resume token。

Server 会拒绝不兼容版本、畸形消息、同一源传输中重复的在途 request ID、超限 frame，以及未在截止时间前发送 hello 的连接。

## 逻辑消息

每条逻辑消息都有具体的点分 `type`。Request 带 `requestId`，对应 response 返回相同 ID。领域 Schema 通常把参数放在 `payload` 中，并以类型化 `{ ok: false, error }` 结果表示领域失败，而不是传输失败。Notification 无需关联。

消息族示例：

```text
server.status.request              -> server.status.response
project.list.request               -> project.list.response
thread.turn.start.request          -> thread.turn.start.response
thread.timeline.appended.notification
schedule.run.request               -> schedule.run.response
web3.signing_intent.create.request -> web3.signing_intent.create.response
```

准确字段以导出的 Zod Schema 为准，而不是本文示例。

## 版本与能力

`CYPHERIA_PROTOCOL_VERSION` 控制传输兼容性。客户端必须拒绝无法安全消费的 Server 协议版本。`server.status.notification` 会发布稳定 capabilities 和可选 feature flags。客户端应据此控制可选 UI，而不是假设应用版本必然对应某个功能。

未知 feature flag 名称会被保留。同一协议版本优先采用可选字段的追加演进；不兼容的形状变更需要新协议版本。

## Projects、Threads 与 Sections

Project 组织 workspace roots 和有序 Thread membership。Thread 是持久 Agent 会话身份，包含 `agentId`、harness session 关联、状态、能力、待处理 interactions、最近时间、归档状态，以及可选 Project 或 Section 位置。Section 同时排序 Projects 和独立 Threads。

协议提供创建、读取、列表、更新、移动、membership、归档和删除操作。顺序使用显式 position 和 `before...` 位置提示。固定 Pinned Section 由稳定协议常量表示；客户端不从 harness 元数据推断 Section 归属。

列表接口有上限并使用 cursor 分页。Mutation response 返回 Server 权威值，供客户端校正乐观更新。

## Canonical Timeline

只追加的 Canonical Timeline 是持久会话历史。每一行包含单调递增序号、时间戳、可选 turn ID、可选 harness item ID，以及一种判别 item：

- `message`：用户和助手内容；
- `reasoning`；
- `tool`；
- `plan`；
- `command`；
- `diff`；
- `approval`；
- `artifact`；
- `status`；
- `error`；
- `harness`：没有通用表示的 Agent 专属事件。

通用 item 可以包含 `harnessData`，用于来源和诊断，而不改变其共享语义。Harness-only item 保留 `agentId`、原生类型和已校验 payload，使客户端可以选择 harness 扩展。

Timeline cursor 包含 epoch 和 sequence。Epoch 用于检测历史替换或重建。读取支持 `tail`、`before` 和 `after`，并可请求 canonical rows 或 projected display items。Projection 会把同一 item 的后续 rows 折叠为稳定展示项，同时保留精确的源 sequence ranges。

客户端订阅 append notification，并在 replacement notification、cursor gap、重连或 epoch 不匹配后重新读取。即使实时消费使用 AI SDK stream，持久化的 Server Timeline 仍是唯一权威。

## Turns 与 interactions

Thread 输入是由文本、图片、音频、resource link 或 embedded resource 组成的有序列表，并受 Thread 公布能力限制。客户端生成的 message ID 使 start 和 steer 操作可安全关联。活动 turn 可以通过 Thread API 取消。

权限请求、问题和 MCP elicitation 会归一化为待处理 Thread interactions。Response 使用 allow、deny、selection、text、answers、elicitation action 或 cancellation 等判别结果。Harness metadata 保留原生上下文，共同生命周期保持统一。

## 错误与重连

传输和协议违规会关闭受影响连接。有关联的领域操作返回稳定错误码和可读消息。`@cypheria/client` 会把连接、能力、协议和 timeout 失败转换为专用错误类。

逻辑 session 由认证 principal 与 `clientId` 共同标识。在配置的 grace period 内重连会附着到保留的逻辑 session，但客户端仍须校正当前状态和 Timeline cursors。逻辑 session 不跨 worker 重启持久化。

## Client facade

`@cypheria/client` 是应用支持的入口。`createCypheriaClient()` 拥有一个连接；`createCypheriaApi()` 借用一个现有内部连接。当前 facades 为：

```text
client.agents
client.projects
client.threads
client.sections
client.timeline
client.harnesses.codex
client.harnesses.claude
client.harnesses.pi
client.harnesses.opencode
client.harnesses.acp
client.schedules
client.web3
client.integrations
client.terminals
client.artifacts
client.settings
client.server
```

Harness facade 只暴露真实 harness 扩展。Codex Apps、account、guardian、models 和 permission settings 位于 `harnesses.codex`；通用集成操作仍通过 `integrations` 提供。

## 校验规则

- 使用对应方向导出的 Schema 校验每个输入和输出边界。
- 不手写或复制生成的 Agent 协议类型。
- 不把 harness 原生消息 union 暴露为持久客户端状态。
- 在同一传输中保持在途 request ID 唯一。
- Cursor 在所属领域之外应视为不透明值。
- 可选行为必须使用 capability 和 feature negotiation。
