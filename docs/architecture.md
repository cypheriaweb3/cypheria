---
title: Architecture
---

# Architecture

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
- Shared Git settings, per-Agent Cypheria extensions, the independent named proxy list, Agent-native settings access, and integration state.
- Schedules, Web3 services, privileged terminals, local Git execution, artifacts, and audit records.
- Database access, migrations, configuration loading, logging, and versioned client connections.
- Static hosting for the current Expo web export.

Agent-native events are normalized at this boundary. Native payloads may be retained for diagnostics, but clients do not use them as their durable conversation model.

### Desktop

`apps/desktop` is an Electron application with a TanStack Start renderer. Electron main ensures that a compatible local Server is available and owns windows, isolated dApp `WebContents`, preload IPC, client KV/Replica/attachment backends, updates, secure storage, and operating-system integration. The renderer uses Jotai over client KV for device-local state and `@cypheria/client` plus TanStack Query for shared Server state. Device-local state is intentionally not synchronized between clients.

### Expo and CLI

`apps/expo` is a buildable Expo Router foundation for iOS, Android, and static web. It is not yet a complete mobile product. `apps/cli` is a non-TUI client and Server lifecycle surface. Neither may import Server internals or Agent SDKs.

### Relay

`apps/relay` forwards opaque encrypted WebSocket frames. `@cypheria/relay` provides transport-neutral pairing, encryption, and relay URL helpers. The relay cannot inspect application payloads and never becomes a source of product state.

### Website

`apps/website` is the TanStack Start marketing and documentation application deployed as one Cloudflare Worker. Marketing and Fumadocs pages are prerendered and served asset-first; the Worker remains the server-rendering boundary for future Marketplace pages and APIs. It does not connect to the local Cypheria Server or import its internals.

## Package boundaries

- `@cypheria/protocol` owns versioned public contracts, runtime validation, and generated upstream protocol artifacts.
- `@cypheria/client` is the public TypeScript SDK. It owns connections and domain facades without Electron or database dependencies.
- `@cypheria/db` owns the SQLite schema, migration baseline, and repositories used by the Server.
- `@cypheria/storage` owns non-authoritative client storage ports and platform adapters for key/value state, rebuildable replicas, and attachment bytes; see [Client Storage](client-storage.md).
- `@cypheria/web3` contains pure network, policy, wallet, and provider domain logic; privileged orchestration stays in the Server.
- `@cypheria/ui` contains reusable presentation primitives, including protocol-independent conversation, panel, notification, and artifact surfaces.

## Primary data flows

### Conversation

1. A client creates or selects a Cypheria Thread and submits input through `@cypheria/client`.
2. The Server resolves the Thread's Agent, starts or reuses the adapter runtime, and records the turn.
3. The adapter validates the native boundary and converts item lifecycle updates into stable Canonical Timeline identities. Blocking reverse requests become targeted interactions; goal, queue, usage, rate-limit, environment, and safety state remain queryable runtime state instead of fake messages.
4. The Server persists Timeline events and publishes ordered updates with epochs and cursors.
5. Desktop consumes the Thread API directly. Its framework-independent controller recovers epoch changes or sequence gaps, and React renders the same durable Timeline through `useSyncExternalStore`; Codex-specific controls use the typed `client.harnesses.codex` facade.

### Desktop startup

1. Electron main opens Desktop client storage and reads validated appearance and locale values before creating a window.
2. It discovers a compatible Server or starts a supervised local instance.
3. It waits for health and protocol compatibility before exposing the connection configuration.
4. The renderer connects through `@cypheria/client`; shared Server config notifications refresh TanStack Query while local KV notifications stay inside the Desktop installation.
5. Shutdown only reclaims a Server instance that the Desktop owns and that is safe to stop.

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

The public website uses Cloudflare static assets with Worker fallback. Its English pages use root paths and Simplified Chinese pages use `/zh-CN`; static documentation search is generated from the same repository Markdown sources.

Cloud Agent execution, multi-Agent orchestration, and a stronger multi-user authorization system are not implemented. They require explicit future protocol and security designs.

## Planned boundaries

- Marketplace routes inside `apps/website`: public discovery plus authenticated publisher and reviewer surfaces. Their data and authorization remain independent of the local Server, and plugin scanning runs in a separate restricted Worker.
- Expanded Expo product surfaces after the Desktop experience is mature.

The active, incomplete work is tracked only in [Todo](todo.md).
