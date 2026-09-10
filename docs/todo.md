# Cypheria Development Todo

This todo tracks implementation work at a reviewable granularity. Each item should be meaningful, testable, and commit-sized.

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

## Foundation Already In Place

- [x] Reinstall and adapt all AI Elements components for the Nova shared primitives.
  - Acceptance: all 48 registry components are regenerated; existing compatibility and safety adaptations are retained; tooltip/context triggers avoid nested interactive elements; state styles target Base UI attributes.
  - Verification: `pnpm run ci`, `pnpm build`, UI/desktop tests including Nova interaction regressions.

- [x] Switch the shared shadcn component set to `base-nova`.
  - Acceptance: UI and desktop registry configs use Nova; all registry components are reinstalled, compatibility adaptations are retained, and primary controls use the standard UI font size without changing application-level overrides.
  - Verification: `pnpm run ci`, desktop build, UI and desktop tests.

- [x] Initialize Turborepo + pnpm monorepo.
  - Acceptance: root scripts, workspace packages, TypeScript base config, Biome, Turbo pipeline, and lockfile are present.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add project README, architecture, technical stack, todo docs, and agent instructions.
  - Acceptance: English primary docs and `.zh-CN.md` companion docs exist.
  - Verification: `pnpm run ci`.

- [x] Add runtime home resolution.
  - Acceptance: `@cypheria/runtime` resolves `$CYPHERIA_HOME`, defaults to `~/.cypheria`, and derives `CODEX_HOME=$CYPHERIA_HOME/codex`.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add runtime directory initialization.
  - Acceptance: runtime package can explicitly create all Cypheria-owned runtime directories.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add Electron main runtime bootstrap helper.
  - Acceptance: desktop main package initializes runtime directories before creating windows.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add Electron + TanStack Start desktop shell.
  - Acceptance: desktop has a runnable Electron main process, preload bridge baseline, and TanStack Start renderer shell with sidebar navigation.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Establish the Cypheria brand asset system.
  - Acceptance: SVG remains the editable source of truth; Electron window/Dock icons, browser favicon, and cross-platform packaging derivatives share the approved mark and documented usage rules.
  - Verification: `pnpm --filter @cypheria/desktop brand:generate`, desktop checks/build, and visual inspection at favicon and application-icon sizes.

- [x] Add typed IPC contract and router baseline.
  - Acceptance: desktop-local IPC contracts define initial app/runtime contracts and desktop main validates handler inputs/outputs.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add database, audit, wallet, policy, Web3 browser, automation, Codex bridge, and UI baselines.
  - Acceptance: domain packages contain initial types/services/tests for their V1 boundaries.
  - Verification: `pnpm run ci`, `pnpm build`, package-level tests where present.

## Architecture Alignment

- [x] Add the Cypheria client/server foundation without migrating desktop.
  - Acceptance: `apps/server` provides a Hono HTTP/WebSocket control plane, versioned client sessions, runtime lifecycle, operations endpoints, supervised daemon lifecycle, and embedded Expo web hosting; `apps/expo` targets iOS, Android, and static web; `@cypheria/protocol` provides shared validated contracts.
  - Exclude: agent, project, wallet, policy, browser, and automation product methods; any `apps/desktop` code change.
  - Verification: protocol/server/Expo tests and typechecks, Expo compatibility check and static export, server build and embedded-web smoke test, daemon start/status/restart/stop smoke test, full repository CI/build.

- [ ] Migrate desktop to the Cypheria server after explicit review.
  - Acceptance: Electron main ensures the local supervised server is running, desktop uses the shared protocol, and Electron-only dApp/browser, secure-storage, approval, preload, and OS-integration boundaries remain intact.
  - Prerequisite: explicit approval of the server foundation; do not begin as part of the foundation change.

- [x] Rewrite docs for the server and multi-client target architecture.
  - Acceptance: README, architecture, technical stack, todo docs, and `AGENTS.md` describe the current target architecture only.
  - Include: no `@cypheria/codex-protocol`, clients share `@cypheria/protocol`, server owns runtime in the target architecture, desktop migration is explicitly staged, and generated Codex app-server TS remains inside `@cypheria/codex-bridge`.
  - Verification: `pnpm run ci`, `pnpm build`.

## Runtime

- [x] Expand `@cypheria/runtime` into the Cypheria runtime host.
  - Acceptance: package exports `CypheriaRuntime` with `start()`, `stop()`, `request()`, and `events()` methods.
  - Include: service registry, lifecycle state, runtime info handler, runtime event envelope, and clean shutdown.
  - Keep: existing home/path resolution exports.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/runtime test`.

- [x] Move Cypheria-owned service orchestration behind runtime.
  - Acceptance: runtime can wire database, audit, automation, policy, wallet domain, and browser domain service boundaries without importing desktop renderer code.
  - Include: clear method namespaces for `runtime.*`, `wallet.*`, `chain.*`, `policy.*`, `browser.*`, `dapp.*`, `automation.*`, `audit.*`, and `settings.*`.
  - Verification: `pnpm run ci`, `pnpm build`, runtime and affected package tests.

- [x] Adapt existing desktop bootstrap to the runtime host.
  - Acceptance: Electron main initializes `CypheriaRuntime`, reads runtime info through the runtime request path, and shuts the runtime down during app quit.
  - Include: desktop bootstrap tests and explicit database path wiring that does not reintroduce a db-to-runtime dependency.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/desktop test`.

## SDK

- [ ] Add `packages/sdk`.
  - Acceptance: package exports a public `Cypheria` server client.
  - Include: clients for runtime, wallet, policy, automation, and agent.
  - Agent path: use versioned server operations and events.
  - Must not import: `apps/cli`, `apps/desktop`, Electron, `@cypheria/runtime`, or `@cypheria/codex-bridge`.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/sdk test`.

- [ ] Add SDK test doubles for runtime and Codex SDK.
  - Acceptance: SDK tests can run without launching Codex or Electron.
  - Include: fake runtime client and fake agent thread.
  - Verification: `pnpm --filter @cypheria/sdk test`.

## CLI

- [ ] Add `apps/cli`.
  - Acceptance: package builds a `cypheria` Node CLI with no TUI.
  - Include: argument parsing, server connection/configuration, readable output, JSONL output mode, and non-zero failure exits.
  - Dependencies: `@cypheria/protocol` plus a Node transport.
  - Must not import: `@cypheria/sdk`, `@cypheria/runtime`, Electron, desktop packages, or `@cypheria/codex-bridge`.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/cli test`.

- [ ] Implement initial CLI commands.
  - Acceptance: `cypheria run`, `cypheria run --jsonl`, `cypheria runtime info`, `cypheria wallet list`, `cypheria policy list`, `cypheria automation run <task-id>`, and `cypheria doctor` are wired to server operations.
  - Verification: CLI unit tests and command smoke tests.

## Marketplace

- [x] Research and specify `apps/marketplace`.
  - Acceptance: paired documents define an OpenAI-like submission/review/publication platform, mandatory ChatGPT/Codex compatibility, GitHub-only open-source `url`/`git-subdir` sources, deterministic official repo synchronization, App Server installation, Cloudflare boundaries, security, and delivery sequence.
  - Verification: paired-document review and `pnpm run ci`.

- [ ] Scaffold the TanStack Start marketplace Worker.
  - Acceptance: `@cypheria/marketplace` builds and previews with the official Cloudflare Vite integration, a custom Worker entrypoint, locale-prefixed SSR routes, shared UI primitives, D1 migrations, typed bindings, and local tests.
  - Must not import: Electron, desktop IPC, `@cypheria/runtime`, `@cypheria/codex-bridge`, or `@cypheria/db`.
  - Verification: marketplace tests/typecheck/build/type generation, `pnpm run ci`, and `pnpm build`.

- [ ] Implement marketplace identity, organizations, authorization, and publisher verification.
  - Acceptance: OIDC sessions, organizations, scoped roles, publisher identities, domain/organization evidence, step-up actions, CSRF protection, rate limits, and append-only audit events are enforced server-side.
  - Verification: role matrix, cross-organization isolation, session/CSRF, identity challenge, rate-limit, and audit tests.

- [ ] Implement GitHub source verification, plugin drafts, validation, and submission.
  - Acceptance: only public GitHub `url` and `git-subdir` sources with immutable SHA, a valid ChatGPT/Codex plugin tree, verified publisher relationship, and an OSI-approved license covering the plugin path are accepted; submission freezes an immutable source revision.
  - Verification: repository visibility, ownership, SHA/ref, path containment, submodule/LFS, license coverage, schema, size, stale-scan, and submission-state tests.

- [ ] Implement scanning and the reviewer workflow.
  - Acceptance: bounded static and MCP scans run through Queues and durable Workflows; reviewers inspect immutable evidence and can request changes, reject, or approve without automatic publication.
  - Verification: SSRF/rebinding/redirect, secret, schema, annotation, timeout, idempotency, workflow-resume, authorization, and decision-audit tests.

- [ ] Implement publication and the public marketplace API.
  - Acceptance: explicit publication deterministically regenerates the protected official GitHub repo's `.agents/plugins/marketplace.json` with SHA-pinned `url`/`git-subdir` entries, verifies the resulting commit, then exposes the release and catalog commit through localized routes and `/api/v1`.
  - Verification: schema, stable ordering, expected-head race, GitHub failure, read-after-write, outbox recovery, reconciliation, suspension, withdrawal, and rollback tests.

- [ ] Add the Cypheria Marketplace discovery/trust provider to Desktop.
  - Acceptance: Electron main fetches the paginated Cypheria API, pins the official repository identity, registers/upgrades it through `marketplace/add`/`marketplace/upgrade`, verifies the expected catalog commit and source URL/path/SHA, obtains capability/permission approval, and installs through `plugin/install`.
  - Verification: repository identity, catalog freshness, source mismatch, approval/rejection, install, update, uninstall, advisory, audit receipt, and renderer-boundary tests.

- [x] Review existing Desktop support for other ChatGPT/Codex plugin sources.
  - Acceptance: documentation maps the implemented generated App Server operations, treats `plugin/list.marketplaces` as the discovery boundary, classifies official identities with exact-name allowlists, and treats every other marketplace as Personal.
  - Verification: source and protocol review of Desktop main, IPC, renderer, tests, and generated App Server types.

- [x] Add desktop-owned sidebar collapse motion and hover previews.
  - Acceptance: native window controls remain fixed; the sidebar fully retracts, collapsed controls and the chat title move together, and hover previews do not resize content. Shared UI primitives remain unchanged.
  - Verification: desktop typecheck/build, Biome, and Electron visual checks.

## Desktop Codex App Server Bridge

- [x] Specify Codex Desktop-style permissions over App Server.
  - Acceptance: paired documents define the exact Codex permission-profile, legacy sandbox, approval-policy, reviewer, managed-requirement, approval-request, and Auto-review semantics without extending them into Cypheria Web3 permissions.
  - Include: official OpenAI documentation, generated App Server types, installed Desktop bundle evidence, current-gap analysis, wire mappings, delivery sequence, and testable completion criteria.
  - Verification: paired-document review and generated-protocol comparison with the installed `codex-cli 0.153.4`.

- [x] Add Codex permission discovery and selection to Desktop.
  - Acceptance: the composer resolves standard modes, named profiles, custom config, and managed defaults from App Server config, requirements, profiles, model capability, and cwd; new, resumed, and updated tasks preserve the effective choice.
  - Include: typed IPC, pagination, requirements filtering, profile-versus-sandbox mutual exclusion, Full access confirmation, invalidation, and native Windows readiness.
  - Verification: bridge and desktop tests for standard, named, custom, managed, resume, update, stale selection, pagination, and platform cases; `pnpm run ci`, `pnpm build`.

- [x] Complete Codex approval and Auto-review parity.
  - Acceptance: command, file, and additional-permission approvals use method-specific typed projections and generated decisions; subset grants and scopes work; Auto-review lifecycle, strict review, and exact denied-action retry are visible and fail closed.
  - Include: `availableDecisions`, policy amendments, network-specific prompts, resolved-event reconciliation, disconnect/timeout cleanup, and current reviewer-alias compatibility.
  - Verification: broker, IPC, renderer, lifecycle, and real App Server tests; `pnpm run ci`, `pnpm build`.

- [x] Preserve and render complete Codex turns through the AI SDK UI stream.
  - Acceptance: live and hydrated chats share one turn projector; the live stream preserves all turn-scoped updates, while hydration faithfully projects the full durable App Server turn snapshot; turn timing/status, item lifecycle and full generated item payloads, commentary/final-answer phases, reasoning, tools, plans, diffs, model reroutes, and terminal progress remain available to the renderer whenever supplied by App Server; the conversation UI groups and collapses agent activity separately from the final answer in the Codex Desktop style.
  - Include: typed AI SDK data parts reconciled by turn/item ID, provider metadata on compatible standard parts, reusable turn projection tests, AI Elements-based activity rendering, and paired English/Chinese architecture documentation.
  - Verification: codex-bridge and desktop tests/typechecks, renderer build, `pnpm run ci`, and `pnpm build`.
  - Verification note: 29 codex-bridge tests, 89 desktop tests (including live UI-stream reconciliation), strict localization compilation, full repository CI, full repository build, and a packaged-renderer desktop smoke test of restored turn grouping/collapse all pass.

- [x] Complete the Codex App Server capability and interaction bridge.
  - Acceptance: the AI SDK V4 provider preserves every compatible text, reasoning, media, source, tool, usage, metadata, error, and control surface; experimental App Server APIs are enabled; application-level thread, review, account, plugin, skill, MCP, terminal, and configuration operations remain direct typed bridge services; reverse JSON-RPC requests use a fail-closed desktop interaction broker with typed IPC and auditable user decisions.
  - Include: token usage, audio, generated files, web sources, progress results, resume inheritance, stream failure handling, dynamic tools, approvals, user input, MCP elicitation, and paired English/Chinese architecture documentation.
  - Verification: bridge and desktop protocol tests, interaction and renderer-boundary tests, `pnpm run ci`, and `pnpm build`.
  - Verification note: experimental protocol generation, 26 bridge tests, 77 desktop tests, renderer production build, full repository CI, and full repository build pass.

- [x] Add the desktop internationalization foundation with Lingui.
  - Acceptance: Electron resolves automatic detection and persists explicit choices as `[desktop].localeOverride` in the managed Codex `config.toml`; the renderer hydrates the prerendered shell deterministically, then activates the matching Lingui catalog, switches reactively without a reload, and synchronizes `lang`/`dir`; the desktop shell and language setting are localized.
  - Include: a searchable Codex-style picker in General settings containing every reference language, English fallback for selections without a bundled catalog, typed bootstrap and settings IPC, locale/TOML preservation tests, committed PO catalogs, extraction/compile scripts, and paired architecture/technical-stack documentation.
  - Verification: `pnpm run ci`, `pnpm build`, and `pnpm --filter @cypheria/desktop test`.
  - Verification note: `pnpm run ci`, build, desktop tests, strict catalog compilation, and all Turbo checks pass.

- [x] Regenerate Codex app-server TypeScript into `@cypheria/codex-bridge`.
  - Acceptance: generated files live in `packages/codex-bridge/src/generated` and are committed.
  - Command: `codex app-server generate-ts --experimental --out packages/codex-bridge/src/generated`.
  - Include: package script to regenerate the files during explicit Codex upgrades.
  - Must not create: `@cypheria/codex-protocol`.
  - Verification: `pnpm --filter @cypheria/codex-bridge check`.

- [x] Refactor `@cypheria/codex-bridge` to use generated app-server types.
  - Acceptance: bridge uses generated request, response, notification, and server request types instead of hand-written Codex app-server protocol types.
  - Include: WebSocket transport, initialize/initialized handshake, request/response correlation, notification stream, server request routing, disconnect handling, and overload retry handling.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/codex-bridge test`.

- [x] Update desktop to use persistent Codex App Server over WebSocket.
  - Acceptance: Electron main starts Codex App Server with `CODEX_HOME=$CYPHERIA_HOME/codex`, connects through `@cypheria/codex-bridge`, and exposes Codex events to renderer through typed IPC.
  - Include: localhost port selection, process lifecycle, readiness, shutdown, stderr logging, and renderer-safe event mapping.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/desktop test`, local desktop smoke test when Codex is available.

- [x] Pin the Codex App Server runtime and generated protocol version.
  - Acceptance: the workspace and desktop use an exact `@openai/codex` version; protocol generation resolves that workspace binary; desktop rejects mismatched binaries before startup.
  - Include: development package resolution, explicit `CYPHERIA_CODEX_PATH` override, and packaged sidecar resolution from Electron resources.
  - Verification: `pnpm codex:version`, `pnpm run ci`, `pnpm build`, and desktop tests.

- [x] Add the chat-centered desktop workspace, harness connections, and native model settings.
  - Acceptance: the sidebar lists projects and recent threads; the main workspace streams AI SDK UI messages through App Server; Connections is structured for multiple agent harnesses and implements Codex login with ChatGPT managed authentication and validated OpenAI API keys; model settings support OpenAI, Bedrock, Ollama, and LM Studio.
  - Include: a global system/direct/manual proxy stored at `$CYPHERIA_HOME/config/proxy.json`, HTTP/HTTPS/SOCKS5 support, connection testing, harness restart on proxy changes, unauthenticated local-model use, chat interruption, model/reasoning/service-tier controls, automation supervision, isolated dApp launch, approval and plugin/skill workbench routes, and client-only route shells for Electron builds.
  - Exclude: generic custom providers and OpenCodex integration until the provider strategy is decided.
  - Verification: `pnpm run ci`, `pnpm build`, and `pnpm --filter @cypheria/desktop test`.

- [x] Align the chat workspace with the installed ChatGPT desktop workbench.
  - Acceptance: the conversation header and full-featured composer match the desktop interaction model; long conversations use TanStack Virtual without breaking live turn growth, history hydration, or follow-to-bottom behavior; the right panel is independently resizable; and a resizable bottom panel provides persistent multi-tab PTY terminals, a dedicated title-bar toggle, and `Cmd/Ctrl+J` independently from the terminal action.
  - Include: rigorous comparison of user and assistant turn presentation, panel chrome and empty states, project-scoped terminal IPC that does not accept renderer-chosen filesystem paths, and reuse of shadcn/ui and AI Elements where they fit.
  - Verification: 162 desktop tests, desktop typecheck/build, full repository CI/build, and clean Electron interaction smoke tests against ChatGPT Desktop 26.901.51231 covering the composer, scope-owned prompt drafts restored across navigation and renderer restart, scope-owned session attachments retained across navigation and released on removal/submission/LRU eviction, source-matched image-only/mixed clipboard routing and 5,000-character pasted-text cards whose complete UTF-8 contents reach initial, steering, and queued turns, the source-matched 768-pixel shared content column on Chromium's 16-pixel rem baseline with independently tokenized 14-pixel UI typography, including a persisted 14→16→14 Appearance smoke test that kept `48rem` at 768 pixels, model-gated media inputs including an image-only system-clipboard screenshot whose unique visual marker reached the selected model, single-interrupt transport cleanup, immediate stopped-state projection, inline rename, a dedicated bottom-panel control and `Cmd/Ctrl+J`, a separate `Control+Backquote` terminal action with default bottom/right placement, source-matched scrollable tabs with a fixed add-tab control, last-tab close retaining an empty dock until its `Close` action and explicit hidden-empty reopen creating the fallback terminal, bottom-panel hide/reopen retaining the same Xterm DOM, terminal output, and manually resized pixel height, conversation navigation retaining the open dock, PTYs, active tab, height, and replayed output, bounded and deduplicated PTY resizing in the tall right panel, token-backed terminal theming and packaged-source-matched Xterm scrollbars, cold-open bottom following, exact cross-thread anchor restoration in a media-heavy thread, instant return-to-bottom, macOS close/reopen renderer retention, background turn completion across route navigation, pending-question recovery after leaving and returning to a chat, restricted cold-restored generated-image loading without arbitrary local-file access, bounded persisted sidebar unread-state behavior, and source-matched sidebar width constraints. A fresh same-model, same-prompt item-coverage turn also completed through command failure, two file-change approvals, TypeScript validation, web search, cleanup, and final Markdown rendering; after a cold renderer restart its collapsed activity restored the plan, commentary, commands, file edits, and web-search items from the durable App Server turn.

- [x] Match Codex Desktop sidebar organization and section controls.
  - Acceptance: Pinned and chat sorting, project and one-list organization, project creation, custom section lifecycle, section-scoped new chats, and Recents new-chat controls work through the compact Codex-style section headers and menus.
  - Include: generated experimental App Server section methods behind typed IPC, persisted non-sensitive sidebar preferences, virtualized custom section rows, and workbench-relative right-panel sizing.
  - Verification: desktop typecheck/tests/build plus a real Electron visual and interaction smoke test against the supplied Codex Desktop references.

- [x] Complete ChatGPT Desktop sidebar menus for projects, sections, and chat rows.
  - Acceptance: project and chat rows expose the applicable pin, rename/edit, mark read/unread, move, copy, fork, archive, remove, and new-chat actions; active rows use archive instead of permanent deletion; custom sections archive their chats; destructive actions require confirmation; and every mutation refreshes the affected virtualized sidebar groups.
  - Include: App Server-owned thread/project/section mutations behind typed IPC, bounded renderer-owned unread state for metadata App Server does not expose, priority/update/creation/manual sorting, Cypheria namespaced project sidebar metadata, and safe project-folder reveal resolved in Electron main from a project identifier.
  - Verification: desktop tests/typecheck/build, full repository CI/build, and a real Electron smoke test of reversible actions plus disposable archive/delete flows against ChatGPT Desktop 26.901.51231.

- [x] Close the feasible ChatGPT Desktop settings gaps.
  - Acceptance: settings navigation is grouped and searchable with the desktop keyboard shortcut; archived App Server chats can be searched, restored, or permanently deleted with confirmation; and the result is verified in the real Electron app.
  - Include: generated `thread/unarchive` behind typed IPC, a cursor-backed archived-chat settings route, localized navigation/search states, and explicit deferral of account, notification, personalization, voice, storage, and updater controls that depend on ChatGPT services or unimplemented desktop infrastructure.
  - Verification: strict 291-message English/Chinese catalog compilation, desktop typecheck, 111 desktop tests, desktop and full repository builds, full repository CI, and a real Electron create/archive/search/restore/re-archive/delete smoke flow against ChatGPT Desktop 26.901.51231.

- [x] Add managed ACP harness installation and Connections terminal sessions.
  - Acceptance: Grok Build, Cursor, Gemini CLI, Hermes, and OpenCode install their latest release below `$CYPHERIA_HOME`, expose installed version and enablement, pass an ACP v1 initialization check, and can open concurrent page-level terminal tabs that close when Connections unmounts.
  - Include: typed IPC, harness-specific homes, global proxy propagation, Hermes `HERMES_HOME`/`HERMES_INSTALL_DIR` containment without its desktop package, and auditable install receipts containing changed files and executable hashes.
  - Verification: desktop typecheck/tests/build plus a real Electron Connections smoke check.

- [x] Add the `@cypheria/acp-ai-provider` ACP-to-AI-SDK bridge.
  - Acceptance: the package uses the official ACP 1.4 app API, launches or connects to ACP agents, and exposes native AI SDK 7 `LanguageModelV4` streaming/generation plus the ACP callback, lifecycle, configuration, control, transport, event, and draft-v2 surfaces.
  - Include: capability-aware content conversion, safe default permission cancellation, filesystem/terminal/elicitation/ACP-MCP handlers, session and experimental controls, usage/provider metadata preservation, upstream provenance and commit pinning in paired package READMEs, the upstream MIT notice, and source plus protocol-level Vitest coverage.
  - Verification: package typecheck/tests, workspace CI, and workspace build.
  - Deferred: real Codex ACP, Gemini ACP, and Claude ACP process interoperability tests.

- [x] Complete the desktop Web3 management loop and production renderer startup.
  - Acceptance: wallet creation/import/watch management, active account context, vault lock state, signing policies, pending approval decisions, and audit records are usable through typed IPC-backed screens.
  - Include: OS-backed desktop vault key storage, one-shot secret submission without renderer persistence, a two-level virtualized wallet/account manager with durable drag ordering and HD account derivation, pending counts in the sidebar, packaged SPA routing through the privileged `cypheria://` scheme, bundled libSQL native resolution, and copied database migrations.
  - Verification: all workspace tests, `pnpm run ci`, `pnpm build`, and real Electron smoke checks of the chat workspace and wallet route.

- [x] Implement the desktop plugin and skill management loop.
  - Acceptance: the workbench lists and searches App Server marketplaces and skills; installs, uninstalls, enables, and disables plugins; enables and disables skills; and adds or upgrades marketplace sources through typed IPC.
  - Include: renderer-safe Zod projections, source and installed filters, partial-load errors, loading and empty states, isolated Codex home ownership, and a paired evidence-based design note.
  - Verification: desktop IPC and service tests, `pnpm run ci`, `pnpm build`, and visual comparison against the official desktop reference.

- [x] Rework plugin discovery, details and core management against the supplied desktop screenshots.
  - Include: installed icon rail, flat search mode, borderless rows, context menus, conditional detail sections, composer drafts and a separate settings route.
  - Verification: 38 desktop tests, workspace checks, renderer build and browser detail/composer checks. Full visual parity remains open in `design-qa.md`.
- [x] Add Apps/MCP management and truthful runtime availability to plugin settings.
  - Include: five count tabs, app enablement and external connection pages, MCP inventory/tools, standalone server enablement and HTTP addition, OAuth completion notifications, and partial-state handling.
  - Verification: 47 desktop tests, workspace checks, desktop build, browser switch/search/form tests, and normalized screenshot comparison at desktop and narrow widths.
- [x] Preserve marketplace source provenance and add guarded local marketplace removal.
  - Include: Public/OpenAI/Personal discovery from returned marketplace records and trusted allowlists, one section per personal marketplace, removal confirmation and main-process revalidation. Installed plugins must be explicitly uninstalled first.
  - Verification: desktop service/type checks and browser preview cancellation/removal/source filtering. Real user marketplaces were not removed.
- [ ] Complete remaining plugin desktop parity: skill recording and remaining screenshot states. Verify live authenticated connector authorization in Electron.

## Runtime Web3 Capabilities

- [x] Specify the network and RPC architecture.
  - Acceptance: English and Chinese design documents analyze the Archmage-X precedent and define canonical chain identity, package boundaries, catalog reconciliation, persistence, protected RPC credentials, endpoint probing/routing, origin-scoped dApp selection, failure semantics, and V1 exclusions.
  - Verification: paired-document review, `pnpm run ci`.

- [x] Add `@cypheria/network-core` and the bundled network catalog.
  - Acceptance: strict EVM and Solana chain identity, network, explorer, endpoint, public projection, and protocol-conversion schemas replace untyped or mixed chain identifiers.
  - Include: stable IDs, canonical chain keys, immutable identity, URL normalization, minimal reviewed built-ins, and catalog fixtures.
  - Verification: network-core tests, `pnpm run ci`, `pnpm build`.

- [x] Persist network configuration and protect RPC credentials.
  - Acceptance: libSQL stores networks, ordered endpoints, revisions, and origin-scoped contexts while protected connection material remains outside ordinary columns under `$CYPHERIA_HOME/config/network-credentials`.
  - Include: migrations, catalog reconciliation, redacted projections, optimistic concurrency, non-cascading wallet/history behavior, and OS-backed credential protection.
  - Verification: database, credential-store, migration, and recovery tests; `pnpm run ci`, `pnpm build`.

- [x] Implement the runtime network manager and RPC router.
  - Acceptance: runtime probes endpoint identity, tracks disposable health, selects purpose-compatible endpoints, retries only safe reads, preserves operation stickiness, and reports ambiguous broadcasts without blind retry.
  - Include: SSRF destination policy, DNS/redirect checks, timeouts, response and concurrency bounds, redacted audit, and stable network errors.
  - Verification: runtime unit and integration tests with local fake EVM and Solana RPC servers; `pnpm run ci`, `pnpm build`.

- [x] Migrate wallet, policy, automation, and dApp boundaries to canonical chain identity.
  - Acceptance: chain accounts, active wallet context, signing intents, policies, automation scopes, permissions, and events use `ChainIdentity`/`ChainKey`; active network identity must match the selected chain account.
  - Include: data migrations and compatibility adapters for EIP-1193 hexadecimal IDs and Solana Wallet Standard identifiers.
  - Verification: wallet-core, policy-engine, automation-core, wallet-provider, database, runtime, and desktop IPC tests.

- [x] Add origin-scoped network add/switch flows and desktop management UI.
  - Acceptance: each dApp origin selects Ethereum and Solana networks independently; EIP-3085 add and EIP-3326 switch requests require validated probes and approval; desktop manages network and endpoint ordering, enabled state, health, and redacted credentials.
  - Include: typed IPC, provider events emitted only after successful selection changes, built-in disable/custom delete behavior, and approval metadata diffs.
  - Verification: runtime, desktop, provider, and real sandboxed Electron tests; `pnpm run ci`, `pnpm build`.

- [x] Adopt Drizzle with libSQL as the local database adapter and specify the wallet architecture.
  - Acceptance: database services use `@libsql/client` instead of `better-sqlite3`; persistence APIs are asynchronous; English and Chinese wallet design documents define public data, encrypted vault, memory, and signing boundaries.
  - Verification: `pnpm run ci`, `pnpm build`, database and desktop tests.

- [x] Replace the wallet domain baseline.
  - Acceptance: `@cypheria/wallet-core` models HD, private-key, private-key-group, watch, and watch-group wallets independently from storage concerns; wallet kind determines vault and read-only capabilities.
  - Include: Zod boundary schemas, stable identifiers, wallet/account/chain-account hierarchy, fingerprints, lifecycle states, derivation schemes, and renderer-safe projections.
  - Verification: `pnpm --filter @cypheria/wallet-core test`, `pnpm run ci`, `pnpm build`.

- [x] Add wallet public-state persistence.
  - Acceptance: `@cypheria/db` persists wallets, wallet accounts, chain accounts, and HD derivation schemes through Drizzle and libSQL without secret material.
  - Include: migrations, constraints, repository APIs, recovery states, and in-memory database tests.
  - Verification: `pnpm --filter @cypheria/db test`, `pnpm run ci`, `pnpm build`.

- [x] Implement the encrypted wallet vault.
  - Acceptance: wallet secrets are stored as per-wallet atomic vault files under `$CYPHERIA_HOME/vault`, encrypted with per-entry keys rooted in OS-backed key storage, and decrypted only into runtime memory.
  - Include: narrow ethers Web3 Secret Storage codec, key-provider abstraction and test double, atomic writes, orphan recovery, lock, unlock, delete, and redacted errors.
  - Verification: wallet vault tests, `pnpm run ci`, `pnpm build`.

- [x] Implement vault and watch wallet management.
  - Acceptance: runtime can generate/import HD wallets, import single/grouped private keys, manage single/grouped watch wallets, derive EVM accounts with viem, detect duplicates, list renderer-safe state, and expose active account context.
  - Include: fast generated-wallet initialization, durable-before-success imports, address consistency checks, rename/delete, and audit events.
  - Verification: runtime, wallet, database, and vault tests.

- [x] Connect wallet signers to the signing-intent pipeline.
  - Acceptance: callers receive signing capabilities rather than secret material; every message, typed-data, and transaction signature is bound to an approved intent and audited.
  - Include: viem signing adapters, signer/address consistency checks, lock behavior, replay protection, and no private keys in renderer, dApp, agent, or automation contexts.
  - Verification: runtime, policy, wallet, and desktop IPC tests.

- [x] Implement policy runtime service.
  - Acceptance: runtime can list, validate, create, update, disable, and evaluate signing policies.
  - Verification: runtime and policy-engine tests.

- [x] Implement signing intent and approval runtime flow.
  - Acceptance: dApp, automation, and agent contexts can create signing intents; each intent is evaluated by policy and auditable.
  - Verification: runtime, policy, db, and desktop IPC tests.

- [x] Implement wallet-provider and dApp browser runtime service.
  - Acceptance: desktop can create origin-isolated dApp sessions; expose and discover Ethereum and Solana providers; persist protocol-scoped permissions; forward common Ethereum read-only RPC; deliver scoped provider events; and route EVM or Solana signing through policy-backed intents and injected executors.
  - Verification: wallet-provider, database, runtime, desktop controller, and real sandboxed Electron discovery tests.

- [x] Implement automation runtime service.
  - Acceptance: runtime can create, list, run, pause, resume, and inspect automation tasks and runs.
  - Include: tasks may call Codex SDK or create signing intents but cannot bypass policy.
  - Verification: automation-core, db, runtime, and desktop tests.

## Review Rule

After each todo item is completed:

- Stop and request user review before starting the next item.
- Run the relevant verification commands.
- Update English and Chinese docs for behavior, architecture, command, public interface, package boundary, or runtime path changes.
- Keep commits focused on the completed item.
