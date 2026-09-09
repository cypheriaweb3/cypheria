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
| Desktop internationalization | Lingui with committed PO catalogs |
| Desktop build | Vite for renderer, tsdown for Electron main/preload |
| Desktop packaging | electron-builder |
| CLI/SDK Codex integration | `@openai/codex-sdk` |
| Desktop Codex integration | `codex app-server` over WebSocket JSON-RPC |
| Desktop Codex protocol types | `codex app-server generate-ts --experimental --out packages/codex-bridge/src/generated` |
| ACP bridge | `@agentclientprotocol/sdk@1.4.0` app API to AI SDK 7.x through `@ai-sdk/provider` 4.x `LanguageModelV4` |
| Marketplace web runtime | TanStack Start on Cloudflare Workers |
| Marketplace data | Cloudflare D1 system of record, R2 immutable artifacts, Queues, Workflows |
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
apps/marketplace
  TanStack Start application deployed to Cloudflare Workers.

packages/sdk
packages/runtime
packages/codex-bridge
packages/acp-ai-provider
packages/ui
packages/network-core
packages/wallet-core
packages/wallet-provider
packages/policy-engine
packages/automation-core
packages/db
```

`apps/cli`, `apps/marketplace`, and `packages/sdk` are planned packages. The existing repository already contains the desktop app and the main domain packages.

## Marketplace Stack

`apps/marketplace` is an SSR-first TanStack Start application deployed to Cloudflare Workers. It reuses `@cypheria/ui`, TanStack Router/Query/Form, Zod, Drizzle, and Lingui. A custom Worker entrypoint delegates HTTP requests to TanStack Start and exposes public, publisher, reviewer, and versioned Desktop API surfaces.

D1 is the system of record for identities, GitHub sources, drafts, scans, reviews, releases, publication, advisories, and audit events. R2 stores private-by-default immutable evidence and public assets. Queues distribute bounded jobs; Workflows coordinate source scanning, human review, and publication. A least-privilege GitHub App deterministically synchronizes active releases to `.agents/plugins/marketplace.json` in the official Cypheria repository. Only public open-source GitHub `url` and `git-subdir` sources pinned by commit SHA are admitted. Desktop uses the Marketplace API for discovery and App Server's Git marketplace operations for installation. See [Cypheria Marketplace Design](marketplace.md).

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

## ACP AI Provider Stack

`@cypheria/acp-ai-provider` is the Node-side ACP bridge. Its stable entry point uses ACP v1 from the exact `@agentclientprotocol/sdk@1.4.0` dependency and implements AI SDK 7 through the `LanguageModelV4` interface supplied by `@ai-sdk/provider` 4.x. It supports stdio, injectable streams, experimental SDK HTTP/WebSocket transports, capability-derived client callbacks, independent model/session lifecycles, typed session configuration, negotiated NES controls, native resource links, control/event access, lossless raw ACP updates, and safe permission cancellation by default. Host tools use `@modelcontextprotocol/sdk` 1.x semantics through an authenticated loopback proxy and negotiate handshake versions through `2025-11-25`. The separate `experimental/v2` export exposes the official draft-v2 client context behind an explicit opt-in; it is not a `LanguageModelV4` adapter.

## Desktop Stack

Desktop keeps Electron + TanStack Start.

Internal desktop navigation uses TanStack Router links to preserve the document, global styles, and appearance state. Global CSS is linked from the root document before client hydration. Chat search parameters are validated by the index route; switching threads or choosing New chat resets the chat session without reloading the application.

Search opens a shadcn Command dialog over the current page, with debounced chat search, recent-chat suggestions, keyboard selection, and explicit loading/error/empty states. Closing the dialog preserves the current draft; selecting a result navigates to that chat.

| Area | Choice |
| --- | --- |
| Main process | TypeScript built with tsdown |
| Preload | TypeScript built with tsdown |
| Renderer | TanStack Start built with Vite |
| Production renderer transport | privileged standard `cypheria://` Electron protocol with SPA fallback |
| IPC | Zod-validated contracts local to `apps/desktop/ipc` |
| Renderer state | Jotai + TanStack Query |
| Renderer internationalization | Lingui (`@lingui/core`, `@lingui/react`, CLI, and Vite catalog compilation) |
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

The language picker lives on the General settings page.

Desktop offers a searchable Codex-style language picker. An explicit choice is persisted as `localeOverride` in the `[desktop]` section of `$CYPHERIA_HOME/codex/config.toml`; automatic detection is represented by the absence of that key. Electron resolves automatic detection from its preferred-language list, passes both the preference and resolved catalog locale through preload bootstrap, and broadcasts later changes through typed IPC. Because the packaged SPA shell is prerendered at build time, both server output and the first client render use the English source catalog; immediately after hydration the renderer activates the bootstrapped catalog, updates the document `lang` and `dir` attributes, and changes language without reloading. This avoids locale-dependent hydration mismatches. English and Simplified Chinese have bundled catalogs; all other picker values currently resolve to English while retaining their original `localeOverride`. PO files are committed; `pnpm --filter @cypheria/desktop i18n:extract` updates them and `i18n:compile` validates that translations are complete.

Settings navigation is grouped into Personal, Integrations, Coding, and Archived sections and filters by localized destination name. `Cmd/Ctrl+F` focuses that search from any settings route. The Archived chats route pages `thread/list` with `archived: true`, passes its query to App Server as `searchTerm`, and exposes typed `thread/unarchive` plus confirmed `thread/delete` actions through the main/preload boundary. ChatGPT-service settings without a Codex App Server or Cypheria-owned backend remain out of scope instead of being presented as inert controls.

The desktop main bundle leaves `@libsql/client` and its platform packages external so Electron loads the matching native binary at runtime. `build:main` copies the committed Drizzle migrations into `dist/drizzle`; packaged startup therefore uses the same migration source as tests and development. Electron user/session data is rooted under `$CYPHERIA_HOME/browser` before the application becomes ready.

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
- Route approval, user-input, MCP-elicitation, and experimental dynamic-tool server requests to Electron main.
- Handle disconnect and overload errors.
- Expose an AI SDK `ProviderV4` adapter for chat surfaces that want AI SDK / AI Elements streams while preserving the direct bridge request API for non-AI-SDK callers.
- The adapter implements `LanguageModelV4` and declares `specificationVersion: "v4"`. It requires Node.js 22 or later.
- `LanguageModelV4` inputs preserve text, inline/local images, supported inline/local audio, and inline text files. Remote media is normalized by AI SDK when possible; unresolved remote URLs, provider file references, ambiguous image types, and unsupported media produce warnings.
- Top-level `reasoning` maps to Codex turn effort; explicit Codex `reasoningEffort` settings take precedence, and `provider-default` leaves the effort unset. Model support for each effort level is determined by Codex.
- Streaming output preserves ordered text and reasoning, provider-executed command/file/MCP/dynamic/collaboration/web tools, preliminary progress, generated images as files, web sources, token usage, metadata, non-retrying App Server failures, and transport failures. Compatible parts carry the full projected Codex item in provider metadata. A parallel `CodexTurnProjector` emits typed persistent UI data parts for the turn envelope, every full generated `ThreadItem`, lifecycle, accumulated progress, terminal interactions, turn plan and diff updates, model reroutes, and otherwise-unmapped turn-scoped notifications.
- Persistent thread resumes inherit stored approval and sandbox policy unless explicitly overridden. Abort uses `turn/interrupt`; an active session can use `turn/steer` and can start a later turn directly.
- AI SDK tool definitions are not treated as App Server dynamic-tool callbacks. Electron-main services register experimental dynamic-tool schemas and handlers in `CodexDynamicToolRegistry`; schemas are sent in `thread/start` and `item/tool/call` is dispatched to the registered handler.
- Stateless history converts `LanguageModelV4` tool-result content into text (file URLs/labels remain textual). Binary/reference tool files, custom tool content, assistant custom content, and reasoning files cannot be replayed natively and produce warnings.

The direct bridge is the application capability plane. Generated stable and experimental methods for threads, projects, reviews, accounts, login, plugins, skills, MCP, terminals, configuration, and future App Server capabilities remain available on its typed request API instead of being forced through `LanguageModelV4`. Electron main wraps only the operations exposed to the renderer in narrow typed IPC services. Desktop initializes with `experimentalApi: true`. Reverse requests use a typed fail-closed interaction broker: missing handlers, invalid responses, timeout, disconnect, and shutdown never imply approval. User decisions are audited. Attestation is advertised only after a real attestation implementation exists, and App Server-managed authentication does not require the external token-refresh callback.

Electron main owns the `codex app-server` child process. It selects a localhost port, starts the process with `CODEX_HOME=$CYPHERIA_HOME/codex`, waits for WebSocket handshake readiness, forwards renderer-safe Codex summaries through `codex.event`, logs stderr, and shuts the process down with the runtime. The exact `@openai/codex` version is pinned in the workspace and desktop manifests. Development resolves that package instead of the user's `PATH`; packaged builds resolve `resources/codex/codex` (`codex.exe` on Windows). `CYPHERIA_CODEX_PATH` is an explicit diagnostic override. Desktop checks `codex --version` against the version that generated the committed protocol types before starting App Server.

Before Electron becomes ready, desktop disables Chromium's `CompressionDictionaryTransport` and `CompressionDictionaryTransportBackend` features. Cypheria does not depend on shared HTTP compression dictionaries, and disabling the optional transport prevents incompatible or interrupted Chromium disk-cache state under `$CYPHERIA_HOME/browser` from emitting repeated startup warnings. Ordinary HTTP caching and the rest of the browser profile remain enabled.

Generate protocol types with:

```sh
pnpm codex:generate
```

Generated files are committed so CI and contributors do not need a matching local Codex binary just to typecheck. A Codex upgrade must update both exact dependency declarations, update `CODEX_APP_SERVER_VERSION`, regenerate these files, and run the bridge and desktop tests in one change.

## UI Stack

The UI strategy is to reuse mature primitives and build custom components only for Cypheria-specific workflows.

The complete shadcn component set for the `base-nova` preset is installed in `packages/ui/src/components`, with dependencies owned by `@cypheria/ui`. Import components through `@cypheria/ui/components/<name>`. Primary controls use `text-sm` (14px with default appearance settings); secondary labels and explicit application-level size overrides can remain smaller. Existing Cypheria compatibility adaptations are preserved. To add newly published components, run `pnpm --filter @cypheria/ui shadcn:add --all --yes` and decline overwrites of customized files. When intentionally reinstalling with `--overwrite`, reapply compatibility adaptations and run UI/desktop tests.

The complete AI Elements registry is vendored in `packages/ui/src/components/ai-elements` and exported through `@cypheria/ui/ai-elements/<name>`. See [AI Elements Integration And Upgrade Guide](./ai-elements.md) for the regeneration procedure and the compatibility adaptations required by Base UI, NodeNext, strict TypeScript, React 19, and AI SDK 7.

The desktop renderer uses `@ai-sdk/react` for chat state and a custom `ChatTransport` backed by typed Electron IPC. Electron main uses the `@cypheria/codex-bridge` `ProviderV4` adapter and converts App Server output into AI SDK UI-message chunks. The transport reports the created thread ID so the renderer can replace the new-chat route with the durable chat route. Live turns retain turn status and timing, full item snapshots and ordering, agent-message phases, progress, plans, diffs, reroutes, and raw turn-scoped events. Reopened chats read metadata plus ascending, paginated `thread/turns/list` pages with `itemsView: "full"` and pass those durable turn/item snapshots through the same `CodexTurnProjector`; notification-only state is necessarily live-only unless App Server includes it in the stored turn. The renderer separates the final answer from grouped activity, automatically collapses completed work, and keeps activity open for a matching pending reverse request. Standard AI SDK parts remain available for generic rendering and drive the workspace Files, Review, and Terminal panels, preserving their latest diff, ANSI output, streaming state, and completion metadata across live and restored conversations. App Server reverse requests travel on a separate typed interaction IPC channel, so approvals and elicitation are not encoded as model messages. Heavy interactive route shells are client-only because Electron ships the SPA output through `cypheria://` and does not execute the TanStack Start server bundle at runtime.

The conversation scroll plane is renderer-owned. AI Elements provides its copied `Conversation` shell, but a Cypheria instance owns its DOM refs and immediate bottom action; TanStack Virtual owns the variable-height list, row measurements, end anchoring, and append following. A bounded in-memory thread-state cache restores stable visible-row anchors and measurement snapshots across workspace navigation. Electron main preserves that cache on macOS by hiding the main window on close and showing the same window on application activation; true application quit remains the teardown boundary.

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

Desktop sidebar motion and hover previews live in `apps/desktop/renderer/src/components/desktop-sidebar.tsx` and its CSS, reusing the shared UI sidebar primitives. Pinned navigation animates its layout width while the panel slides offscreen; hover previews overlay content without reserving width. The chat titlebar synchronizes its leading space with the collapsed toolbar. Native window controls stay fixed, and reduced-motion preferences disable transitions. Window chrome uses fixed pixel geometry: a 44px titlebar, 28px hit targets, 15px icons, and 6px gaps. These dimensions do not scale with the UI font setting; the toolbar center aligns with the native macOS traffic lights at y=22px. Sidebar toolbar icons remain stationary and are clipped by the retracting panel; the collapsed toolbar is revealed underneath without crossfading. The titlebar divider stays behind the sidebar, with no line below the sidebar toolbar. Clicking collapse suppresses hover previews until the pointer leaves the toggle and enters again. Dragging the right edge adjusts sidebar width from 240–480px (also constrained by window width); double-click resets to 288px, and the focused separator supports arrow keys and Home/End. Dragging more than 120px (half the minimum width) past the 240px minimum collapses the sidebar and closes any preview; reopening retains the minimum width. Width is retained across navigation for the current app session.

The workspace navigation below New chat and Search is flattened into stable keyed rows and rendered by one `@tanstack/react-virtual` virtualizer. Section and project expansion rebuild only the visible row model. Pinned pagination is filtered through the App Server's built-in pinned section; unsectioned thread pages supply Projects and Recents, while custom sections are listed and mutated with generated experimental `threadSection/*` and `thread/section/move` calls exposed through renderer-safe IPC. Non-sensitive organization and sort preferences are retained in renderer storage. Show more actions control five-entry disclosure for Pinned, Projects, and project chats, while only the terminal Recents loader automatically requests another cursor page.

Row menus use shared shadcn-style dropdown, submenu, dialog, input, and button primitives. Thread archive/delete/project-move and project update/delete calls stay behind narrow typed IPC. Project pinning and custom-section placement use `cypheria.sidebar.*` metadata keys. Project folder reveal accepts only an App Server project ID at the renderer boundary and resolves the first registered root in Electron main before calling the operating-system shell. Bulk archive enumerates App Server cursors before mutating each matching thread so collapsed and not-yet-rendered rows are included.

## Web3 Stack

| Category | Choice |
| --- | --- |
| EVM client | viem |
| React wallet hooks | wagmi only for lightweight UI state if needed |
| Vault wallets | viem/accounts + encrypted vault |
| Embedded wallets | Privy |
| External wallets | WalletConnect / Reown |
| Chain registry | In-house registry compatible with viem chain format |
| RPC routing | Purpose-aware ordered endpoints with health-based failover for idempotent reads |
| RPC credentials | OS-protected connection records referenced from SQLite |
| Asset providers | Adapter boundary for Alchemy / Reservoir / SimpleHash / Moralis |
| Transaction simulation | Tenderly / Blocknative first; self-hosted simulation later |

Core packages:

- `@cypheria/network-core`: canonical chain identities, strict network/RPC schemas, catalog records, and protocol conversion helpers.
- `@cypheria/wallet-core`: wallet/account/chain/signing intent models.
- `@cypheria/wallet-provider`: origin-scoped dApp sessions, Ethereum EIP-1193/EIP-6963 injection and discovery, bounded Ethereum JSON-RPC and permissions, Solana Wallet Standard discovery and byte envelopes, protocol-scoped events, and persistence contracts.
- `@cypheria/policy-engine`: signing policy schemas and deterministic evaluation.

Private keys never enter renderer, dApp pages, localStorage, IndexedDB, or normal SQLite tables.

Network configuration, endpoint selection, credential protection, dApp-scoped chain selection, and failure behavior are specified in `docs/network-management.md`.

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
| Migrations | Drizzle Kit code-first `generate` + `migrate` |
| Search | SQLite FTS5 when needed |
| Sensitive data | encrypted vault, not normal SQLite tables |

Database column conventions and the single-source migration workflow are defined in
[`docs/database.md`](./database.md).

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
