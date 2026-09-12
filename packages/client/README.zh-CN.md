# `@cypheria/client`

`@cypheria/client` 是版本化 Cypheria server protocol 的可复用 client。它依赖
`@cypheria/protocol` 与只处理传输的 `@cypheria/relay`，不导入 runtime、server、Codex
bridge 或 Electron 代码。

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

- `ServerClient` 是底层 protocol driver，负责 hello negotiation、鉴权、请求关联、超时、校验、
  订阅、连接状态和有界指数退避重连。Transport adapter 同时支持 browser WebSocket、Node
  event-emitter WebSocket 与自定义 transport。
- `CypheriaApi` 借用 `ServerClient`，不包含 lifecycle control。
- `CypheriaClient` 持有 `ServerClient`，并增加连接 lifecycle 与 session 查询。

## Protocol 能力面

`CypheriaApi` 刻意只暴露当前 `@cypheria/protocol` message 已表示的操作：

- `server`：ping、information、diagnostics、restart 与 shutdown；
- `runtime`：通用 `runtime.request` 调用与 `runtime.event` 订阅；
- `agent.codex`：generated Codex request、notification、反向 request 与 response；
- `agent.acp`：有方向的 ACP envelope。

它不会根据 runtime method 字符串发明 wallet、policy、automation 或 runtime-info 产品方法。
只有相应 contract 进入 `@cypheria/protocol` 后，才应增加高层 action。

每一个 Codex client request/response pair 都按 upstream method path 暴露为独立的 generated
async 方法。例如，`thread/list` 会成为 `agent.codex.thread.list()`；通用请求关联机制仅保留在
内部。接收 notification 与反向 request 使用 Paseo 风格的 typed
`on(messageType, handler)`；向 server 发送的 client notification 位于
`agent.codex.notify`，反向 response 位于 `agent.codex.respond`，二者也都是 async 方法。

## 使用

```ts
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })

const server = await cypheria.server.info()
const runtimeInfo = await cypheria.runtime.request("runtime.info")
const threads = await cypheria.agent.codex.thread.list({})

const unsubscribe = cypheria.on("agent.codex.thread.started.notification", (message) => {
  console.log(message.payload.thread)
})

await cypheria.agent.codex.notify.initialized()

unsubscribe()
await cypheria.close()
```

请求会懒连接。`close()` 会永久释放该 client。在 close 之前，transport 断开会拒绝进行中的
请求，并默认安排有界指数退避重连；如果 embedding host 自己负责 retry policy，可将
`reconnect.enabled` 设为 `false`。

默认 adapter 使用当前 runtime 的全局 WebSocket。其他环境可以注入 `webSocketFactory`，或
完整的 `transportFactory`。HTTP(S) 根 URL 会转换到版本化 `/api/v1/ws` WS(S) endpoint。
鉴权 token 使用 WebSocket subprotocol，不会放入 URL。

端到端加密的远程连接可传入解码后的 offer 或 pairing URL：

```ts
const cypheria = createCypheriaClient({ relayOffer: "cypheria://pair#offer=..." })
```

`relayOffer` 不能与 `url`、`token` 或 `transportFactory` 同时使用；没有全局 WebSocket 的
runtime 仍可提供自定义 `webSocketFactory`。E2EE 会先于 `session.hello` 完成，直连 Bearer
token 绝不会发送给 relay。

## 借用已有连接

```ts
import { createCypheriaApi } from "@cypheria/client"
import { ServerClient } from "@cypheria/client/internal/server-client"

const connection = new ServerClient({ url: "http://127.0.0.1:6768" })
await connection.connect()

const api = createCypheriaApi(connection)
await api.runtime.request("runtime.health")

// 创建连接的 host 仍负责管理连接生命周期。
await connection.close()
```

多个借用门面可以共享一条连接。当前 foundation server 会 dispatch 内置 server 与 runtime
message；Codex 和 ACP contract 已进入 protocol，但其 server dispatch 仍是后续工作。
