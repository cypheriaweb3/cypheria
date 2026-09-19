# Client Package Instructions

Read the package [README](README.md), public [Protocol](../../docs/protocol.md), and repository [Contributor Instructions](../../AGENTS.md).

## Boundaries

- Depend on `@cypheria/protocol` and transport helpers, never on Server runtime internals, databases, Electron, Desktop, Agent SDKs, or the planned public SDK.
- Treat exported protocol messages and capability flags as the source of truth.
- Route every Thread operation by Cypheria `threadId`; `agentSessionId` is read-only metadata.
- Add a facade only after its request, response, notification, and validation contracts exist in `@cypheria/protocol`.
- Keep generated native protocol types and validators in `@cypheria/protocol`.

Current public facades include Agents, Projects, Threads, Sections, Timeline, schedules, Web3, integrations, terminals, artifacts, settings, Server operations, and genuine harness extensions. `harnesses.codex` owns account, model, permission, guardian, and Apps extensions; other harness facades currently expose integration context. Do not expose raw harness-native messages.

## Layers

- `ServerClient` owns transport creation, hello and authentication, request correlation, timeouts, validation, connection state, subscriptions, and bounded reconnects.
- `CypheriaApi` borrows a `ServerClient` and exposes capabilities without connection lifecycle methods.
- `CypheriaClient` owns one connection and combines the API with lifecycle control.
- `createCypheriaApi()` never closes the supplied connection.

## Reliability

- Keep transports interchangeable across browser, Node, relay E2EE, and injected implementations.
- Validate every outbound and inbound message.
- Deliver notifications through `on(...)` and `subscribe(...)`; clients do not create harness-native subscriptions.
- Reject in-flight requests on disconnect, isolate listener failures, and ignore stale transport events.
- Reconnects must be bounded and cancellable by `close()`.
- A transport loss does not stop Server-owned Agents, Threads, or schedules.
- Reconcile Timeline epoch and cursors after reconnect or replacement notifications.

## Verification

```sh
pnpm --filter @cypheria/client test
pnpm --filter @cypheria/client typecheck
pnpm --filter @cypheria/client build
```

For public API or package-boundary changes, also run `pnpm docs:check`, `pnpm run ci`, and `pnpm build`, and update the paired English and Chinese documentation.
