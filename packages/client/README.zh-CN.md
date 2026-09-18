# `@cypheria/client`

`@cypheria/client` 是版本化 Cypheria server 协议的可复用客户端。它只依赖
`@cypheria/protocol` 与仅负责传输的 `@cypheria/relay`，不导入 provider runtime、server
内部实现、Electron 代码或 Codex bridge。

## 分层

```text
CypheriaClient = CypheriaApi + connection lifecycle
                              |
                              v
                         ServerClient
                              |
                              v
                  ServerTransport / WebSocket
```

- `ServerClient` 持有 hello 协商、认证、请求关联、超时、校验、事件投递、连接状态和有界重连。
- `CypheriaApi` 借用 `ServerClient`，不能关闭它。
- `CypheriaClient` 持有一个 `ServerClient` 并增加连接生命周期。

## 公开 API

`CypheriaApi` 只暴露产品级协议族：

- `agent`：registry、安装、enable、runtime readiness、operation 和受管工具链；
- `thread`：对话生命周期、turn、timeline 分页、配置和交互；
- `projectThread`：project 与 section 组织；
- `server`：ping、状态、诊断和配置。

Codex、Claude、Pi、OpenCode 与 ACP 的 provider-native 消息仍由 protocol 持有，供 server
adapter 内部使用；它们不进入公开 client wire union，也不再提供 client subpath facade。

```ts
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
await cypheria.connect()

const agents = await cypheria.agent.list()
const ready = await cypheria.thread.create({ agentId: "codex", cwd: "/absolute/workspace" })
const turn = await cypheria.thread.startTurn({
  clientMessageId: crypto.randomUUID(),
  content: [{ text: "解释这个项目", type: "text" }],
  threadId: ready.thread.id,
})

console.log(agents, turn.turnId)
await cypheria.close()
```

## 身份与事件

`threadId` 是 Thread 操作唯一的公开句柄。Thread 上可空的 `agentSessionId` 只是只读诊断
元数据，绝不作为路由键。Server 持有 provider 进程和 session，在创建或恢复 Thread 时自动启动
所选 agent，并把 Thread notification 广播给所有已连接客户端。

使用 `api.on(type, handler)` 监听一种 notification，或用 `api.subscribe(handler)` 监听全部 server
消息。Thread 不需要订阅调用。权限或问题通过 `thread.interaction.requested.notification` 投递；
所有客户端中第一个合法的 `thread.interaction.respond` 生效。

Timeline page 暴露 `epoch` 与 canonical sequence cursor。`reset` 为 true 时应丢弃本地 timeline
状态并从返回页面重建。Projected item 携带对应 canonical source coverage，因此客户端可合并分页
或流式更新，而无需把 projection 当作第二套排序系统。

## Agent enable

安装不会自动 enable agent。调用 `agent.start()` 或执行 Thread 工作之前，必须显式调用
`agent.enable()`。Disable agent 会停止其活跃 Thread；存在活跃 Thread 时，
`agent.stop(agentId, false)` 会拒绝，只有显式传入 `true` 才会强制停止。
