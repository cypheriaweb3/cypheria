# `@cypheria/client`

The public TypeScript SDK for the versioned Cypheria Server protocol. It owns connection lifecycle, request correlation, validation, subscriptions, reconnects, and product-level domain facades.

## Public entry point

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

`createCypheriaClient()` owns one connection. `createCypheriaApi()` creates a capability facade that borrows an internal `ServerClient` and never closes it.

## Facades

The public API exposes Agents, Projects, Threads, Sections, Timeline, schedules, Web3, integrations, terminals, artifacts, settings, Server operations, and harness extensions.

`harnesses.codex` contains Codex account, model, permission, guardian, integration, and Apps operations. Claude, Pi, OpenCode, and ACP harness facades expose their current integration context. Harness-native wire protocols remain internal Server adapter contracts.

## Reliability

The client supports browser, Node, injected, and relay E2EE transports. It validates both directions, rejects in-flight requests on disconnect, uses bounded reconnects, and exposes typed connection and protocol errors.

`threadId` is the only operation key. Timeline pages use epoch and sequence cursors; clients rebuild when a response requests reset or a replacement notification invalidates local projection.

## Dependency boundary

This package depends on `@cypheria/protocol` and `@cypheria/relay`. It does not import Electron, Desktop, Server runtime internals, databases, or Agent SDKs.

See [Client/Server Protocol](../../docs/protocol.md) and [Architecture](../../docs/architecture.md).
