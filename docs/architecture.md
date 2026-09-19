# Architecture

> Status: Current implementation, with planned work called out explicitly

Cypheria is a local-first system with one privileged Server and multiple unprivileged clients. This document defines process ownership, data flow, and trust boundaries. Wire fields belong in [Protocol](protocol.md), persistence details in [Database](database.md), and commands in [Development](development.md) or [Server](server.md).

## System model

```text
Desktop ─┐
Expo ────┼─ @cypheria/client ─ Cypheria protocol ─ apps/server ─ Agent processes
CLI ─────┘                                      │
                                                ├─ SQLite and configuration
Remote client ─ E2EE ─ relay ───────────────────┤
                                                └─ Web3 and schedule runtime
```

The Server is the sole authority for shared product state. A client may manage a local Server process, but it does not acquire Server privileges by doing so.

## Process ownership

### Server

`apps/server` owns:

- Agent registration, installation, enablement, process lifecycle, health, and native-protocol adapters.
- Projects, Threads, Sections, turns, interactions, and the Canonical Timeline.
- Shared Agent settings and integration state.
- Schedules, Web3 services, privileged terminals, artifacts, and audit records.
- Database access, migrations, configuration loading, logging, and versioned client connections.
- Static hosting for the current Expo web export.

Agent-native events are normalized at this boundary. Native payloads may be retained for diagnostics, but clients do not use them as their durable conversation model.

### Desktop

`apps/desktop` is an Electron application with a TanStack Start renderer. Electron main ensures that a compatible local Server is available and owns windows, isolated dApp `WebContents`, preload IPC, desktop settings, updates, secure storage, and operating-system integration. The renderer uses `@cypheria/client` for shared product capabilities.

### Expo and CLI

`apps/expo` is a buildable Expo Router foundation for iOS, Android, and static web. It is not yet a complete mobile product. `apps/cli` is a non-TUI client and Server lifecycle surface. Neither may import Server internals or Agent SDKs.

### Relay

`apps/relay` forwards opaque encrypted WebSocket frames. `@cypheria/relay` provides transport-neutral pairing, encryption, and relay URL helpers. The relay cannot inspect application payloads and never becomes a source of product state.

## Package boundaries

- `@cypheria/protocol` owns versioned public contracts, runtime validation, and generated upstream protocol artifacts.
- `@cypheria/client` owns connections and domain facades without Electron or database dependencies.
- `@cypheria/ai-sdk-provider` maps Cypheria Threads and Timeline events to AI SDK provider contracts.
- `@cypheria/db` owns the SQLite schema, migration baseline, and repositories used by the Server.
- `@cypheria/web3` contains pure network, policy, wallet, and provider domain logic; privileged orchestration stays in the Server.
- `@cypheria/ui` contains reusable presentation primitives and AI Elements.

`packages/sdk` is planned as a public TypeScript SDK. It does not exist today and must not be simulated by exposing Server internals.

## Primary data flows

### Conversation

1. A client creates or selects a Cypheria Thread and submits input through `@cypheria/client` or an AI SDK provider.
2. The Server resolves the Thread's Agent, starts or reuses the adapter runtime, and records the turn.
3. The adapter converts native events into Canonical Timeline events.
4. The Server persists events and publishes ordered updates with cursors.
5. Clients project the same durable Timeline and render provider extensions only when a discriminated item requires them.

### Desktop startup

1. Electron main discovers a compatible Server or starts a supervised local instance.
2. It waits for health and protocol compatibility before exposing the connection configuration.
3. The renderer connects through `@cypheria/client`.
4. Shutdown only reclaims a Server instance that the Desktop owns and that is safe to stop.

### Signing

1. A client, Agent, schedule, or dApp submits a signing intent.
2. The Server resolves wallet and network context and evaluates policy.
3. An approval is requested when required.
4. Signing occurs in the privileged runtime; key material never crosses into a renderer, Agent, or dApp page.
5. Decisions, signatures, failures, and transaction results are audited.

### Remote connection

Pairing establishes end-to-end keys between client and Server. The relay routes ciphertext only. Application authentication, protocol validation, replay protection, and product state remain endpoint responsibilities.

## Trust boundaries

- The Server process is privileged and must validate every network, filesystem, Agent, plugin, schedule, and Web3 boundary.
- Desktop renderer, Expo, CLI, plugins, Agent processes, and dApp pages are untrusted callers of scoped APIs.
- Electron preload exposes a narrow typed surface; renderers do not receive Node.js access.
- dApp origins use isolated sessions and cannot share cookies, provider permissions, or injected state by default.
- Private keys are encrypted outside ordinary SQLite tables and are used only by Server-owned signing services.
- Server plugins run in controlled child processes. Desktop extensions do not receive ambient filesystem, Node.js, or secret access.

## Deployment shape

The current product is local-first: one user-controlled Server owns the authoritative store. Desktop commonly supervises that Server, while CLI and Expo can connect to it. Remote access uses the optional relay without moving execution or state to the relay.

Cloud Agent execution, multi-Agent orchestration, and a stronger multi-user authorization system are outside the current implementation. They require explicit future protocol and security designs.

## Planned boundaries

- `apps/marketplace`: a separate public submission, review, publication, and discovery service.
- `packages/sdk`: a stable public TypeScript API above the Cypheria protocol.
- Expanded Expo product surfaces after the Desktop experience is mature.

The active, incomplete work is tracked only in [Todo](todo.md).
