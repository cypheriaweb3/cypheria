# Cypheria Technical Stack

Cypheria V1 is a cross-platform Web3 agent desktop. It should preserve the parts of Codex Desktop that are useful for local engineering work, while adding a wallet manager, Web3 app browser, task automation, and Web3 vibe coding.

## Overall Architecture

```txt
Electron Main Process
  - Local permissions, security, wallets, Codex child process, automation, database, audit logs

TanStack Start Renderer
  - UI, routing, state display, user interaction entry points

Isolated Web3 Browser WebContents
  - dApp pages, with one isolated session per origin

Codex App Server Child Process
  - Reuse Codex thread, turn, approval, diff, and terminal capabilities
```

Core principles:

- Private keys, signing, automation execution, the Codex child process, and system permissions live in the Electron main process or isolated child processes.
- The renderer talks to local capabilities only through typed IPC and event subscriptions. It never directly accesses private keys, Node.js APIs, shell commands, or dApp page internals.
- The Web3 dApp browser and Codex preview browser are separate surfaces with different permission models and no shared wallet context.
- The default security mode is human approval. Read-only mode and custom conditional auto-signing are configurable modes.

## Desktop And Frontend

| Category | Choice |
| --- | --- |
| Desktop runtime | Electron |
| App framework | TanStack Start |
| Router | TanStack Router |
| Server/cache state | TanStack Query |
| Client/UI state | Jotai |
| Forms | TanStack Form + Zod |
| IPC schema | Zod-validated typed IPC |
| Build | Vite for renderer, tsdown for Electron main |
| Monorepo | Turborepo |
| Package manager | pnpm |
| Lint / format | Biome |
| Tests | Vitest + Testing Library + Playwright |
| Package/release | electron-builder |

Recommended Turborepo + pnpm workspace layout:

```txt
apps/desktop
  main/
  preload/
  renderer/

packages/ui
packages/ipc
packages/codex-bridge
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/runtime
packages/db
```

Turborepo should own task orchestration, caching, and dependency-aware pipelines across apps and packages. pnpm should own dependency installation and workspace linking through `pnpm-workspace.yaml`.

The desktop app currently uses a package-level Vite config at `apps/desktop/vite.config.ts` for the TanStack Start renderer. The Start source directory is `apps/desktop/renderer/src`, with generated file routing in `routeTree.gen.ts`. Electron can load a local renderer dev server by setting `CYPHERIA_RENDERER_URL=http://127.0.0.1:5173`.

## UI Stack

The UI strategy is to reuse mature components first, avoid rebuilding base components, and only build custom components for Cypheria-specific Web3 and agent workflows.

| Category | Choice |
| --- | --- |
| Component system | shadcn/ui |
| Primitive layer | Accept the Radix UI / Base UI dependencies used by shadcn components |
| Styling | Tailwind CSS |
| AI UI reference | OpenAI Apps SDK UI, ai-elements patterns |
| Icons | lucide-react |
| Motion | motion |
| Toasts | Sonner |
| Command menu | shadcn command / cmdk |
| Code editor | Monaco Editor |
| Terminal | xterm.js |

Component strategy:

- Use shadcn directly for Button, Input, Textarea, Dialog, Sheet, Popover, Dropdown Menu, Tabs, Tooltip, Select, Checkbox, Switch, Badge, Table, Command, Sidebar, Resizable, Scroll Area, and Toast/Sonner.
- Reference OpenAI Apps SDK UI and ai-elements for Conversation, Message, Reasoning, Tool Call, Approval Prompt, Artifact, Diff Review, Prompt Input, and Task Timeline patterns.
- Build Cypheria-specific components for Wallet Switcher, Signature Approval, Transaction Simulation Panel, DApp Permission Inspector, Chain/RPC Selector, Policy Rule Builder, Web3 Browser Address Bar, and Codex Thread Event Adapter.

The visual direction should stay close to Codex Desktop: quiet, tool-like, moderately dense, low-saturation, panel-oriented, and centered around threads, diffs, terminals, and workspaces. Avoid typical Web3 neon gradients and marketing-page aesthetics.

## Codex Integration

| Category | Choice |
| --- | --- |
| Codex base | Embedded Codex App Server |
| Process model | Electron main process starts a `codex app-server` child process |
| Transport | JSON-RPC over stdio / JSONL |
| UI bridge | Main process wraps `CodexService`; renderer subscribes through typed IPC |
| Configuration | Compatible with Codex config, MCP, workspace, and approval flow |

Cypheria should not fork the Codex runtime in V1. Codex owns code-agent behavior, workspace operations, diffs, terminal sessions, approvals, MCP, and thread/run lifecycle. Cypheria wraps it with Web3 tools, wallet approvals, dApp browser context, task automation, policy evaluation, and audit logs.

`@cypheria/codex-bridge` is the protocol adapter package. It defines JSON-RPC 2.0 wire messages, chunk-safe JSONL parsing, outbound request/notification helpers, request id generation, transport lifecycle states, transport error types, and normalized Codex events for the Electron main process to consume.

The first desktop supervisor lives in Electron main and defaults to `codex app-server --listen stdio://`. It passes the runtime-scoped `CODEX_HOME`, streams stdout through `@cypheria/codex-bridge`, captures stderr lines, records exit state, and leaves automatic restart disabled until a later policy is defined.

```txt
Renderer
  -> ipc.invoke("codex.thread.create")
  -> Main CodexService
  -> codex app-server stdio
  -> JSON-RPC response / event
  -> Renderer event stream
```

Cypheria runtime paths should be resolved by `@cypheria/runtime`. `$CYPHERIA_HOME` configures the app home directory and defaults to `~/.cypheria`; when launching Codex App Server, Cypheria should pass `CODEX_HOME="$CYPHERIA_HOME/codex"`. Runtime directories are created explicitly through the Electron main process startup helper `initializeDesktopRuntime()`, which calls `ensureRuntimeDirectories()`.

## Wallets And Chain Access

| Category | Choice |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi for lightweight UI state only |
| Local wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Multi-chain config | In-house chain registry compatible with viem chain format |
| Asset data | Adapter for Alchemy / Reservoir / SimpleHash / Moralis |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

Core services:

```txt
WalletService
  - account lifecycle
  - local wallet vault
  - Privy wallet binding
  - active wallet context

ChainService
  - RPC clients
  - chain registry
  - gas estimation
  - read contract / write contract

SigningService
  - personal_sign
  - typed data
  - transaction signing
  - policy check before signing

AssetService
  - token balances
  - NFT balances
  - transaction history
```

`@cypheria/wallet-core` defines the shared wallet domain boundary for V1. It includes wallet modes (`read-only`, `human-approval`, `conditional-auto-signing`), local/Privy/external/read-only wallet sources, wallet accounts, chain definitions, RPC endpoints, EIP-1193 permission methods, origin-scoped wallet permissions, and signing intents for personal signing, typed data, transaction signing, and transaction sending.

Local wallet security:

- Key derivation: Argon2id.
- Symmetric encryption: XChaCha20-Poly1305 or AES-256-GCM.
- OS-backed key protection: keytar / Electron safeStorage.
- Seed phrase reveal: one-time reveal with strong confirmation.
- Export: requires password and local confirmation.

## Web3 App Browser

| Category | Choice |
| --- | --- |
| Browser container | Electron `WebContentsView` |
| Isolation strategy | One persistent session per dApp origin |
| Provider | In-house EIP-1193 provider bridge |
| Permission model | origin + wallet + chain + method |
| Popups/downloads | Intercepted and approved by the main process |

The Web3 browser should not reuse the Codex preview browser permission model. The Codex preview browser is for local development previews, screenshots, and visual inspection, and should not connect to wallets. The Web3 app browser is for real dApp usage and needs login state, cookies, wallet connections, signing approvals, origin isolation, and provider injection.

`@cypheria/web3-browser` owns the shared browser session model. It provides stable origin-scoped session keys, persistent partition names, permission records, EIP-1193 provider method coverage, and typed provider request/response envelopes.

Session key examples:

```txt
cypheria:dapp:https://app.uniswap.org
cypheria:dapp:https://opensea.io
cypheria:dapp:https://app.aave.com
```

The provider bridge must intercept:

```txt
eth_requestAccounts
wallet_requestPermissions
wallet_switchEthereumChain
wallet_addEthereumChain
personal_sign
eth_signTypedData_v4
eth_sendTransaction
eth_accounts
eth_chainId
```

Transaction request flow:

```txt
dApp
  -> injected provider
  -> preload bridge
  -> Main DappBrowserService
  -> PolicyEngine
  -> SimulationService
  -> Approval UI
  -> SigningService
  -> RPC broadcast
  -> AuditLog
```

## Policy Engine And Automation

| Category | Choice |
| --- | --- |
| Policy schema | JSON policy + Zod schema |
| Policy execution | In-house deterministic evaluator |
| Advanced policies | CEL can be added later |
| Scheduler | cron-parser + in-house scheduler |
| Runner | worker_threads or child_process |
| Logs | pino structured logs |

V1 policy modes:

- Read-only: only allow chain reads, asset queries, and contract analysis.
- Human approval: every signing request requires an explicit approval prompt.
- Conditional auto-signing: only auto-sign when a policy matches.

The baseline `@cypheria/policy-engine` package validates signing policies with Zod and evaluates `allow`, `deny`, or `require-human-approval`. Read-only mode only allows `eth_accounts` and `eth_chainId`; human-approval mode always requires approval; conditional auto-signing only allows a request when an enabled, unexpired policy matches the wallet, chain, origin, method, optional contract allowlist, and optional native value limit. Explicit deny policies take priority over allow policies.

Policy example:

```ts
type SigningPolicy = {
  id: string
  enabled: boolean
  walletId: string
  chainIds: number[]
  origins: string[]
  methods: string[]
  contractAllowlist?: string[]
  maxNativeValue?: string
  expiresAt?: string
  effect: "allow" | "deny" | "require-human-approval"
  requireHumanApproval: boolean
}
```

V1 automation capabilities:

- Periodically check wallet assets, approvals, and risk.
- Periodically open a workspace and let Codex run a task.
- Generate contracts, tests, and frontend integration code.
- Monitor dApp or contract state.
- Draft transaction intents.
- Auto-sign only when a policy matches; otherwise route to human approval.

V1 should not support high-frequency trading, MEV, complex DeFi strategy auto-execution, or large automatic cross-chain bridge operations.

## Data Layer

| Category | Choice |
| --- | --- |
| Local database | SQLite |
| ORM | Drizzle ORM |
| SQLite driver | better-sqlite3 |
| Migrations | drizzle-kit |
| Search | SQLite FTS5 |
| Sensitive data | encrypted vault; never store plaintext secrets in normal SQLite tables |

The initial `@cypheria/db` baseline resolves the app database to `$CYPHERIA_HOME/db/cypheria.sqlite`, defines the first Drizzle tables for settings, audit logs, workspaces, and runtime metadata, and stores generated SQLite migrations in `packages/db/drizzle`.

`@cypheria/db` opens SQLite with `better-sqlite3`, wraps the schema with Drizzle, and exposes an audit log service for append/read flows. Unit coverage uses Vitest against an in-memory SQLite database.

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

## IPC And Security

IPC namespaces:

```txt
app.*
runtime.*
codex.*
wallet.*
chain.*
browser.*
dapp.*
policy.*
automation.*
approval.*
settings.*
audit.*
```

IPC contract conventions:

- `@cypheria/ipc` owns protocol version `1` and the shared channel constants.
- Request, response, error, and event envelopes include the protocol version.
- Initial app metadata and runtime info APIs have Zod schemas and inferred TypeScript types.
- Main-process IPC routes are registered through a helper that validates request payloads and handler responses against `@cypheria/ipc` contracts.
- Error envelopes use standard codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `UNAVAILABLE`, and `INTERNAL_ERROR`.

Security defaults:

- `nodeIntegration: false`.
- `contextIsolation: true`.
- `sandbox: true`.
- Strict CSP.
- dApp permissions are origin-scoped.
- Private keys only enter the encrypted vault.
- The renderer and dApps never access private keys.
- The Codex agent cannot directly sign by default; it can only create signing intents.
- Every signing intent must go through the PolicyEngine.
- Every signature, rejection, auto-signing action, and policy decision is written to the AuditLog.
- Auto-signing policies are disabled by default.

## Engineering

Biome owns linting and formatting:

```txt
biome.json
  - formatter
  - linter
  - import sorting
  - organize imports

package scripts
  - check: biome check .
  - lint: biome lint .
  - format: biome format --write .
  - ci: biome ci .
```

Recommended dependencies:

```txt
electron
electron-builder
tsdown
@tanstack/react-start
@tanstack/react-router
@tanstack/react-query
@tanstack/react-form
jotai
react
react-dom
typescript
vite
zod
@biomejs/biome
tailwindcss
lucide-react
cmdk
sonner
motion
monaco-editor
xterm
viem
wagmi
@privy-io/react-auth
@walletconnect/sign-client
drizzle-orm
drizzle-kit
better-sqlite3
keytar
cron-parser
pino
nanoid
date-fns
vitest
@testing-library/react
playwright
```

In this repository, pnpm-related commands should usually run outside the sandbox so pnpm can use its global store.

## Not In V1

- Do not use Tauri in V1.
- Do not fork the Codex runtime in V1.
- Do not use wagmi as the core wallet layer.
- Do not store private keys in the renderer, localStorage, or IndexedDB.
- Do not build cloud agent execution in V1.
- Do not introduce a complex workflow engine in V1.
- Do not rebuild base components such as Dialog, Dropdown, Popover, or Tooltip just to avoid shadcn's underlying dependencies.
