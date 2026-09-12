# `@cypheria/client`

`@cypheria/client` is the reusable client for the versioned Cypheria server protocol. It depends
on `@cypheria/protocol`, transport-only `@cypheria/relay`, and the exact official ACP SDK used by
protocol; it does not import runtime, server, Codex bridge, or Electron code.

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
strings. Add a high-level API only after its contract exists in `@cypheria/protocol`.

## Codex client API

`@cypheria/client/codex` implements a Cypheria-owned SDK-shaped `client()` and `ClientApp`. Its
`connect()` and `connectWith()` methods accept `cypheria.agent.codex`, which remains a minimal typed
endpoint rather than a generated action tree. `ClientContext.request()` combines each protocol
request and response into one typed async call. `ClientApp.onRequest()` awaits reverse-request
handlers and writes their typed responses; `onNotification()` dispatches server notifications.
Outbound client notifications use `ClientContext.notify()`.

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

const connection = app.connect(cypheria.agent.codex)
const threads = await connection.codex.request(methods.server.request["thread/list"], {})
await connection.codex.notify(methods.server.notification.initialized)

connection.close()
await cypheria.close()
```

Method constants and every generated Codex type are exported from `@cypheria/client/codex`.
`connectWith(endpoint, operation)` provides a scoped connection and always releases it after the
operation settles. Only one Codex app may consume an endpoint at a time; transport loss aborts the
connection and its pending requests. Low-level consumers can still call endpoint methods directly,
but must not mix manual reverse-response handling with an active `ClientApp`.

## ACP SDK API

The stable `@cypheria/client/acp` entry implements its own SDK-shaped `client()` and `ClientApp`.
Handler registration, contexts, sessions, cancellation, errors, method constants, and generated
protocol types retain the official SDK API, while `connect()` and `connectWith()` accept a Cypheria
ACP endpoint instead of a Web Stream. Other supported SDK exports are selectively re-exported;
reimplemented names and deprecated connection APIs are omitted. In particular, the entry point does
not expose the legacy `ClientSideConnection`, `AgentSideConnection`, or `TerminalHandle` APIs.

```ts
import { client as createAcpApp, methods, PROTOCOL_VERSION } from "@cypheria/client/acp"
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
const app = createAcpApp().onNotification(methods.client.session.update, ({ params }) => {
  console.log(params.update)
})

const connection = app.connect(cypheria.agent.acp)
await connection.agent.request(methods.agent.initialize, {
  protocolVersion: PROTOCOL_VERSION,
})

const session = await connection.agent.buildSession("/absolute/workspace").start()
await session.prompt("Explain this project")

session.dispose()
connection.close()
await cypheria.close()
```

`app.connectWith(cypheria.agent.acp, operation)` provides the SDK's scoped connection style. Draft
ACP v2 is explicitly isolated:

```ts
import { client as createAcpV2App } from "@cypheria/client/acp/v2"

const connection = createAcpV2App().connect(cypheria.agent.acp)
```

The v2 adapter preserves non-empty JSON-RPC batches. Only one active ACP connection is allowed per
Cypheria ACP endpoint because the envelope deliberately carries no second connection ID. Transport
loss closes the ACP connection and rejects its pending requests; reconnect by creating a new ACP
connection after the Cypheria session recovers.

`cypheria.agent.acp` itself remains the minimal `send(payload)` / `subscribe(handler)` endpoint.
Do not mix those low-level operations with an active `ClientApp` connection.

## Usage

```ts
import { createCypheriaClient } from "@cypheria/client"
import { client as createCodexApp, methods as codexMethods } from "@cypheria/client/codex"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
const codex = createCodexApp().connect(cypheria.agent.codex)

const server = await cypheria.server.info()
const runtimeInfo = await cypheria.runtime.request("runtime.info")
const threads = await codex.codex.request(codexMethods.server.request["thread/list"], {})

codex.close()
await cypheria.close()
```

Requests connect lazily. `close()` permanently disposes that client. Before it is closed, transport
loss rejects in-flight work and schedules a bounded exponential reconnect by default. Set
`reconnect.enabled` to `false` when the embedding host owns retry policy.

The default adapter uses the runtime's global WebSocket. Other environments can inject a
`webSocketFactory`, or a complete `transportFactory`. HTTP(S) root URLs are normalized to the
versioned `/api/v1/ws` WS(S) endpoint. Authentication tokens use WebSocket subprotocols and are not
placed in the URL.

For an end-to-end encrypted remote connection, pass a decoded offer or its pairing URL:

```ts
const cypheria = createCypheriaClient({ relayOffer: "cypheria://pair#offer=..." })
```

`relayOffer` cannot be combined with `url`, `token`, or `transportFactory`; a custom
`webSocketFactory` remains available for runtimes without a global WebSocket. E2EE completes before
`session.hello`, and the direct Bearer token is never sent to the relay.

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
