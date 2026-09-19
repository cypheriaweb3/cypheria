# `@cypheria/client`

> 状态：当前实现

用于版本化 Cypheria Server 协议的共享 TypeScript client，负责连接生命周期、request correlation、validation、subscriptions、reconnect 和产品级领域 facades。

## 公开入口

```ts
import { createCypheriaClient } from "@cypheria/client"

const client = createCypheriaClient({ url: "http://127.0.0.1:6768" })
await client.connect()

const { thread } = await client.threads.create({
  agentId: "codex",
  cwd: "/absolute/workspace",
})

await client.threads.startTurn({
  clientMessageId: crypto.randomUUID(),
  content: [{ text: "Explain this project", type: "text" }],
  threadId: thread.id,
})

await client.close()
```

`createCypheriaClient()` 拥有一个连接。`createCypheriaApi()` 创建借用内部 `ServerClient` 的 capability facade，并且绝不关闭它。

## Facades

公开 API 暴露 Agents、Projects、Threads、Sections、Timeline、Schedules、Web3、Integrations、Terminals、Artifacts、Settings、Server operations 和 provider extensions。

`providers.codex` 包含 Codex account、model、permission、guardian、integration 和 Apps 操作。Claude、Pi、OpenCode 和 ACP provider facade 暴露当前 integration context。Provider-native wire protocol 仍是 Server adapter 内部契约。

## 可靠性

Client 支持 browser、Node、injected 和 relay E2EE transports，校验两个方向的消息，在断开时拒绝 in-flight requests，使用有界 reconnect，并暴露类型化 connection 与 protocol errors。

`threadId` 是唯一操作 key。Timeline page 使用 epoch 与 sequence cursor；response 要求 reset 或 replacement notification 使本地 projection 失效时，客户端会重建。

## 依赖边界

该包依赖 `@cypheria/protocol` 和 `@cypheria/relay`，不导入 Electron、Desktop、Server runtime 内部实现、数据库或 Agent SDK。

参见[客户端与 Server 协议](../../docs/protocol.zh-CN.md)和[架构](../../docs/architecture.zh-CN.md)。
