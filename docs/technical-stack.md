# Cypheria Technical Stack

Cypheria V1 is a TypeScript Web3 agent product with CLI, SDK, desktop, and runtime surfaces. It reuses Codex for agent workflows and implements Cypheria-owned Web3 capabilities locally.

## Platform Choices

| Category | Choice |
| --- | --- |
| Primary language | TypeScript |
| Monorepo | Turborepo |
| Package manager | pnpm |
| Lint / format | Biome |
| Tests | Vitest, Testing Library, Playwright |
| Runtime validation | Zod |
| Desktop runtime | Electron |
| Frontend app | TanStack Start |
| Router | TanStack Router |
| Server/cache state | TanStack Query |
| UI state | Jotai |
| Forms | TanStack Form + Zod |
| Desktop build | Vite for renderer, tsdown for Electron main/preload |
| Desktop packaging | electron-builder |
| CLI/SDK Codex integration | `@openai/codex-sdk` |
| Desktop Codex integration | `codex app-server` over WebSocket JSON-RPC |
| Desktop Codex protocol types | `codex app-server generate-ts --out packages/codex-bridge/src/generated` |
| Local database | SQLite |
| ORM | Drizzle ORM |
| SQLite driver | libSQL local SQLite entry point (`@libsql/client/sqlite3`) |

## Workspace Layout

```txt
apps/cli
  Non-TUI command-line app.

apps/desktop
  ipc/
  main/
  preload/
  renderer/

packages/sdk
packages/runtime
packages/codex-bridge
packages/ui
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/automation-core
packages/db
```

`apps/cli` and `packages/sdk` are planned packages. The existing repository already contains the desktop app and the main domain packages.

## Runtime Stack

`@cypheria/runtime` is the TypeScript host for Cypheria-owned non-agent services. It should compose domain packages instead of duplicating their models.

Runtime responsibilities:

- Resolve `$CYPHERIA_HOME`, defaulting to `~/.cypheria`.
- Derive `CODEX_HOME=$CYPHERIA_HOME/codex`.
- Initialize runtime directories.
- Wire database, audit, wallet, policy, browser, automation, and settings services.
- Expose a typed request/event API for CLI, SDK, and desktop main.

Runtime does not implement Codex agent internals.

## CLI Stack

`apps/cli` is a Node CLI without TUI. It directly depends on:

- `@cypheria/runtime`
- `@openai/codex-sdk`

It must not depend on:

- `@cypheria/sdk`
- `@cypheria/codex-bridge`
- Electron or desktop packages

Initial command behavior:

- `cypheria run <prompt>` uses Codex SDK for agent execution.
- `cypheria run --jsonl <prompt>` emits machine-readable event/result output.
- `cypheria runtime info` reads Cypheria runtime metadata.
- Web3 commands use runtime services directly.

## SDK Stack

`@cypheria/sdk` is a public TypeScript library for Node applications. It directly depends on:

- `@cypheria/runtime`
- `@openai/codex-sdk`

It must not depend on:

- `apps/cli`
- Electron or desktop packages
- `@cypheria/codex-bridge`

SDK clients should be small wrappers around runtime services and Codex SDK agent threads.

## Desktop Stack

Desktop keeps Electron + TanStack Start.

| Area | Choice |
| --- | --- |
| Main process | TypeScript built with tsdown |
| Preload | TypeScript built with tsdown |
| Renderer | TanStack Start built with Vite |
| IPC | Zod-validated contracts local to `apps/desktop/ipc` |
| Renderer state | Jotai + TanStack Query |
| UI primitives | `@cypheria/ui` |
| Codex process | `codex app-server` |
| Codex transport | WebSocket JSON-RPC on localhost |
| Codex protocol types | generated into `packages/codex-bridge/src/generated` |

Electron browser defaults:

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

Renderer code uses typed IPC only. Electron main owns privileged services and Codex App Server lifecycle.

## Codex Integration

Cypheria uses Codex in two ways:

```txt
CLI / SDK
  -> @openai/codex-sdk

Desktop
  -> @cypheria/codex-bridge
  -> codex app-server over WebSocket JSON-RPC
```

`@cypheria/codex-bridge` owns desktop integration only. It should:

- Use generated Codex app-server TypeScript files from `src/generated`.
- Implement WebSocket transport.
- Perform the `initialize` request and `initialized` notification handshake.
- Correlate JSON-RPC requests and responses.
- Stream server notifications.
- Route server requests such as approvals to Electron main.
- Handle disconnect and overload errors.
- Expose an AI SDK `ProviderV4` adapter for chat surfaces that want AI SDK / AI Elements streams while preserving the direct bridge request API for non-AI-SDK callers.
- The adapter implements `LanguageModelV4` and declares `specificationVersion: "v4"`. It requires Node.js 22 or later.
- V4 image inputs accept tagged URL or inline base64/byte data; inline images require a concrete media type. Inline text files become text input. Provider file references and unsupported media produce warnings.
- Top-level `reasoning` maps to Codex turn effort; explicit Codex `reasoningEffort` settings take precedence, and `provider-default` leaves the effort unset. Model support for each effort level is determined by Codex.
- Stateless history converts V4 tool-result content into text (file URLs/labels remain textual). Binary/reference tool files, custom tool content, assistant custom content, and reasoning files cannot be replayed natively and produce warnings.

Electron main owns the `codex app-server` child process. It selects a localhost port, starts the process with `CODEX_HOME=$CYPHERIA_HOME/codex`, waits for WebSocket handshake readiness, forwards renderer-safe Codex summaries through `codex.event`, logs stderr, and shuts the process down with the runtime.

Generate protocol types with:

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated files are committed so CI and contributors do not need a matching local Codex binary just to typecheck.

## UI Stack

The UI strategy is to reuse mature primitives and build custom components only for Cypheria-specific workflows.

The complete shadcn component set for the `base-mira` preset is installed in `packages/ui/src/components`, with dependencies owned by `@cypheria/ui`. Import components through `@cypheria/ui/components/<name>`. Existing Cypheria customizations are preserved. To add newly published components, run `pnpm --filter @cypheria/ui shadcn:add --all --yes` and decline overwrites of customized files.

| Category | Choice |
| --- | --- |
| Component model | shadcn-style copied components |
| Primitive layer | Base UI for overlays and interactive primitives |
| Styling | Cypheria CSS tokens and class variants |
| Icons | lucide-react |
| Motion | motion |
| Command menu | cmdk/shadcn command patterns |
| Code editor | Monaco Editor |
| Terminal | xterm.js |

Theme handling follows the Tailwind v4 and shadcn CSS-variable model. See
`docs/theme.md` for the Codex-compatible appearance config, shadcn token mapping,
theme preset behavior, and font-size rules.

Cypheria-specific components:

- Wallet switcher.
- Signature approval.
- Transaction simulation panel.
- dApp permission inspector.
- Chain/RPC selector.
- Policy rule builder.
- Web3 browser address bar.
- Codex thread event adapter.

Visual direction: quiet, work-focused, low saturation, panel-oriented, dense enough for real engineering workflows, and close to Codex Desktop. Avoid neon Web3 marketing aesthetics.

## Web3 Stack

| Category | Choice |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi only for lightweight UI state if needed |
| Local wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Chain registry | In-house registry compatible with viem chain format |
| Asset providers | Adapter boundary for Alchemy / Reservoir / SimpleHash / Moralis |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

Core packages:

- `@cypheria/wallet-core`: wallet/account/chain/signing intent models.
- `@cypheria/web3-browser`: strict dApp session and permission models, JSON-RPC envelopes, session manager, and EIP-1193 provider bridge.
- `@cypheria/policy-engine`: signing policy schemas and deterministic evaluation.

Private keys never enter renderer, dApp pages, localStorage, IndexedDB, or normal SQLite tables.

## Policy And Automation Stack

| Category | Choice |
| --- | --- |
| Policy schema | Zod-validated JSON policy |
| Policy evaluator | Deterministic TypeScript evaluator |
| Scheduler | cron-parser or equivalent local scheduler |
| Runner | worker_threads or child_process |
| Logs | Structured logs persisted through runtime/db |

Policy modes:

- Read-only.
- Human approval.
- Conditional auto-signing.

Signing policies are stored in the explicit `signing_policies` libSQL table. `@cypheria/runtime` provides strict create, get, list, update, disable, and evaluate operations. Records carry timestamps and a monotonically increasing revision; updates and disables use compare-and-swap semantics so concurrent editors cannot silently overwrite each other.

Evaluation first applies wallet mode, then matching enabled and unexpired wallet policies. Explicit deny takes precedence over human approval, which takes precedence over allow; policy ID is the deterministic tie breaker. An unmatched conditional auto-signing request requires human approval. Every mutation and evaluation result receives a stable decision or policy identifier and a redacted audit record.

Signing intents and approval requests are stored in explicit libSQL tables. The exact canonical intent payload is retained so an approval and the eventual signature refer to identical bytes, while audit logs retain only its SHA-256 hash and a redacted summary. Approval decisions use revision-based compare-and-swap and an atomic libSQL batch to prevent two reviewers from resolving the same request differently. A pending attempt is authorized before the one-time replay claim, so it can be retried after approval; an approved attempt is claimed immediately before secret access and signing.

Automation is local-first. Tasks may use Codex SDK, read chain state, create signing intents, and write audit logs. Tasks must not bypass the policy engine.

`@cypheria/runtime` owns the automation service and exposes `automation.task.create`, `automation.task.list`, `automation.task.get`, `automation.task.pause`, `automation.task.resume`, `automation.run.start`, `automation.run.get`, and `automation.run.list`. `@cypheria/automation-core` owns strict task/run schemas and state transitions; `@cypheria/db` owns asynchronous SQLite persistence and optimistic updates. Executors are injected by handler name and receive only scoped agent and signing-intent capabilities. The SDK can compose the agent capability directly with `@openai/codex-sdk`; desktop keeps its persistent App Server boundary separate.

## Data Stack

| Category | Choice |
| --- | --- |
| Database | SQLite |
| ORM | Drizzle ORM |
| Driver | libSQL local SQLite entry point (`@libsql/client/sqlite3`) |
| Migrations | drizzle-kit |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault, not normal SQLite tables |

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

Planned tables:

```txt
rpc_endpoints
```

## Engineering Rules

- Use pnpm, not npm/yarn/bun, unless explicitly requested.
- pnpm-related commands should usually run outside the sandbox so pnpm can use its global store.
- Keep TypeScript strict.
- Use Zod at runtime boundaries: IPC, policy schemas, wallet inputs, automation definitions, and generated-protocol adapters.
- Keep package boundaries explicit.
- Keep domain/data packages independent from `@cypheria/runtime`; runtime composes them through explicit service injection instead of reverse imports.
- Update English and Chinese docs together for architecture, behavior, command, package boundary, or runtime-path changes.

## Not In V1

- No TUI.
- No Codex runtime fork.
- No `@cypheria/codex-protocol` package.
- No hand-written Codex app-server protocol types.
- No cloud agent execution.
- No complex workflow engine before the local runner is proven.
- No private keys in renderer, localStorage, IndexedDB, or normal SQLite tables.
- No shared browser sessions across dApp origins.
- No wagmi core wallet layer.
