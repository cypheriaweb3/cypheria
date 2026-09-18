# Cypheria Architecture

Cypheria is a TypeScript Web3 agent product that reuses Codex for software-engineering agent work and implements its own Web3 runtime for wallets, signing policy, dApp browsing, schedule, local state, and auditability.

The architecture has one central rule: agent work, Web3 signing, schedule execution, local files, and dApp browsing must not collapse into one trust boundary.

## System Overview

```txt
apps/expo / apps/cli / @cypheria/client / future packages/sdk
  -> @cypheria/protocol
  -> apps/server over HTTP or WebSocket

apps/server
  -> Hono control plane + supervised worker
  -> Server-internal Agent and Web3 services
  -> embedded apps/expo web export

remote clients
  -> @cypheria/relay E2EE
  -> apps/relay (single, or cluster gateway -> worker)
  -> apps/server relay data socket

apps/desktop renderer
  -> @cypheria/client
  -> apps/server
  -> canonical Agent/Thread timeline

apps/desktop Electron main
  -> discover/reuse/start a protocol-compatible local server
  -> Electron-only browser, secure storage, windows, updates, and OS integration

apps/marketplace
  -> TanStack Start on Cloudflare Workers
  -> D1 publication system of record + R2 immutable artifacts
  -> Queues + Workflows for scan/review/publication
  -> official GitHub repo marketplace projection
```

Cypheria has one privileged server, multiple clients, a separate marketplace, and one shared runtime:

- `apps/server`: the Node.js/Hono control plane for runtime ownership, versioned client sessions, operations, process supervision, and web hosting.
- `apps/expo`: the first Cypheria protocol client, built once for iOS, Android, and static web.
- `packages/client`: the shared WebSocket protocol driver and capability facade for Cypheria clients. It owns neither the privileged runtime nor a Codex process.
- `apps/cli`: the Node CLI for Server lifecycle and shared resource APIs; `packages/sdk` remains planned.
- `apps/desktop`: the self-hosting Electron + TanStack Start client. Electron main manages a compatible local server, while the renderer uses shared project, section, Thread, and timeline APIs.
- `apps/marketplace`: a TanStack Start application on Cloudflare Workers for submitting, scanning, reviewing, publishing, and discovering ChatGPT/Codex-compatible plugins, then synchronizing approved entries to the official Cypheria GitHub repo marketplace.
- `apps/server/src/runtime`: the TypeScript runtime for Cypheria-owned non-agent capabilities.
- `apps/relay`: the optional Go gateway/worker data plane for opaque remote WebSocket forwarding.
- `packages/relay`: transport-neutral TypeScript E2EE and relay URL helpers shared by server and
  clients.

Codex owns agent threads, turns, model execution, code edits, shell/tool execution, MCP, and Codex approvals. Cypheria owns Web3 context, wallets, signing intents, policy evaluation, dApp browser permissions, schedule state, local data, and audit logs.

## Server And Protocol Boundary

`apps/server` is the only target-architecture process that owns the `apps/server` runtime. It exposes a small Hono HTTP operations API and a versioned WebSocket session protocol from `@cypheria/protocol`. A supervisor owns the PID lock, bidirectional liveness supervision, bounded crash restart, process-group termination, and graceful shutdown; the replaceable worker owns Hono, logical sessions, runtime lifecycle. Direct sockets and decrypted relay channels enter the same physical-connection boundary. A logical session is keyed by authenticated principal plus `clientId`, can own multiple physical transports simultaneously, and is retained for a bounded grace period only after its final transport drops. Reconnection with the same identity resumes it automatically without a public session ID or resume token. Desired server configuration lives at `$CYPHERIA_HOME/config/server.json`; the worker resolves environment overrides once at startup and exposes desired-versus-running restart state without returning its environment-only authentication token.

`@cypheria/protocol` defines the public Agent/Thread, project/section, and server message families. Its WebSocket layer follows Paseo: top-level `hello`, `ping`, and `pong` handle physical connections, while `{ type: "session", message }` carries logical traffic. A logical `server.status.notification` completes attachment; there is no public session handle. `@cypheria/client` packages this boundary into `ServerClient`, borrowed `CypheriaApi`, and lifecycle-owning `CypheriaClient` layers. Its public API exposes `agent`, `thread`, `projectThread`, and `server`; provider-native endpoints and client subpath facades are not public.

The protocol package still owns generated and pinned Codex, ACP, Claude, and Pi schemas and types. These are server-adapter contracts and drift-checked implementation artifacts, not members of the live public client/server message union. The server translates them through `ThreadProviderAdapter` into provider-neutral Thread lifecycle, timeline, turn, configuration, and interaction messages. This preserves precise upstream validation without leaking provider lifecycle or subscription concepts to clients.

`threadId` is the only public Thread operation handle. `agentSessionId` is nullable, read-only provider metadata. Creating or explicitly resuming a Thread ensures its agent runtime is ready, starts or loads the provider session, and binds newly discovered provider IDs internally. `thread.get` and `thread.list` are side-effect-free. Provider history is rehydrated into a new timeline epoch after restart or replacement; only canonical timeline rows receive sequence numbers. The canonical item model preserves shared message, reasoning, tool, plan, command, diff, approval, artifact, status, and error experiences, while a typed provider item and `providerData` retain agent-specific payloads without exposing provider transport. The server broadcasts Thread state, timeline, and interaction notifications to all clients, and the first valid interaction response wins.

Codex and OpenCode use shared server processes, while Claude, Pi, and ACP runtimes are isolated per Thread. OpenCode runs a loopback server and uses the stable SDK root API plus both event streams internally. Claude `canUseTool`, Pi extension UI, OpenCode permission/question events, Codex reverse requests, and ACP permission requests are normalized into typed Thread interactions. ACP agents must support native session deletion before Cypheria allows Thread creation, so provider-first deletion can preserve the Cypheria record on failure. See [Thread Protocol](thread-protocol.md).

`AgentManager` owns the ACP Registry, asynchronous installs and updates, explicit enablement, and runtime state. Disabled agents cannot start or receive business calls. Codex and OpenCode are shared processes; Claude, Pi, and registry ACP agents are session-scoped. `ToolchainManager` owns latest-stable Node LTS, uv, managed CPython, and immutable Python environments shared by complete dependency fingerprint. See [Agent Management](agent-management.md).

Cypheria-owned object schemas strip unknown keys. The optional `server.status.features` record is the
exception: it preserves unknown boolean flags for mixed-version peers. Every named compatibility
gate must stay optional and carry a `COMPAT(name)` comment with its introduction version and removal
date. Final protocol unions use explicit Zod AOT compilation. Provider-native requests are validated
with their selected schema at the internal adapter boundary before dispatch.

Wallet, policy, browser, schedule, and the remaining product services stay outside the current Agent/Thread work. See [Cypheria Server](server.md).

## Relay Boundary

Remote clients may use a `ConnectionOfferV2` instead of a direct URL/token. The authenticated
server pairing endpoint creates a `cypheria://pair` URL containing a relay endpoint, server ID, and
server X25519 public key. `@cypheria/client` completes E2EE before sending the top-level
`hello`; `apps/server` converts each decrypted relay data socket into the same
transport-neutral `ClientSession` used by direct WebSockets. The relay sees routing metadata and
ciphertext but never sees the direct Bearer token or application plaintext.

The implemented deployment scope is one region. `--mode=single` colocates gateway and worker in
exactly one process with in-memory routing and no etcd or internal listener. Cluster mode separates
`--role=gateway` and `--role=worker`, uses etcd ownership and mTLS, and may span availability zones.
TOML configuration and a Kustomize base cover both operational shapes; etcd and the OpenTelemetry
Collector remain external components.
Independent per-region clusters, home-region routing, a global linearizable coordinator, fencing
generations, and automatic failover are designed but deferred. See [Cypheria Relay](relay.md).

## Expo Client

`apps/expo` is an Expo SDK 57 + Expo Router application with one source tree for iOS, Android, and web. It performs the versioned session hello, correlates server requests, reconnects with bounded backoff, and consumes server information. Static web export is copied into the server build and served by Hono with SPA fallback. Credentials are not compiled into the public Expo bundle.

The marketplace is a separate remote trust boundary. D1 is the review/publication system of record; the backend deterministically projects published releases into `$REPO_ROOT/.agents/plugins/marketplace.json` in the official Cypheria GitHub repository. Entries may only use public open-source GitHub `url` or `git-subdir` sources pinned by commit SHA. R2 stores immutable evidence, Queues distribute bounded work, and Workflows coordinate scan, review, and catalog publication. The marketplace never executes arbitrary third-party code in request Workers and never receives local wallet, Codex home, end-user connector credential, or runtime state. See [Cypheria Marketplace Design](marketplace.md).

## Runtime Boundary

the `apps/server` runtime is the Cypheria non-agent runtime. It owns:

- Runtime home resolution and directory initialization.
- Settings and local metadata.
- Wallet/account/chain/RPC service boundaries.
- Signing intent creation and policy evaluation hooks.
- dApp browser permission and session domain state.
- Schedule task and run orchestration.
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
audit.*
settings.*
```

## CLI

`apps/cli` is a Node-based CLI with no TUI in V1. It is a Cypheria protocol client of `apps/server`, does not depend on `@cypheria/sdk`, and does not import the privileged runtime, database, Agent SDKs, or desktop internals.

Initial command groups:

```txt
cypheria server start|stop|status|logs
cypheria agents list
cypheria projects list
cypheria threads list
cypheria schedules list
```

Lifecycle commands invoke the installed Server supervisor; resource commands use `@cypheria/client`. `CYPHERIA_SERVER_BIN`, `CYPHERIA_SERVER_URL`, and `CYPHERIA_TOKEN` provide explicit deployment overrides. Interactive Thread streaming and Web3 administration remain gated on their shared Server APIs.

## SDK

`@cypheria/sdk` is the planned public TypeScript client for external applications. It wraps the same versioned server protocol used by other clients and does not own runtime or Codex process lifecycle.

Target SDK shape:

```ts
import { Cypheria } from "@cypheria/sdk"

const cypheria = new Cypheria()
const info = await cypheria.runtime().info()

const thread = cypheria.agent().startThread({ workingDirectory: process.cwd() })
const result = await thread.run("Analyze this repo")
```

The SDK should not depend on Electron, desktop IPC, Server runtime internals, or the Server Codex adapter.

## Desktop

Desktop keeps the existing Electron + TanStack Start implementation and its Codex-derived visual and interaction model. Its shared data plane is being migrated in place: Electron main ensures a protocol-compatible local Cypheria server is running, while the renderer uses `@cypheria/client` instead of provider-native project, section, Thread, and history APIs.

```txt
TanStack Start Renderer
  - product UI
  - route state
  - Jotai UI state
  - TanStack Query cache
  - @cypheria/client for shared server state
  - typed IPC for Electron-only capabilities

Electron Main Process
  - local Cypheria server discovery/start/readiness
  - dApp WebContents/session management
  - secure storage, windows, updates, and OS integration
```

Desktop startup:

```txt
Electron main starts
  -> resolve CYPHERIA_HOME
  -> ensure runtime directories
  -> probe the configured local server
  -> reuse it when its protocol version is compatible
  -> otherwise start the bundled server and wait for /api/v1/ready
  -> create renderer window
```

Renderer rules:

- Renderer uses `@cypheria/client` for shared product and Agent/Thread state.
- Renderer uses typed IPC only for Electron-local capabilities.
- Renderer does not access Node.js APIs.
- Renderer does not access private keys, raw filesystem services, Codex WebSocket, or dApp internals.
- Renderer treats preload capabilities as the only privileged bridge.
- Renderer consumes persisted history from the canonical timeline and live turns through the unified AI SDK providers.

The preserved Sidebar presentation model now receives direct `ProjectView`, `ThreadView`, and `SectionView` data from the Cypheria API. Section placement, project nesting, pinned state, ordering, pagination, archive, fork, rename, and move operations no longer infer organization from Codex metadata. The existing Pinned, custom sections, Projects, and Recents hierarchy, virtualization, disclosure controls, menus, keyboard behavior, unread state, and optimistic rollback behavior remain the UI baseline.

The preserved conversation scope still owns drafts, attachments, cached `Chat` instances, virtualization, scroll restoration, and navigation continuity. Live Codex turns use `@cypheria/ai-sdk-provider/codex`; durable history is rehydrated from the server-owned canonical timeline. Common message, reasoning, tool, command, diff, plan, approval, artifact, status, and error items reuse the same renderer. Active-turn steering is a capability-gated common Thread operation: Codex maps it to App Server steering and Pi maps it to Pi RPC, while unsupported providers reject it explicitly.

The desktop information architecture is chat-centered. New chat and search remain fixed at the top of the persistent sidebar. Pending approvals, wallets, schedules, signing policies, audit logs, plugins, and skills share one virtualized scroll surface with collapsible Pinned, custom, Projects, and Recents sections. Sidebar menus persist independent pinned/chat sort choices and switch between project grouping and one combined Recents list. Custom sections use the experimental App Server `threadSection/*` lifecycle and `thread/section/move` methods through typed IPC; new chats launched from a section are moved into it as soon as App Server creates the durable thread. Chat row menus follow the packaged desktop grouping: Rename, Pin/Unpin, read state, and Archive come first, followed by Project, Section, Copy, and Fork groups. Project menus cover pinning, edit, section placement, folder reveal, conditional mark-all-read, bulk chat archive, and removal; each project row exposes its new-chat action as a separate hover/focus shortcut rather than a menu item. Project placement is stored as Cypheria-namespaced App Server project metadata, while Electron main resolves reveal requests from a project identifier instead of accepting renderer paths. Section menus support edit, confirmed bulk archive across direct chats and contained projects, and confirmed deletion. Projects come from App Server `project/list`, including projects without chats; renderer-safe IPC supports project creation, rename, deletion, and a main-process directory picker. A new chat can select a project, which supplies both `projectId` and its first root as `cwd` to `thread/start`. Pinned items and top-level projects reveal five more entries only after an explicit Show more action; each expanded project applies the same five-chat disclosure. Recents has no presentation cap and fetches the next App Server cursor when its terminal loading row reaches the viewport. The pending item shows the live number of unresolved signing approvals. The chat workspace combines an AI Elements conversation and composer with project, model, reasoning, sandbox, and wallet-context controls plus a right-hand context/files/review/terminal panel whose width is constrained relative to the available workbench rather than the full viewport. App Server `fileChange` and `commandExecution` tool parts drive that panel for both live and restored chats: Files keeps the latest state for every changed path, Review renders the recorded unified diff with copy actions, and Terminal renders ANSI output, streaming state, and exit status for every command. Entering Settings replaces the workbench sidebar with a grouped Personal, Integrations, Coding, and Archived navigation plus a route back to the workspace. The settings navigation is searchable and supports `Cmd/Ctrl+F` focus. General, Appearance, Connections, Plugins, Configuration, Models, and Archived chats are dedicated routes; Archived chats uses App Server thread listing, unarchive, and delete methods for search, restore, and permanent removal. Every settings page scrolls in the full right pane so its scrollbar remains at the window edge. ChatGPT account, personalization, notification delivery, voice, storage, and updater controls are intentionally deferred because they depend on ChatGPT service or app-owned capabilities not exposed by Codex App Server.

The conversation surface uses TanStack Virtual with measured variable-height message rows, stable message IDs, end anchoring, append following, and overscan so long restored threads do not mount every turn at once. A renderer-owned, 20-entry thread scope snapshots measured rows plus a stable visible-message anchor, raw offset, bottom distance, viewport height, and bottom-follow state. Layout-effect restoration happens before paint and preserves the stable anchor across route changes and asynchronous row measurement; new or bottom-locked chats remain at the true bottom. AI Elements `Conversation` supplies structure and context only: the desktop injects its own instance, disables the upstream spring/resize scrolling, and disables browser scroll anchoring so it cannot compete with TanStack's correction. On macOS, closing the main window hides it and activation shows the same renderer, retaining the session scope; quitting still tears it down. See [AI Elements Integration And Upgrade Guide](ai-elements.md) for the ownership and upgrade constraints. The header supports inline App Server thread renaming. Its ChatGPT-aligned composer uses a borderless elevated surface, a content-growing editor capped at `25dvh`, explicit leading/trailing footer groups, validated attachment and screenshot capture, skill insertion, dictation, project and permission selection, one combined model/reasoning menu, and distinct submit, stop, mid-turn steer, and next-turn queue actions. The packaged editor's clipboard routing is preserved: image-only paste becomes an attachment, mixed image and independent text stays textual, and pastes of at least 5,000 characters become scope-owned `Pasted text.txt` cards that can be restored at the active selection up to 25,000 characters. Because App Server v2 has no generic file input, the initial, steering, and queued-message boundaries decode these inline text attachments into complete `text` user inputs. Shared scroll surfaces preserve native macOS overlay geometry while applying transparent tracks and quiet thumbs that strengthen on hover or active scrolling. Workspace chrome is a nested resizable layout: the side panel is constrained to 320 pixels through half the workbench, while the bottom panel defaults to 280 pixels and remains between 160 pixels and half the available height. The title-bar bottom-panel control and `Cmd/Ctrl+J` toggle that dock independently from the `Control+Backquote` terminal action. Hiding the bottom panel collapses it to zero without closing its tabs or PTYs; the mounted Xterm surface, output, and last pixel height are restored when it reopens. Closing the last tab leaves the empty dock visible and changes its panel action to `Close`; opening a hidden empty dock explicitly creates a new terminal. The tab strip scrolls independently while its add-tab control remains fixed beside it, matching the packaged desktop panel chrome. Panel state and the terminal controller live above the keyed chat session, so switching conversations retains the open dock, PTYs, active tab, and height; a bounded replay buffer restores Xterm output when the session subtree remounts. A project-scoped `node-pty` terminal can still move between the bottom dock and a side-panel tab without losing its session, while the terminal action consults the configured default bottom/right location when no terminal dock is visible. Renderer IPC passes only an optional App Server project ID; Electron main resolves the trusted project root before spawning the shell and owns terminal input, resize, output, exit, and cleanup.

The plugin and skill workbench has two discovery providers and one App Server installation path. The implemented Codex provider projects the marketplace records returned by `plugin/list` through typed IPC, identifies OpenAI and Cypheria official identities with exact-name allowlists, and treats every remaining marketplace as Personal. The planned Cypheria provider reads the versioned `apps/marketplace` API for paginated discovery, review state, and advisories; Electron main then registers or upgrades the pinned official Cypheria GitHub repo through App Server and invokes `plugin/read`/`plugin/install`. Both providers may share renderer components, but provenance, trust, and failures must not be flattened.

Settings includes Plugins/Apps/MCP/Skills/Markets tabs. Main owns application availability and MCP inventory projections, scoped enablement writes, HTTP MCP addition, and validated external authorization URLs. The renderer observes authorization completion notifications and refreshes status; opening a login page does not imply authorization success. It receives renderer-safe schemas and never reads `$CYPHERIA_HOME` directly or receives MCP credentials. See [Plugin and Skill Management](plugin-skill-management.md) and [Cypheria Marketplace Design](marketplace.md).

The Web3 workbench completes the local management loop. Wallet screens create or import encrypted vault wallets, add watch-only accounts, select the active account and chain, lock or unlock the vault, and launch an isolated dApp session. Policy screens create, edit, and disable signing rules. Approval screens show the canonical intent and payload hash before accepting or rejecting it, while the audit screen exposes the resulting local security history. Wallet secret form values are submitted directly from uncontrolled forms to preload and are never copied into React state, localStorage, or IndexedDB.

Production renderer assets are served by Electron main through the privileged standard `cypheria://` scheme. Missing application paths fall back to the SPA shell, while resolved assets remain confined to the built renderer directory. This allows direct navigation to workbench and settings routes without running the TanStack Start server bundle in production.

Desktop localization uses Lingui inside the TanStack Start renderer while Electron main owns language preference persistence and operating-system locale resolution. The General settings page's searchable language picker writes Codex-compatible `[desktop].localeOverride` values to `$CYPHERIA_HOME/codex/config.toml`; automatic detection removes that key. A typed, encoded preload argument carries both the selected preference and the resolved catalog locale. The prerendered SPA shell and first client render both use the English source catalog, then the renderer activates the bootstrap locale immediately after hydration. This keeps hydration deterministic while typed settings IPC applies initial and later language changes reactively. The picker exposes the full Codex language set captured by the desktop reference, while English and Simplified Chinese catalogs currently ship with the renderer; every other explicit or system locale falls back to English without losing the saved selection.

Electron main adapts App Server to AI SDK `ProviderV4` and streams AI SDK UI-message chunks through typed IPC. Alongside portable AI SDK text, reasoning, file, source, and tool parts, a shared `CodexTurnProjector` emits persistent typed `data-codex-*` parts for the complete turn envelope, full generated `ThreadItem` values, item lifecycle and progress, terminal interactions, plan updates, diffs, model reroutes, and otherwise-unmapped turn notifications. Stable IDs let later deltas and completion events replace the corresponding data part without losing the original App Server semantics. Completed new chats adopt the App Server thread ID in the route. Reopened chats page `thread/turns/list` with `itemsView: "full"` and pass each stored turn through the same projector, preserving status, timing, errors, item ordering, and final-answer phases instead of approximating history from a flat item list. Subsequent turns still resume the canonical App Server thread instead of replaying history. Electron main also owns harness login/logout and Codex config reads/writes. The Connections settings surface implements Codex login through ChatGPT managed browser authentication or an OpenAI API key. Grok Build, Cursor, Gemini CLI, Hermes, and OpenCode are optional ACP v1 harnesses: Electron can install the latest release into `$CYPHERIA_HOME/harnesses/<id>`, display the installed version, enable or disable the integration, and verify ACP initialization before accepting an installation. Supported V1 model provider choices are Codex-native OpenAI, Amazon Bedrock, Ollama, and LM Studio. Ollama and LM Studio can be used without OpenAI authentication. Generic custom-provider forms are intentionally deferred.

Every managed ACP harness receives a synthetic OS home plus harness-specific home variables, so its binaries, configuration, credentials, caches, and mutable state stay below the Cypheria home. Hermes always receives both `HERMES_HOME` and `HERMES_INSTALL_DIR`; its desktop package is never installed. Each successful install writes a receipt with the installer source and arguments, non-secret managed environment, detected version, executable SHA-256, and every file created or changed under that harness root. Connections owns a page-level, multi-tab PTY dock backed by `node-pty`; tabs survive switching between harness cards and Electron closes all of them when the route unmounts. See [ACP Harness Connections Design](acp-harness-connections-design.md) for upstream commands, authentication paths, update signals, and the per-harness containment contract.

Connections also owns one global proxy configuration for every agent harness. Its controls are collapsed by default. Selecting the system, direct, or manual route persists that choice immediately; the manual form shows a save action only while its fields differ from the persisted configuration. HTTP, HTTPS, or SOCKS5 routes are validated over typed IPC and stored in plaintext at `$CYPHERIA_HOME/config/proxy.json`. Electron applies the route to its connection requests, and harness child processes receive the corresponding standard proxy environment variables with loopback addresses forced into the bypass list. Saving a changed route restarts the persistent Codex process so login, model discovery, MCP, and model traffic use the same setting. API-key validation and the proxy test use Electron's network stack; the test expects the unauthenticated OpenAI models request to reach OpenAI and return its authentication response.

## Codex Integration

`apps/server` owns the Codex process, native JSON-RPC transport, generated-schema validation, reverse requests, and projection into Cypheria Threads and the Canonical Timeline. Every client—including Desktop—uses the versioned Cypheria protocol instead of connecting to Codex App Server directly. The browser-safe `@cypheria/ai-sdk-provider/codex` consumes `@cypheria/client` Thread operations and Timeline events; it never launches Codex or reads Codex files.

Codex-specific full-fidelity display data remains part of `@cypheria/protocol`: `CodexTurnProjector` snapshots, generated-image metadata, native IDs, plans, diffs, reroutes, and otherwise-unmapped events can coexist with common Timeline items. Desktop preserves its established Codex turn UI while the shared conversation shell handles drafts, attachments, streaming, cancellation, virtualization, scroll restoration, unread state, and navigation for every Agent.

Application operations such as account/login, configuration, approvals, Skills, MCP, Plugins, Marketplaces, and OpenAI Apps are Provider extensions under `client.providers.codex`; they do not pass through AI SDK. Reverse requests remain fail-closed and auditable at the Server boundary.

Codex app-server generated artifacts live inside:

```txt
packages/protocol/src/generated/codex/
  ts/      generated TypeScript
  schema/  generated and validation-adapter JSON Schemas
```

They are generated with:

```sh
pnpm codex:generate
```

Generated protocol files are committed. Do not hand-write Codex app-server protocol request, response, notification, or server request types.

## ACP AI Provider

`apps/server` owns ACP process and protocol execution. `@cypheria/ai-sdk-provider/acp` is the browser-safe AI SDK facade over `@cypheria/client`; it selects an ACP registry Agent, starts or resumes a Cypheria Thread, streams Canonical Timeline events, and cancels through the Thread API. ACP capabilities and native metadata remain available through discriminated protocol extensions without exposing the ACP SDK to clients.

## Wallet Provider And dApp Browser Boundary

Each dApp origin runs in its own isolated Electron session. dApp pages receive Ethereum and Solana wallet-provider surfaces, but requests are forwarded to Electron main and evaluated through origin-scoped permissions and signing policy.

`@cypheria/web3/provider` owns:

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

Electron main registers each created WebContents ID with its normalized origin and session key. Every Ethereum or Solana provider IPC request must match that trusted registration and the sender's current URL before it reaches `dapp.provider-request` or `dapp.solana-provider-request` in the `apps/server` runtime. The Ethereum runtime forwards a bounded allowlist of common public read-only RPC methods without wallet permission, checks unexpired origin/account/method permissions for privileged methods, audits redacted outcomes, and converts signing methods into dApp-sourced signing intents before an injected executor can complete them. The Solana runtime implements silent and interactive connection, persistent origin permissions, in-memory connection state, account/feature/chain authorization, and policy-backed signing intents for message signing, transaction signing, and sign-and-send. Main sends successful account and chain changes only to the registered dApp WebContents; preload turns them into EIP-1193 or Wallet Standard events. Renderer and dApp-supplied origin fields are never treated as authority. Desktop runtime options install either provider service only when its authorizer, dispatcher or executor is supplied; otherwise the bridge fails closed.

## Signing Flow

```txt
dApp, schedule, or agent context
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

Agents and schedules do not sign transactions directly. They create signing intents routed through Cypheria policy.

Wallet signing capabilities are account-bound and consume an intent exactly once. They require an injected policy/approval authorizer, access unlocked vault secrets only through a scoped callback, verify the derived signer and produced signature, and emit redacted audit records. Transaction broadcasting is a separate capability.

Signing policies are wallet-scoped, persisted in libSQL, and managed through a runtime service with strict schemas and optimistic revision checks. Evaluation is deterministic and falls back to human approval when conditional auto-signing has no matching allow policy. Policy changes and every evaluation result are audited.

The signing-intent runtime accepts only strict source contexts (`dapp`, `schedule`, or `agent`), assigns the intent ID and creation time itself, evaluates policy before persistence, and stores the exact canonical payload plus its hash in libSQL. Human decisions update `approval_requests` and `signing_intents` together through a libSQL atomic batch guarded by an optimistic revision. Approval IPC exposes the exact intent needed for informed review but never vault material. Audit entries contain only the payload hash and a redacted summary.

## Schedule Flow

```txt
once, interval, or cron cadence / manual run
  -> Server ScheduleService
  -> atomic SQLite lease and next-run advance
  -> ThreadManager or policy-controlled Web3 executor
  -> signing intent for write operations
  -> PolicyEngine
  -> approval or policy decision
  -> persisted run result and audit record
```

`apps/server` owns schedules and exposes them only through the versioned Cypheria protocol. A schedule may start a new Agent thread, continue an existing Thread, or invoke a bounded Web3 method. Definitions support one-time, fixed-interval, and five-field cron cadence. Before execution, the Server atomically claims the due slot and advances the next-run state, preventing duplicate execution across timer overlap or restart recovery.

Runs persist their target type, scheduled time, status, result, error, and created Thread ID. On restart, stale running records become `interrupted`; an in-flight Web3 signature or broadcast is never replayed. Desktop and CLI use `@cypheria/client` for list, create, update, pause, resume, delete, manual-run, and history operations. Cloud Agent execution and a general workflow engine remain out of scope.

## Data Model

SQLite is the local source of truth for non-secret data. Drizzle accesses a local `file:` database through the libSQL SQLite entry point; this does not require or imply a remote Turso/libSQL service. Sensitive wallet material belongs in an encrypted vault protected by OS-backed key storage.

The wallet domain and vault design are specified in `docs/wallet-management.md`.

Current core tables:

```txt
settings
audit_logs
workspaces
runtime_metadata
schedules
schedule_runs
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
- Codex and schedule flows create signing intents, not direct signatures.
- Every signing intent goes through `@cypheria/web3/policy`.
- Auto-signing is disabled by default.
- Every policy decision, signature, rejection, schedule run, and transaction hash is auditable.

## Package Boundaries

```txt
apps/server/src/runtime
  Private Server runtime host and Web3 service orchestration; not a client dependency.

@cypheria/protocol
  Versioned, transport-neutral Cypheria client/server contracts and Zod validation.

@cypheria/client
  Layered WebSocket protocol driver, borrowed API facade, and connection-owning client.

@cypheria/sdk
  Planned public TS client for the Cypheria server protocol.

apps/server Codex adapter
  Server-owned Codex App Server transport, validation, reverse requests, and event normalization.

@cypheria/ai-sdk-provider/acp
  Browser-safe AI SDK provider backed by the Cypheria client and Canonical Timeline.

@cypheria/web3/network
  Canonical chain identities, strict network/RPC models, catalog entries, and protocol conversion helpers.

apps/desktop/ipc
  Desktop-local typed Electron IPC contracts, schemas, channel names, and envelopes.

@cypheria/web3/wallet
  Wallet domain types, accounts, chain-account bindings, permissions, and signing intents.

@cypheria/web3/policy
  Signing policy schemas, evaluator, and policy decisions.

@cypheria/web3/provider
  dApp session, provider bridge, and browser permission models.

@cypheria/db
  SQLite schema, migrations, and local persistence helpers.

@cypheria/ui
  Shared UI primitives and Cypheria product components.
```

## Network And RPC Boundary

Chain identity, network metadata, RPC connectivity, and active selection are separate concepts. Wallet accounts and historical records retain canonical chain identity independently from whether a network is currently configured. `@cypheria/web3/network` owns strict EVM and Solana identity and configuration schemas; the `apps/server` runtime owns catalog reconciliation, endpoint probes, credential resolution, health-aware routing, and workspace or origin-scoped selection.

RPC connection secrets are protected outside normal SQLite columns and never cross renderer or dApp IPC. Read-only calls may fail over across verified endpoints, while broadcasts are never blindly retried after an ambiguous response. Custom destinations are subject to SSRF controls, and a dApp can switch only its own origin-scoped provider context after approval.

The complete model, persistence plan, routing rules, and implementation sequence are defined in `docs/network-management.md`.

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
