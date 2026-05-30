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
- AI SDK `ProviderV3` adaptation for chat surfaces that use AI SDK / AI Elements.

Desktop main owns the Codex App Server process lifecycle. It selects a localhost port, starts `codex app-server` with `CODEX_HOME=$CYPHERIA_HOME/codex`, waits for bridge readiness, logs stderr, and shuts the child process down with the desktop runtime.

Codex app-server protocol TypeScript files live inside:

```txt
packages/codex-bridge/src/generated/
```

They are generated with:

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated protocol files are committed. Do not hand-write Codex app-server protocol request, response, notification, or server request types.

## Web3 Browser Boundary

Each dApp origin runs in its own isolated Electron session. dApp pages receive an injected EIP-1193 provider bridge, but provider requests are forwarded to Electron main and evaluated through origin-scoped permissions and signing policy.

`@cypheria/web3-browser` owns:

- Origin-scoped session keys.
- Persistent partition names.
- dApp permission records.
- EIP-1193 provider request/response envelopes.
- Provider error mapping.

The Web3 browser does not share its wallet permission model with Codex preview/browser capabilities.

## Signing Flow

```txt
dApp, automation, or agent context
  -> signing intent
  -> PolicyEngine
  -> simulation/risk metadata when available
  -> approval UI if required
  -> WalletService
  -> RPC broadcast if applicable
  -> AuditLogService
```

Codex does not directly sign transactions. Automation does not directly sign transactions. Both create signing intents routed through Cypheria policy.

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

## Data Model

SQLite is the local source of truth for non-secret data. Sensitive wallet material belongs in an encrypted vault protected by OS-backed key storage.

Current core tables:

```txt
settings
audit_logs
workspaces
runtime_metadata
automation_tasks
automation_runs
```

Planned runtime tables:

```txt
wallets
accounts
chains
rpc_endpoints
dapp_origins
dapp_permissions
signing_policies
approval_requests
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

@cypheria/web3-browser
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
