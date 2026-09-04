# Cypheria Architecture

Cypheria is a TypeScript Web3 agent product that reuses Codex for software-engineering agent work and implements its own Web3 runtime for wallets, signing policy, dApp browsing, automation, local state, and auditability.

The architecture has one central rule: agent work, Web3 signing, automation execution, local files, and dApp browsing must not collapse into one trust boundary.

## System Overview

```txt
apps/cli
  -> @cypheria/runtime
  -> @openai/codex-sdk

packages/sdk
  -> @cypheria/runtime
  -> @openai/codex-sdk

apps/desktop renderer
  -> Electron typed IPC
  -> Electron main
  -> @cypheria/runtime
  -> @cypheria/codex-bridge
  -> persistent codex app-server over WebSocket JSON-RPC
```

Cypheria has three product surfaces and one shared runtime:

- `apps/cli`: a non-TUI command-line app that directly composes Cypheria runtime and the Codex TypeScript SDK.
- `apps/desktop`: an Electron + TanStack Start app that runs Cypheria runtime in Electron main and connects to a long-lived Codex App Server.
- `packages/sdk`: a public TypeScript SDK that directly composes Cypheria runtime and the Codex TypeScript SDK.
- `packages/runtime`: the TypeScript runtime for Cypheria-owned non-agent capabilities.

Codex owns agent threads, turns, model execution, code edits, shell/tool execution, MCP, and Codex approvals. Cypheria owns Web3 context, wallets, signing intents, policy evaluation, dApp browser permissions, automation state, local data, and audit logs.

## Runtime Boundary

`@cypheria/runtime` is the Cypheria non-agent runtime. It owns:

- Runtime home resolution and directory initialization.
- Settings and local metadata.
- Wallet/account/chain/RPC service boundaries.
- Signing intent creation and policy evaluation hooks.
- dApp browser permission and session domain state.
- Automation task and run orchestration.
- Audit log writes.
- Database and vault service wiring.

Runtime does not implement Codex model turns, patches, terminal sessions, or agent tool execution.

Target runtime API:

```ts
class CypheriaRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  request(method: string, params?: unknown): Promise<unknown>
  events(): AsyncIterable<CypheriaRuntimeEvent>
}
```

Runtime method namespaces:

```txt
runtime.*
wallet.*
chain.*
policy.*
browser.*
dapp.*
automation.*
audit.*
settings.*
```

## CLI

`apps/cli` is a Node-based CLI with no TUI in V1. It does not depend on `@cypheria/sdk`. It directly composes:

- `@cypheria/runtime` for Cypheria-owned local/Web3 capabilities.
- `@openai/codex-sdk` for agent workflows.

Initial command groups:

```txt
cypheria run <prompt>
cypheria run --jsonl <prompt>
cypheria runtime info
cypheria wallet list
cypheria policy list
cypheria automation run <task-id>
cypheria doctor
```

The CLI should support human-readable output and JSONL output for automation. It should never import desktop internals.

## SDK

`@cypheria/sdk` is the public TypeScript API for external Node applications. It directly composes:

- `@cypheria/runtime` for Cypheria-owned capabilities.
- `@openai/codex-sdk` for Codex agent threads.

Target SDK shape:

```ts
import { Cypheria } from "@cypheria/sdk"

const cypheria = new Cypheria()
const info = await cypheria.runtime().info()

const thread = cypheria.agent().startThread({ workingDirectory: process.cwd() })
const result = await thread.run("Analyze this repo")
```

The SDK should not depend on Electron, desktop IPC, or `@cypheria/codex-bridge`.

## Desktop

Desktop keeps the existing Electron + TanStack Start architecture.

```txt
TanStack Start Renderer
  - product UI
  - route state
  - Jotai UI state
  - TanStack Query cache
  - typed IPC client only

Electron Main Process
  - CypheriaRuntime lifecycle
  - Codex App Server lifecycle
  - Codex WebSocket bridge
  - wallet/signing/policy/database/automation services
  - dApp WebContents/session management
```

Desktop startup:

```txt
Electron main starts
  -> resolve CYPHERIA_HOME
  -> ensure runtime directories
  -> start CypheriaRuntime
  -> set CODEX_HOME=$CYPHERIA_HOME/codex
  -> start codex app-server --listen ws://127.0.0.1:<port>
  -> connect @cypheria/codex-bridge with initialize/initialized
  -> create renderer window
```

Renderer rules:

- Renderer uses typed IPC only.
- Renderer does not access Node.js APIs.
- Renderer does not access private keys, raw filesystem services, Codex WebSocket, or dApp internals.
- Renderer treats preload capabilities as the only privileged bridge.
- Renderer receives Codex lifecycle, stderr, notification, and server-request summaries through the typed `codex.event` IPC channel.

The desktop information architecture is task-centered. The persistent sidebar puts new-task, search, and pending approvals first; then exposes wallets, automations, signing policies, audit logs, plugins, and skills; and finally groups App Server threads by project with an ungrouped recent-task section. The pending item shows the live number of unresolved signing approvals. The task workspace combines an AI Elements conversation and composer with model, reasoning, sandbox, and wallet-context controls plus a right-hand context/files/review/terminal panel. Entering Settings replaces the workbench sidebar with a dedicated navigation for Account, Appearance, and Models plus a route back to the workspace. Every settings page scrolls in the full right pane so its scrollbar remains at the window edge.

The Web3 workbench completes the local management loop. Wallet screens create or import encrypted vault wallets, add watch-only accounts, select the active account and chain, lock or unlock the vault, and launch an isolated dApp session. Policy screens create, edit, and disable signing rules. Approval screens show the canonical intent and payload hash before accepting or rejecting it, while the audit screen exposes the resulting local security history. Secret form values are submitted directly from uncontrolled forms to preload and are never copied into React state, localStorage, or IndexedDB.

Production renderer assets are served by Electron main through the privileged standard `cypheria://` scheme. Missing application paths fall back to the SPA shell, while resolved assets remain confined to the built renderer directory. This allows direct navigation to workbench and settings routes without running the TanStack Start server bundle in production.

Electron main adapts App Server to AI SDK `ProviderV4` and streams AI SDK UI-message chunks through typed IPC. It also owns account login/logout and Codex config reads/writes. Supported V1 provider choices are Codex-native OpenAI, Amazon Bedrock, Ollama, and LM Studio. Ollama and LM Studio can be used without OpenAI authentication. Generic custom-provider forms and OpenCodex are intentionally deferred.

## Codex Integration

Cypheria uses two Codex integration paths:

- CLI and SDK use `@openai/codex-sdk`.
- Desktop uses `codex app-server` over WebSocket JSON-RPC.

`@cypheria/codex-bridge` is the desktop-side app-server client. It owns:

- WebSocket transport.
- JSON-RPC request/response correlation.
- `initialize` request and `initialized` notification handshake.
- Server notification stream.
- Server-initiated approval request routing.
- Disconnect and lifecycle handling.
- Overload retry handling for app-server overload errors.
- AI SDK `ProviderV4` adaptation for chat surfaces that use AI SDK / AI Elements.

Desktop main owns the Codex App Server process lifecycle. It selects a localhost port, starts `codex app-server` with `CODEX_HOME=$CYPHERIA_HOME/codex`, waits for bridge readiness, logs stderr, and shuts the child process down with the desktop runtime. The App Server binary and generated protocol are an atomic compatibility unit: development resolves the exact workspace `@openai/codex` dependency, packaged builds resolve the bundled Electron resource, and startup rejects a binary whose reported version differs from `CODEX_APP_SERVER_VERSION`. `CYPHERIA_CODEX_PATH` is reserved for explicit diagnostics and remains subject to the same version check.

Codex app-server protocol TypeScript files live inside:

```txt
packages/codex-bridge/src/generated/
```

They are generated with:

```sh
pnpm codex:generate
```

Generated protocol files are committed. Do not hand-write Codex app-server protocol request, response, notification, or server request types.

## Wallet Provider And dApp Browser Boundary

Each dApp origin runs in its own isolated Electron session. dApp pages receive Ethereum and Solana wallet-provider surfaces, but requests are forwarded to Electron main and evaluated through origin-scoped permissions and signing policy.

`@cypheria/wallet-provider` owns:

- Origin-scoped session keys.
- Persistent partition names.
- Ethereum and Solana dApp permission records and bounded request/response envelopes.
- The complete EIP-1193 provider API: `request`, `on`, and `removeListener`, including the five standard event types and `ProviderRpcError` mapping.
- EIP-6963 provider metadata, immutable announcements, request/re-announcement lifecycle, and legacy `window.ethereum` compatibility.
- A Solana Wallet Standard wallet with `standard:connect`, `standard:disconnect`, `standard:events`, `solana:signMessage`, `solana:signTransaction`, and `solana:signAndSendTransaction` features.
- Runtime-validated Solana account, chain, feature, byte-envelope, and batched response boundaries using the official Wallet Standard packages.
- Protocol-scoped provider event envelopes for account, chain, connection, disconnect, and message changes.

The dApp browser does not share its wallet permission model with Codex preview/browser capabilities.

The implemented browser boundary normalizes remote origins to HTTPS (with HTTP allowed only for loopback development), persists `dapp_origins`, Ethereum `dapp_permissions`, and `solana_dapp_permissions` through Drizzle/libSQL, and reuses one persistent Electron partition only within the same origin. Electron's session-data root is set to `$CYPHERIA_HOME/browser`. Desktop creates dApp `WebContentsView` instances with Node integration disabled, context isolation, sandboxing, and web security enabled. Cross-origin navigation, popup windows, and ambient Electron permission requests are denied. A dedicated dApp preload exposes the EIP-1193 provider as `window.ethereum`, announces it through EIP-6963, and registers the Solana provider through Wallet Standard events. The sandbox preload bundles all non-Electron runtime dependencies, uses a plain-data facade for Wallet Standard accounts crossing `contextBridge`, and restricts provider icons to raster data URIs. A real Electron smoke test verifies both discovery mechanisms under these production isolation settings.

Electron main registers each created WebContents ID with its normalized origin and session key. Every Ethereum or Solana provider IPC request must match that trusted registration and the sender's current URL before it reaches `dapp.provider-request` or `dapp.solana-provider-request` in `@cypheria/runtime`. The Ethereum runtime forwards a bounded allowlist of common public read-only RPC methods without wallet permission, checks unexpired origin/account/method permissions for privileged methods, audits redacted outcomes, and converts signing methods into dApp-sourced signing intents before an injected executor can complete them. The Solana runtime implements silent and interactive connection, persistent origin permissions, in-memory connection state, account/feature/chain authorization, and policy-backed signing intents for message signing, transaction signing, and sign-and-send. Main sends successful account and chain changes only to the registered dApp WebContents; preload turns them into EIP-1193 or Wallet Standard events. Renderer and dApp-supplied origin fields are never treated as authority. Desktop runtime options install either provider service only when its authorizer, dispatcher or executor is supplied; otherwise the bridge fails closed.

## Signing Flow

```txt
dApp, automation, or agent context
  -> signing intent
  -> PolicyEngine
  -> persisted decision / approval request
  -> simulation/risk metadata when available
  -> approval UI if required
  -> WalletService
  -> durable one-time intent claim
  -> RPC broadcast if applicable
  -> AuditLogService
```

Codex does not directly sign transactions. Automation does not directly sign transactions. Both create signing intents routed through Cypheria policy.

Wallet signing capabilities are account-bound and consume an intent exactly once. They require an injected policy/approval authorizer, access unlocked vault secrets only through a scoped callback, verify the derived signer and produced signature, and emit redacted audit records. Transaction broadcasting is a separate capability.

Signing policies are wallet-scoped, persisted in libSQL, and managed through a runtime service with strict schemas and optimistic revision checks. Evaluation is deterministic and falls back to human approval when conditional auto-signing has no matching allow policy. Policy changes and every evaluation result are audited.

The signing-intent runtime accepts only strict source contexts (`dapp`, `automation`, or `agent`), assigns the intent ID and creation time itself, evaluates policy before persistence, and stores the exact canonical payload plus its hash in libSQL. Human decisions update `approval_requests` and `signing_intents` together through a libSQL atomic batch guarded by an optimistic revision. Approval IPC exposes the exact intent needed for informed review but never vault material. Audit entries contain only the payload hash and a redacted summary.

## Automation Flow

```txt
manual trigger or scheduler
  -> AutomationRunner
  -> worker boundary
  -> runtime services / Codex SDK as needed
  -> signing intent for write operations
  -> PolicyEngine
  -> approval or policy decision
  -> AuditLogService
```

V1 automation is local-first. Cloud agent execution and complex workflow engines are out of scope.

The implemented automation runtime persists strictly validated task definitions and independent run records in local SQLite. Tasks move through `draft`, `enabled`, `paused`, and `archived` states with optimistic revisions; only enabled tasks run, and a partial unique index permits at most one queued or running execution per task. Runtime methods cover task creation, listing, inspection, pause/resume, run start, and run inspection. Desktop exposes the same boundary through typed IPC.

Task handlers are trusted runtime extensions selected by a persisted handler name and JSON-only, secret-rejecting input. They receive an abort signal plus narrow capabilities for an injected Codex agent runner and signing-intent creation. They never receive a wallet signer or secret. The signing capability forces `source: automation`, replaces the correlation ID with the run audit ID, enforces the task's wallet/account/chain/origin/policy scope, and then delegates to the normal signing-intent and policy pipeline. Runtime shutdown aborts and waits for active executions before the database closes.

## Data Model

SQLite is the local source of truth for non-secret data. Drizzle accesses a local `file:` database through the libSQL SQLite entry point; this does not require or imply a remote Turso/libSQL service. Sensitive wallet material belongs in an encrypted vault protected by OS-backed key storage.

The wallet domain and vault design are specified in `docs/wallet-management.md`.

Current core tables:

```txt
settings
audit_logs
workspaces
runtime_metadata
automation_tasks
automation_runs
wallets
wallet_accounts
chain_accounts
wallet_hd_schemes
active_wallet_context
signing_policies
signing_intent_claims
signing_intents
approval_requests
dapp_origins
dapp_permissions
```

Planned runtime tables:

```txt
rpc_endpoints
```

## Runtime Home

Cypheria-owned data lives under `$CYPHERIA_HOME`, defaulting to `~/.cypheria`.

```txt
$CYPHERIA_HOME/
  codex/        Codex home for Cypheria-managed Codex
  db/
  vault/
  logs/
  cache/
  browser/
  automation/
  config/
```

Cypheria-managed Codex processes must use:

```sh
CODEX_HOME="$CYPHERIA_HOME/codex"
```

## Security Model

Default rules:

- `nodeIntegration: false`.
- `contextIsolation: true`.
- `sandbox: true`.
- `webSecurity: true`.
- Strict Content Security Policy.
- dApp permissions are scoped by origin.
- Private keys only enter the encrypted vault.
- Renderer and dApp pages never access private keys.
- Codex and automation flows create signing intents, not direct signatures.
- Every signing intent goes through `@cypheria/policy-engine`.
- Auto-signing is disabled by default.
- Every policy decision, signature, rejection, automation run, and transaction hash is auditable.

## Package Boundaries

```txt
@cypheria/runtime
  Cypheria non-agent runtime host and service orchestration.

@cypheria/sdk
  Public TS SDK; composes runtime and @openai/codex-sdk.

@cypheria/codex-bridge
  Desktop-side Codex App Server bridge, generated protocol types, transport, and event normalization.

apps/desktop/ipc
  Desktop-local typed Electron IPC contracts, schemas, channel names, and envelopes.

@cypheria/wallet-core
  Wallet domain types, accounts, chains, permissions, and signing intents.

@cypheria/policy-engine
  Signing policy schemas, evaluator, and policy decisions.

@cypheria/wallet-provider
  dApp session, provider bridge, and browser permission models.

@cypheria/automation-core
  Automation task, trigger, run, log, and audit correlation models.

@cypheria/db
  SQLite schema, migrations, and local persistence helpers.

@cypheria/ui
  Shared UI primitives and Cypheria product components.
```

## V1 Constraints

- Do not fork Codex runtime.
- Do not create `@cypheria/codex-protocol`.
- Do not hand-write Codex app-server protocol types.
- Do not implement a TUI.
- Do not store private keys in renderer, localStorage, IndexedDB, or normal SQLite tables.
- Do not share browser sessions across dApp origins.
- Do not make wagmi the core wallet layer.
- Do not introduce cloud agent execution.
- Do not introduce a complex workflow engine before the local runner proves its shape.
