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

- App shell, navigation, panels, tabs, and inspectors.
- Wallet, browser, Codex, automation, approval, and security views.
- Optimistic UI state with Jotai.
- Local/server-like data fetching through TanStack Query.
- Forms through TanStack Form + Zod.

The renderer must not access Node.js APIs, private keys, raw shell execution, or dApp internals.

### Web3 dApp WebContents

Each dApp origin runs in its own isolated Electron session. This prevents cookies, localStorage, wallet permissions, and account state from leaking across dApps.

The dApp receives an injected EIP-1193 provider bridge. Provider requests are forwarded to the main process and evaluated through origin-scoped permissions and signing policies.

### Codex App Server Child Process

Cypheria embeds Codex App Server rather than forking the Codex runtime in V1. The main process communicates with it over JSON-RPC over stdio / JSONL and adapts Codex events into Cypheria UI events.

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

Core tables:

```txt
wallets
accounts
chains
rpc_endpoints
dapp_origins
dapp_permissions
signing_policies
approval_requests
audit_logs
automation_tasks
automation_runs
codex_threads
workspaces
settings
```

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
