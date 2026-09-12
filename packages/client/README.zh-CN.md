# `@cypheria/client`

`@cypheria/client` 是版本化 Cypheria server protocol 的可复用 client。它依赖
`@cypheria/protocol`、只处理传输的 `@cypheria/relay`，以及 protocol 所用的同一精确版本官方
ACP SDK；不导入 runtime、server、Codex bridge 或 Electron 代码。

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
只有相应 contract 进入 `@cypheria/protocol` 后，才应增加高层 API。

## Codex client API

`@cypheria/client/codex` 实现 Cypheria 自有的 SDK-shaped `client()` 与 `ClientApp`。它的
`connect()` 和 `connectWith()` 接收 `CypheriaApi`，并在内部选择最小的 `agent.codex`
endpoint。`ClientContext.request()` 把每个 protocol request 与 response 组合成一个 typed async
call。`ClientApp.onRequest()` 会等待反向 request handler，并写回 typed response；
`onNotification()` 负责分派 server notification。向 server 发送 client notification 则使用
`ClientContext.notify()`。

```ts
import { client as createCodexApp, methods } from "@cypheria/client/codex"
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
const app = createCodexApp()
  .onRequest(methods.client.request["currentTime/read"], ({ params }) => ({
    currentTimeAt: Math.floor(Date.now() / 1_000),
  }))
  .onNotification(methods.client.notification["thread/started"], ({ params }) => {
    console.log(params.thread)
  })

const connection = app.connect(cypheria)
const threads = await connection.codex.request(methods.server.request["thread/list"], {})
await connection.codex.notify(methods.server.notification.initialized)

connection.close()
await cypheria.close()
```

`@cypheria/client/codex` 会导出 method constant 与全部 generated Codex type。
`connectWith(cypheria, operation)` 提供 scoped connection，并且一定在 operation 结束后释放。
每个 endpoint 同时只允许一个 Codex app 消费；transport loss 会中止 connection 与 pending
request。低层 consumer 仍可直接调用 endpoint method，但不得把手动反向 response 处理与活跃
`ClientApp` 混用。

## ACP SDK API

稳定入口 `@cypheria/client/acp` 自行实现了 SDK-shaped `client()` 与 `ClientApp`。Handler
registration、context、session、cancellation、error、method constant 与 generated protocol
type 保持官方 SDK API；`connect()` 和 `connectWith()` 则改为接收 `CypheriaApi`，而非 Web
Stream。其他可用 SDK export 使用白名单重新导出；我们重新实现的名字及已废弃 connection
API 不会导出，尤其不包含旧的 `ClientSideConnection`、`AgentSideConnection` 或
`TerminalHandle` API。

```ts
import { client as createAcpApp, methods, PROTOCOL_VERSION } from "@cypheria/client/acp"
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
const app = createAcpApp().onNotification(methods.client.session.update, ({ params }) => {
  console.log(params.update)
})

const connection = app.connect(cypheria)
await connection.agent.request(methods.agent.initialize, {
  protocolVersion: PROTOCOL_VERSION,
})

const session = await connection.agent.buildSession("/absolute/workspace").start()
await session.prompt("Explain this project")

session.dispose()
connection.close()
await cypheria.close()
```

`app.connectWith(cypheria, operation)` 提供 SDK 的 scoped connection 风格。Draft ACP
v2 使用显式隔离入口：

```ts
import { client as createAcpV2App } from "@cypheria/client/acp/v2"

const connection = createAcpV2App().connect(cypheria)
```

v2 adapter 保留非空 JSON-RPC batch。由于 envelope 刻意不携带第二个 connection ID，每个
Cypheria ACP endpoint 只允许一个活跃 ACP connection。底层 transport 断开时，ACP connection
会关闭并拒绝 pending request；Cypheria session 恢复后应创建新的 ACP connection。

`cypheria.agent.acp` 本身仍是最小的 `send(payload)` / `subscribe(handler)` endpoint。不得将这些
低层 operation 与活跃 `ClientApp` connection 混用。

## 使用

```ts
import { createCypheriaClient } from "@cypheria/client"
import { client as createCodexApp, methods as codexMethods } from "@cypheria/client/codex"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
const codex = createCodexApp().connect(cypheria)

const server = await cypheria.server.info()
const runtimeInfo = await cypheria.runtime.request("runtime.info")
const threads = await codex.codex.request(codexMethods.server.request["thread/list"], {})

codex.close()
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
