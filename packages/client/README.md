# `@cypheria/client`

`@cypheria/client` is the reusable client for the versioned Cypheria server protocol. It depends on
`@cypheria/protocol` and the transport-only `@cypheria/relay`; it does not import provider runtimes,
server internals, Electron code, or the Codex bridge.

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

- `ServerClient` owns hello negotiation, authentication, request correlation, timeouts, validation,
  event delivery, connection state, and bounded reconnects.
- `CypheriaApi` borrows a `ServerClient` and cannot close it.
- `CypheriaClient` owns one `ServerClient` and adds connection lifecycle.

## Public API

`CypheriaApi` exposes only product-level protocol families:

- `agent`: registry, installation, enablement, runtime readiness, operations, and managed
  toolchains;
- `thread`: conversation lifecycle, turns, timeline paging, configuration, and interactions;
- `projectThread`: project and section organization;
- `server`: ping, status, diagnostics, and configuration.

Provider-native Codex, Claude, Pi, OpenCode, and ACP messages remain protocol-owned implementation
contracts for server adapters. They are not part of the public client wire union and do not have
client subpath facades.

```ts
import { createCypheriaClient } from "@cypheria/client"

const cypheria = createCypheriaClient({ url: "http://127.0.0.1:6768" })
await cypheria.connect()

const agents = await cypheria.agent.list()
const ready = await cypheria.thread.create({ agentId: "codex", cwd: "/absolute/workspace" })
const turn = await cypheria.thread.startTurn({
  clientMessageId: crypto.randomUUID(),
  content: [{ text: "Explain this project", type: "text" }],
  threadId: ready.thread.id,
})

console.log(agents, turn.turnId)
await cypheria.close()
```

## Identity and events

`threadId` is the only public handle for Thread operations. The nullable `agentSessionId` on a
Thread is read-only diagnostic metadata and is never accepted as a routing key. The server owns
provider processes and sessions, automatically starts the selected agent when creating or resuming
a Thread, and broadcasts Thread notifications to every connected client.

Use `api.on(type, handler)` for one notification type or `api.subscribe(handler)` for all server
messages. No Thread subscription call is required. Interactive permission or question requests are
delivered as `thread.interaction.requested.notification`; the first valid
`thread.interaction.respond` wins across all clients.

Timeline pages expose an `epoch` and canonical sequence cursors. If `reset` is true, discard local
timeline state and rebuild from the returned page. Projected items include their canonical source
coverage so clients can merge paginated or streamed updates without treating projections as a
second ordering system.

## Agent enablement

Installation does not enable an agent. Call `agent.enable()` explicitly before `agent.start()` or
Thread work. Disabling an agent stops its active Threads. `agent.stop(agentId, false)` rejects while
Threads remain active; pass `true` only for an explicit forced stop.
