# Cypheria Architecture

Cypheria is a local-first Web3 agent desktop. Its architecture is designed around one core constraint: Web3 signing, automation, local files, shell access, and dApp browsing must not share the same trust boundary.

## System Overview

```txt
                          +----------------------------+
                          |  TanStack Start Renderer   |
                          |  - UI and routing          |
                          |  - Jotai UI state          |
                          |  - TanStack Query cache    |
                          +-------------+--------------+
                                        |
                                        | typed IPC
                                        v
+-------------------------+-------------+--------------+-------------------------+
|                         Electron Main Process                                  |
|                                                                                |
|  +----------------+  +---------------+  +----------------+  +---------------+ |
|  | CodexService   |  | WalletService |  | PolicyEngine   |  | AuditLog      | |
|  +-------+--------+  +-------+-------+  +-------+--------+  +-------+-------+ |
|          |                   |                  |                   |         |
|          v                   v                  v                   v         |
|  Codex App Server      Encrypted Vault     Policy Store        SQLite / FTS   |
|  child process         + OS keychain        + Zod schemas       + append logs  |
|                                                                                |
|  +--------------------+  +-------------------+  +----------------------------+ |
|  | DappBrowserService |  | AutomationRunner  |  | Chain/RPC/Simulation       | |
|  +---------+----------+  +---------+---------+  +----------------------------+ |
|            |                       |                                            |
+------------+-----------------------+--------------------------------------------+
             |                       |
             v                       v
 +-------------------------+   +-------------------------+
 | Isolated dApp sessions  |   | worker_threads / child  |
 | Electron WebContents    |   | processes for tasks     |
 +-------------------------+   +-------------------------+
```

The renderer is a product UI, not a privileged runtime. It asks for capabilities through typed IPC and receives event streams from the main process. Private keys, signing operations, dApp browser permissions, Codex process management, local database access, and automation execution stay outside the renderer.

## Process Boundaries

### Electron Main Process

The main process owns privileged local capabilities:

- Resolving `$CYPHERIA_HOME`, creating runtime directories, and preparing `CODEX_HOME`
  for Cypheria-managed Codex processes.
- Owning the Electron app lifecycle, single-instance lock, and top-level window creation.
- Launching and supervising the Codex App Server child process.
- Managing wallets, encrypted local vaults, Privy bindings, and external wallet sessions.
- Evaluating signing policies before any signature or transaction broadcast.
- Creating isolated dApp browser sessions and injecting the provider bridge.
- Running automation workers.
- Reading and writing local SQLite data.
- Writing audit logs for approvals, rejections, policy decisions, and automation runs.

### Renderer

The renderer owns the user experience:

- TanStack Start app shell, file-based routing, navigation, panels, tabs, and inspectors.
- Wallet, browser, Codex, automation, approval, and security views.
- Optimistic UI state with Jotai.
- Local/server-like data fetching through TanStack Query.
- Forms through TanStack Form + Zod.

The renderer must not access Node.js APIs, private keys, raw shell execution, or dApp internals.

The initial renderer skeleton lives under `apps/desktop/renderer/src` and is built by the desktop package Vite config. It includes the root route, a Workspaces route, the app frame, placeholder sidebar surfaces, theme baseline CSS, and Jotai/TanStack Query providers. During local development, Electron can load the renderer dev server by setting `CYPHERIA_RENDERER_URL`.

The first preload bridge exposes `window.cypheria` through Electron `contextBridge`. It provides typed read-only app metadata and runtime info calls backed by main-process IPC handlers. The renderer treats the bridge as optional so the TanStack Start dev server can still run in a normal browser without Node.js access.

### Web3 dApp WebContents

Each dApp origin runs in its own isolated Electron session. This prevents cookies, localStorage, wallet permissions, and account state from leaking across dApps.

The dApp receives an injected EIP-1193 provider bridge. Provider requests are forwarded to the main process and evaluated through origin-scoped permissions and signing policies.

`@cypheria/web3-browser` defines the V1 browser domain model. Session keys are normalized to `cypheria:dapp:<origin>` and map to persistent Electron partitions. Permission records bind an origin session to wallet id, chain id, account addresses, allowed provider methods, and optional expiration. Provider request/response types cover account requests, chain switching, chain addition, personal signing, typed-data signing, transaction sending, accounts, and chain id reads.

The provider bridge baseline is a browser-side transport abstraction. It accepts EIP-1193-style `request({ method, params })` calls, rejects unsupported methods before transport, serializes supported requests with request id, origin, session key, optional chain id, method, and params, and maps structured provider errors back into `ProviderRpcError`. The actual Electron WebContents injection and main-process handler wiring are separate follow-up work.

### Codex App Server Child Process

Cypheria embeds Codex App Server rather than forking the Codex runtime in V1. The main process communicates with it over JSON-RPC over stdio / JSONL and adapts Codex events into Cypheria UI events.

`@cypheria/codex-bridge` owns the first stable transport boundary for that integration. It models JSON-RPC 2.0 requests, notifications, success responses, and errors as newline-delimited JSON messages; provides chunk-safe JSONL parsing; defines request id generation, lifecycle states, transport errors, and normalized `codex.message`, `codex.transport.error`, and `codex.lifecycle` events. Process launch and supervision remain in the Electron main-process Codex service.

The desktop main process now has a Codex child process supervisor baseline. It launches `codex app-server --listen stdio://` with `CODEX_HOME` inherited from the Cypheria runtime context, exposes start/stop and request/notification writes, parses stdout through the Codex JSONL bridge, forwards stderr lines to a logger hook, records the last exit code/signal, and currently returns `false` from the restart decision placeholder.

Codex owns:

- Threads and turns.
- Workspace operations.
- Diffs and file changes.
- Terminal events.
- Approval prompts.
- MCP integration.

Cypheria owns:

- Web3 tool context.
- Wallet and signing approvals.
- Policy evaluation.
- dApp browser context.
- Automation scheduling and auditing.

## Core Services

```txt
CodexService
  - start/stop Codex App Server
  - manage JSONL transport
  - normalize Codex events
  - expose threads, turns, diffs, terminal, approvals

WalletService
  - manage local wallets and Privy wallets
  - maintain active account context
  - coordinate vault access

SigningService
  - create signing intents
  - call PolicyEngine
  - request user approval when needed
  - sign and broadcast transactions

PolicyEngine
  - evaluate read-only, human-approval, and conditional auto-signing modes
  - enforce origin, wallet, chain, method, contract, value, and time constraints

DappBrowserService
  - create origin-isolated Electron sessions
  - manage WebContents lifecycle
  - inject the provider bridge
  - intercept popups, downloads, and permission requests

AutomationRunner
  - run manual and scheduled tasks
  - launch isolated workers
  - route signing intents through the same policy path as the UI

AuditLogService
  - record signatures, rejections, policy decisions, task runs, and transaction hashes
```

## Key Data Flows

### Codex Thread Flow

```txt
Renderer
  -> codex.thread.create typed IPC
  -> CodexService
  -> Codex App Server stdio
  -> JSON-RPC response and events
  -> CodexService normalizer
  -> Renderer event subscription
```

### dApp Signing Flow

```txt
dApp WebContents
  -> injected EIP-1193 provider
  -> preload bridge
  -> DappBrowserService
  -> SigningService
  -> PolicyEngine
  -> SimulationService
  -> Approval UI if required
  -> wallet signing
  -> RPC broadcast
  -> AuditLogService
```

### Automation Flow

```txt
Scheduler or manual trigger
  -> AutomationRunner
  -> worker_threads / child_process
  -> CodexService / ChainService / WalletService as needed
  -> signing intent if a write operation is needed
  -> PolicyEngine
  -> approval or auto-signing decision
  -> AuditLogService
```

## Security Model

Default rules:

- `nodeIntegration: false`.
- `contextIsolation: true`.
- `sandbox: true`.
- Strict Content Security Policy.
- dApp permissions are scoped by origin.
- Private keys only enter the encrypted vault.
- Renderer and dApp pages never access private keys.
- Codex cannot directly sign transactions by default.
- Agents and automations create signing intents, not signatures.
- Every signing intent goes through PolicyEngine.
- Auto-signing is disabled by default.
- Every policy decision, signature, rejection, and transaction hash is recorded.

## Data Model Baseline

SQLite is the local source of truth for non-secret data. Sensitive wallet material belongs in an encrypted vault protected by OS-backed key storage.

`@cypheria/db` resolves the default SQLite file to `$CYPHERIA_HOME/db/cypheria.sqlite`. Its Drizzle schema baseline starts with `settings`, `audit_logs`, `workspaces`, and `runtime_metadata`; generated migrations live under `packages/db/drizzle`.

The database package now provides a small main-process audit log service. Callers append structured records with `eventType`, `actor`, `createdAt`, `source`, `payloadHash`, `payloadSummary`, and `correlationId`; the service assigns an id when needed and supports read-back by id or recent-list queries. A schema initialization helper applies the baseline SQLite tables before services open against a new database file.

Core tables:

```txt
settings
audit_logs
workspaces
runtime_metadata

Planned later:
  wallets
  accounts
  chains
  rpc_endpoints
  dapp_origins
  dapp_permissions
  signing_policies
  approval_requests
  automation_tasks
  automation_runs
  codex_threads
```

## IPC Contract Baseline

`@cypheria/ipc` owns shared IPC contracts for renderer, preload, and main-process services. The current protocol version is `1`. Channel names use namespace-prefixed dot notation, such as `app.metadata.read` and `runtime.info.read`.

The baseline contract package includes:

- Namespace definitions for `app`, `runtime`, `codex`, `wallet`, `chain`, `browser`, `dapp`, `policy`, `automation`, `approval`, `settings`, and `audit`.
- Zod schemas and TypeScript types for the initial app metadata and runtime info APIs.
- Request, success response, error response, and event envelope types.
- A standard error code set covering bad requests, validation failures, forbidden access, missing resources, unavailable services, and internal errors.

Main-process handlers should validate future inputs and outputs against these contracts. Renderer and preload code should import only the contract types and channel constants needed at the boundary.

Electron main registers routes through the desktop IPC router helper. Each route is backed by one `@cypheria/ipc` contract; the router parses invoke payloads with the request schema and parses handler results with the response schema before returning to preload. The initial registered routes are runtime info, app metadata, and app health.

## Package Boundaries

```txt
@cypheria/ui
  Reusable product UI and Cypheria-specific components.

@cypheria/ipc
  Typed IPC contracts, schemas, and namespace definitions.

@cypheria/codex-bridge
  Codex App Server protocol adapter and event normalization.

@cypheria/wallet-core
  Wallet domain types, account models, signing intents, and wallet policies.

@cypheria/web3-browser
  dApp session model, provider bridge types, and browser permission types.

@cypheria/policy-engine
  Signing policy schemas, evaluator, and policy decision types.

@cypheria/runtime
  Cypheria home directory resolution, runtime path derivation, runtime directory creation,
  and Codex environment setup.

@cypheria/db
  Database schema, migrations, and local persistence helpers.
```

## V1 Constraints

- Do not fork the Codex runtime in V1.
- Do not let renderer or dApp pages access private keys.
- Do not treat wagmi as the core wallet layer.
- Do not share browser sessions across dApp origins.
- Do not auto-sign unless an explicit user policy matches.
- Do not introduce cloud agent execution in V1.
- Do not introduce a complex workflow engine before the local runner proves its shape.
