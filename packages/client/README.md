# `@cypheria/client`

`@cypheria/client` is the reusable client for the versioned Cypheria server protocol. It depends
only on `@cypheria/protocol`; it does not import runtime, server, Codex bridge, or Electron code.

## Layers

```text
CypheriaClient = CypheriaApi + connection lifecycle
                              |
                              v
                         ServerClient
                              |
                              v
                  ServerTransport / WebSocket
```

- `ServerClient` is the low-level protocol driver. It owns hello negotiation, authentication,
  correlation, timeouts, validation, subscriptions, connection state, and bounded exponential
  reconnects. Its transport adapter supports browser WebSockets, Node event-emitter WebSockets,
  and custom transports.
- `CypheriaApi` borrows a `ServerClient` and contains no lifecycle controls.
- `CypheriaClient` owns a `ServerClient` and adds connection lifecycle and session inspection.

## Protocol surface

`CypheriaApi` deliberately exposes only operations represented by current
`@cypheria/protocol` messages:

- `server`: ping, information, diagnostics, restart, and shutdown;
- `runtime`: the generic `runtime.request` call and `runtime.event` subscription;
- `agent.codex`: generated Codex requests, notifications, reverse requests, and responses;
- `agent.acp`: directional ACP envelopes.

It does not invent wallet, policy, automation, or runtime-info product methods from runtime method
strings. Add a high-level action only after its contract exists in `@cypheria/protocol`.

Every Codex client request/response pair is exposed as its own generated async method, following
the upstream method path. For example, `thread/list` becomes `agent.codex.thread.list()`. The
generic correlated request machinery remains internal. Incoming notifications and reverse requests
use the typed Paseo-style `on(messageType, handler)` subscription; outbound client notifications are
async methods under `agent.codex.notify`, and reverse responses are under `agent.codex.respond`.

## Usage

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

Requests connect lazily. `close()` permanently disposes that client. Before it is closed, transport
loss rejects in-flight work and schedules a bounded exponential reconnect by default. Set
`reconnect.enabled` to `false` when the embedding host owns retry policy.

The default adapter uses the runtime's global WebSocket. Other environments can inject a
`webSocketFactory`, or a complete `transportFactory`. HTTP(S) root URLs are normalized to the
versioned `/api/v1/ws` WS(S) endpoint. Authentication tokens use WebSocket subprotocols and are not
placed in the URL.

## Borrowing an existing connection

```ts
import { createCypheriaApi } from "@cypheria/client"
import { ServerClient } from "@cypheria/client/internal/server-client"

const connection = new ServerClient({ url: "http://127.0.0.1:6768" })
await connection.connect()

const api = createCypheriaApi(connection)
await api.runtime.request("runtime.health")

// The host that created the connection remains responsible for it.
await connection.close()
```

Multiple borrowed facades may share one connection. The current foundation server dispatches its
built-in server and runtime messages; Codex and ACP contracts exist in the protocol but their server
dispatch is still planned.
