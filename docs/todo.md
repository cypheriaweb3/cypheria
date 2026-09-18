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
  - Acceptance: the `apps/server` runtime resolves `$CYPHERIA_HOME`, defaults to `~/.cypheria`, and derives `CODEX_HOME=$CYPHERIA_HOME/codex`.
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

- [x] Add database, audit, wallet, policy, Web3 browser, schedule, Codex bridge, and UI baselines.
  - Acceptance: domain packages contain initial types/services/tests for their V1 boundaries.
  - Verification: `pnpm run ci`, `pnpm build`, package-level tests where present.

## Architecture Alignment

- [x] Expand the canonical timeline and client domain facades for multi-agent Desktop migration.
  - Acceptance: shared command, diff, approval, artifact, status, and provider-extension items retain provider provenance; integrations can classify native versus ACP compatibility; client exposes direct plural Agent, Project, Section, Thread, and Timeline facades while retaining temporary compatibility aliases.
  - Verification: protocol, client, and server tests and typechecks.

- [x] Add the Cypheria E2EE relay application and shared relay package.
  - Acceptance: `apps/relay` is a Go 1.25 service with `--mode=single|cluster` and cluster-only
    `--role=gateway|worker`; v2 control and
    per-client data sockets forward opaque E2EE frames; `@cypheria/relay` supplies transport-neutral
    X25519/XSalsa20-Poly1305 channels; protocol offers, shared client support, and the authenticated
    server pairing endpoint form one working path.
  - Include: standalone single-process memory mode without etcd, coordinated etcd leases and
    rendezvous ownership, internal mTLS, bounded ingress/queues, container-aware memory limits,
    OTLP/gRPC metrics and short spans without a Prometheus endpoint, persistent `0600` server keys,
    strict TOML configuration with examples, Kubernetes Kustomize manifests, documented
    connection/deployment diagrams, and a future home-region/global fencing design.
  - Exclude: Desktop/Expo UI integration, live deployment validation, etcd/Collector deployment,
    and implementation of the global coordinator.
  - Verification: protocol/relay/client/server Vitest suites, Go unit/real-WebSocket/embedded-etcd/
    mTLS/OTel tests, Go race tests, cross-language Go-relay-to-Cypheria-server/client E2E, workspace
    CI, and build.

- [x] Add the Cypheria client/server foundation without migrating desktop.
  - Acceptance: `apps/server` provides a Hono HTTP/WebSocket control plane, Paseo-shaped top-level envelopes, principal-and-client-keyed multi-transport logical sessions with automatic grace-period resume, runtime lifecycle, persisted server configuration and live state, operations endpoints, supervised server lifecycle, relay ingress, and embedded Expo web hosting; `apps/expo` targets iOS, Android, and static web; `@cypheria/protocol` provides shared validated contracts.
  - Exclude: agent, project, wallet, policy, browser, and schedule product methods; any `apps/desktop` code change.
  - Verification: protocol/server/client/Expo tests and typechecks, relay tests, Expo compatibility check and static export, server build and embedded-web smoke test, server start/status/restart/stop smoke test, full repository CI/build.

- [x] Define the complete Codex App Server adapter contract in `@cypheria/protocol`.
  - Acceptance: all generated client RPCs, reverse server RPCs, server notifications, and client notifications have collision-free `agent.codex.*` names, request/response correlation, and upstream metadata for internal server adapters; they are excluded from the public message union.
  - Include: keep Codex-generated TypeScript as the type source; generate committed static Zod 4 definition validators from the Codex JSON Schemas with pinned Hey API; preserve wire fields named `default`; normalize 64-bit integers to JSON numbers; retain protocol-owned generated Codex DTOs and JSON Schemas, mechanically generated catalogs, reverse lookups, drift checks, provider-transparent JSON payloads, paired protocol documentation, and Cypheria-owned dotted envelope and response mapping generation; do not connect server dispatch in this item.
  - Verification: protocol generation check, typecheck, tests, build, and full repository CI.

- [x] Add ACP adapter messages to `@cypheria/protocol`.
  - Acceptance: concrete `agent.acp.<operation>.request|response|notification` messages validate the internal adapter boundary; numeric `protocolVersion` selects stable v1 or draft v2, and every message carries its generated ACP agent ID.
  - Include: official `@agentclientprotocol/sdk@1.4.0` protocol constants, directional types, generated Zod schemas, per-method parameter validation, JSON-RPC boundary validation, and paired protocol documentation; expose the SDK's shipped Zod modules with a minimal pinned package-export patch instead of copying them; do not connect server dispatch in this item.
  - Verification: protocol typecheck, tests, and build.

- [x] Add Claude Agent SDK adapter messages to `@cypheria/protocol`.
  - Acceptance: the selected surface of pinned `@anthropic-ai/claude-agent-sdk@0.3.270` is validated for internal server adapters and excluded from the public message union.
  - Include: `query()`, session/settings functions, all `Query` controls, text and streaming prompts, serializable options and MCP transports, all 40 SDK output variants, a type-only SDK subpath, declaration-driven catalogs, drift checks, tests, and paired documentation.
  - Exclude: `startup()`, callbacks, hooks, custom function-defined tools/SDK MCP servers, process and abort handles, session stores, and server dispatch.
  - Verification: protocol generation check, typecheck, tests, and build.

- [x] Retire the provider-shaped Claude client facade after adding the Thread adapter.
  - Acceptance: Claude execution, `canUseTool`, cancellation, and provider session binding are server-owned and exposed only through `thread.*`.

- [x] Add complete Pi RPC adapter support.
  - Acceptance: pinned `@earendil-works/pi-coding-agent@0.85.1` types cover every `pi --mode rpc` command, response, event, extension error, and extension UI operation for the internal Thread adapter.
  - Include: 33 paired command schemas, 23 session-event notifications, four extension UI reverse RPCs, five extension UI notifications, exact JSONL conversion helpers for the future server adapter, type-only upstream exports, command/event helpers, tests, and paired documentation.
  - Exclude: server process launch/dispatch, child-process lifecycle, stderr, executable/environment configuration, and signals.
  - Verification: protocol/client tests, typechecks, builds, full repository CI/build, and paired documentation.

- [x] Add unified agent registry, managed toolchains, installation, enablement, and server runtimes.
  - Acceptance: protocol v2 carries static generated ACP agent IDs; the server conditionally refreshes the registry hourly; install/update/uninstall are observable operations; enable is separate and disabled agents cannot start or receive business calls.
  - Include: one database baseline with `agent_registry`; latest stable managed Node/Python/uv below `$CYPHERIA_HOME`; immutable Python environments shared by complete hashed dependency lock; native Codex/Claude/Pi/OpenCode installers and runtimes; binary/npx/uvx registry installers; stable OpenCode SDK root and both event streams; public client agent manager and internal OpenCode adapter.
  - Verification: registry, database baseline, toolchain fingerprint/lease/GC, protocol, client, and server tests; full repository CI/build; paired documentation.

- [x] Replace provider-session wire APIs with the Agent/Thread protocol and server-owned thread execution.
  - [x] Define Thread views, lifecycle RPCs, canonical timeline rows, epoch/sequence cursors, projected pages, and deterministic projection helpers.
  - [x] Integrate the Thread protocol into the live message union, server dispatch, and top-level client facade.
  - [x] Normalize public Agent management as `agent.*` and expose it directly on `api.agent`.
  - [x] Retire connection-owned provider session APIs after their Thread adapters cover the classified surface.
  - [x] Add the thread lifecycle journal, durable canonical timeline store, AgentManager/ThreadManager coordination, and provider adapters.
  - [x] Persist timeline epochs and canonical rows transactionally, regenerate the unreleased database as a single `0000_initial.sql`, and verify history survives store reconstruction.
  - [x] Complete multi-client interaction arbitration, deletion recovery, process hardening, and documentation.
  - [x] Add shared archive, unarchive, archived-list, and native-session fork operations; archived Threads retain project/section placement while disappearing from active Sidebar collections.
  - [x] Complete full-repository verification.
  - Acceptance: the public protocol uses Agent and Thread terminology; `threadId` is the only operation handle; all clients receive the same Thread events; only canonical timeline rows use epoch/sequence; provider sessions remain server-internal.

- [x] Add server-owned Schedules protocol, persistence, execution, and client facade.
  - Acceptance: `once`, fixed-interval, and five-field cron schedules can start a new Thread, continue an existing Thread, or invoke a policy-routed Web3 runtime method through `client.schedules`.
  - Include: atomic slot claim, durable next-run advancement, run history, pause/resume/manual run, restart recovery, timezone-aware cron, server notifications, and a single regenerated `0000_initial.sql` baseline.
  - Safety: a claimed run is advanced before execution; unfinished work is marked `interrupted` at restart, and in-flight Web3 signing or submission is never replayed automatically.
  - Verification: protocol, database, client, server cadence, and Web3 non-replay tests.

- [~] Migrate desktop to the Cypheria server.
  - Acceptance: Electron main ensures the local supervised server is running, desktop uses the shared protocol, and Electron-only dApp/browser, secure-storage, approval, preload, and OS-integration boundaries remain intact.
  - [x] Add a Desktop Server Manager that reuses a compatible local server or starts the bundled server and waits for versioned readiness.
  - [x] Move Projects, Threads, Sections, search, archive, unread notifications, and Sidebar mutations to `@cypheria/client` while preserving the existing presentation model and direct membership/order semantics.
  - [x] Move live Codex turns to the unified AI SDK provider, restore durable history from the canonical timeline, and add capability-gated common steering for Codex and Pi.
  - [x] Select Codex, Claude, Pi, OpenCode, or ACP AI SDK providers from each Thread's `agentId`; expose enabled agents in the new-chat composer and retain queued follow-ups in the per-Thread scope.
  - [x] Move Agent catalog, installation, update, enablement, and runtime lifecycle controls from the old Desktop harness manager to `client.agents`.
  - [~] Preserve complete Codex timeline rendering parity while generalizing the common conversation shell; canonical user messages now retain attachments across history reloads.
  - [x] Move networks, wallets, policies, signing approvals, and audit surfaces to the shared `client.web3` API; the renderer no longer consumes their old IPC path.
  - [ ] Move remaining Codex authentication/configuration, skills, plugins, MCP, and shared terminal surfaces to server APIs before removing their old IPC paths.
  - Status: explicitly approved; preserve the current Sidebar and Codex-derived conversation experience as hard acceptance gates while replacing their data source.

- [x] Rewrite docs for the server and multi-client target architecture.
  - Acceptance: README, architecture, technical stack, todo docs, and `AGENTS.md` describe the current target architecture only.
  - Include: no `@cypheria/codex-protocol`, clients share `@cypheria/protocol`, server owns runtime in the target architecture, desktop migration is explicitly staged, and generated Codex app-server artifacts live in `@cypheria/protocol`.
  - Verification: `pnpm run ci`, `pnpm build`.

## Runtime

- [x] Expand the `apps/server` runtime into the Cypheria runtime host.
  - Acceptance: package exports `CypheriaRuntime` with `start()`, `stop()`, `request()`, and `events()` methods.
  - Include: service registry, lifecycle state, runtime info handler, runtime event envelope, and clean shutdown.
  - Keep: existing home/path resolution exports.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/server test`.

- [x] Move Cypheria-owned service orchestration behind runtime.
  - Acceptance: runtime can wire database, audit, policy, wallet domain, and browser domain service boundaries without importing desktop renderer code.
  - Include: clear method namespaces for `runtime.*`, `wallet.*`, `chain.*`, `policy.*`, `browser.*`, `dapp.*`, `audit.*`, and `settings.*`.
  - Verification: `pnpm run ci`, `pnpm build`, runtime and affected package tests.

- [x] Adapt existing desktop bootstrap to the runtime host.
  - Acceptance: Electron main initializes `CypheriaRuntime`, reads runtime info through the runtime request path, and shuts the runtime down during app quit.
  - Include: desktop bootstrap tests and explicit database path wiring that does not reintroduce a db-to-runtime dependency.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/desktop test`.

## Client And SDK

- [x] Add the unified `@cypheria/ai-sdk-provider` package.
  - Acceptance: Codex, Claude, Pi, OpenCode, and ACP subpaths use only the shared client/protocol boundary; persistent and ephemeral Threads, canonical Timeline streaming, provider metadata, and abort cancellation share one browser-safe implementation.
  - Verification: one provider contract suite runs against all five entrypoints; package typecheck/build and dependency-boundary checks pass.

- [x] Add the layered `packages/client` protocol client.
  - Acceptance: `ServerClient` owns transport and WebSocket session lifecycle, correlation, subscriptions, and reconnect policy; `CypheriaApi` borrows an existing connection and exposes only current protocol-defined operations; `CypheriaClient` combines the API with lifecycle controls.
  - Include: lazy connection, versioned hello/authentication, browser/Node/custom transport support, request timeout handling, bounded exponential reconnects, Agent/Thread/project/section/server actions, typed notifications, paired package documentation, and no privileged implementation dependencies.
  - Verification: `pnpm --filter @cypheria/client test`, package typecheck/build, `pnpm run ci`, and `pnpm build`.
  - Verification record: client unit tests, a live client/server status smoke test, full repository CI, and full repository build pass.

- [x] Remove provider-shaped client APIs after server-owned Thread execution landed.
  - Acceptance: no ACP, Codex, Claude, Pi, or OpenCode endpoint/subpath is exported by `@cypheria/client`; provider schemas remain available only to internal server adapters.
  - Verification: client public API tests, typecheck/build, full repository CI, and full repository build.

- [ ] Add `packages/sdk`.
  - Acceptance: package exports a public `Cypheria` server client.
  - Include: clients for runtime, wallet, policy, schedule, and agent.
  - Agent path: use versioned server operations and events.
  - Must not import: `apps/cli`, `apps/desktop`, Electron, the `apps/server` runtime, or the Server Codex adapter.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/sdk test`.

- [ ] Add SDK test doubles for runtime and Codex SDK.
  - Acceptance: SDK tests can run without launching Codex or Electron.
  - Include: fake runtime client and fake agent thread.
  - Verification: `pnpm --filter @cypheria/sdk test`.

## CLI

- [x] Add `apps/cli`.
  - Acceptance: package builds a `cypheria` Node CLI with no TUI.
  - Include: argument parsing, server connection/configuration, JSON output, log tailing, and non-zero failure exits.
  - Dependencies: `@cypheria/client` and `@cypheria/protocol`.
  - Must not import: `@cypheria/sdk`, the `apps/server` runtime, Electron, desktop packages, or the Server Codex adapter.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/cli test`.

- [x] Implement server and shared-resource CLI commands.
  - Acceptance: `cypheria server start|stop|status|logs`, `agents list`, `projects list`, `threads list`, and `schedules list` use the supervisor or shared client API without importing server, database, runtime, Desktop, SDK, or Agent SDK internals.
  - Verification: CLI unit tests, production bundle, and a real start/status/stop smoke test against a temporary Cypheria home.

- [ ] Add interactive run and Web3 administration commands.
  - Acceptance: streaming Thread execution, JSONL events, wallet and policy administration, and diagnostics are exposed only after their shared server APIs exist.

## Marketplace

- [x] Research and specify `apps/marketplace`.
  - Acceptance: paired documents define an OpenAI-like submission/review/publication platform, mandatory ChatGPT/Codex compatibility, GitHub-only open-source `url`/`git-subdir` sources, deterministic official repo synchronization, App Server installation, Cloudflare boundaries, security, and delivery sequence.
  - Verification: paired-document review and `pnpm run ci`.

- [ ] Scaffold the TanStack Start marketplace Worker.
  - Acceptance: `@cypheria/marketplace` builds and previews with the official Cloudflare Vite integration, a custom Worker entrypoint, locale-prefixed SSR routes, shared UI primitives, D1 migrations, typed bindings, and local tests.
  - Must not import: Electron, desktop IPC, the `apps/server` runtime, the Server Codex adapter, or `@cypheria/db`.
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

- [x] Regenerate Codex app-server TypeScript and schemas into `@cypheria/protocol`.
  - Acceptance: generated types live in `packages/protocol/src/generated/codex/ts`, generated schemas live in `packages/protocol/src/generated/codex/schema`, derived message and response-map registries live directly under `packages/protocol/src/generated/codex`, and all artifacts are committed.
  - Command: `pnpm --filter @cypheria/protocol generate:codex-all`.
  - Include: package script to regenerate the files during explicit Codex upgrades.
  - Must not create: `@cypheria/codex-protocol`.
  - Verification: `pnpm --filter @cypheria/protocol check`.

- [x] Refactor the Server Codex adapter to use generated app-server types.
  - Acceptance: bridge uses generated request, response, notification, and server request types instead of hand-written Codex app-server protocol types.
  - Include: WebSocket transport, initialize/initialized handshake, request/response correlation, notification stream, server request routing, disconnect handling, and overload retry handling.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter apps/server Codex adapter test`.

- [x] Update desktop to use persistent Codex App Server over WebSocket.
  - Acceptance: Electron main starts Codex App Server with `CODEX_HOME=$CYPHERIA_HOME/codex`, connects through the Server Codex adapter, and exposes Codex events to renderer through typed IPC.
  - Include: localhost port selection, process lifecycle, readiness, shutdown, stderr logging, and renderer-safe event mapping.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/desktop test`, local desktop smoke test when Codex is available.

- [x] Pin the Codex App Server runtime and generated protocol version.
  - Acceptance: the workspace and desktop use an exact `@openai/codex` version; protocol generation resolves that workspace binary; desktop rejects mismatched binaries before startup.
  - Include: development package resolution, explicit `CYPHERIA_CODEX_PATH` override, and packaged sidecar resolution from Electron resources.
  - Verification: `pnpm codex:version`, `pnpm run ci`, `pnpm build`, and desktop tests.

- [x] Add the chat-centered desktop workspace, harness connections, and native model settings.
  - Acceptance: the sidebar lists projects and recent threads; the main workspace streams AI SDK UI messages through App Server; Connections is structured for multiple agent harnesses and implements Codex login with ChatGPT managed authentication and validated OpenAI API keys; model settings support OpenAI, Bedrock, Ollama, and LM Studio.
  - Include: a global system/direct/manual proxy stored at `$CYPHERIA_HOME/config/proxy.json`, HTTP/HTTPS/SOCKS5 support, connection testing, harness restart on proxy changes, unauthenticated local-model use, chat interruption, model/reasoning/service-tier controls, schedule supervision, isolated dApp launch, approval and plugin/skill workbench routes, and client-only route shells for Electron builds.
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

- [x] Add the `@cypheria/ai-sdk-provider/acp` ACP-to-AI-SDK bridge.
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

- [x] Consolidate the four Web3 domain packages into `@cypheria/web3`.
  - Acceptance: network, policy, wallet, and provider remain independently importable through explicit subpath exports; all production imports and workspace dependencies use the consolidated package; no legacy package manifest remains.
  - Verification: `pnpm --filter @cypheria/web3 test`, `pnpm --filter @cypheria/web3 typecheck`, `pnpm run ci`, `pnpm build`.

- [x] Specify the network and RPC architecture.
  - Acceptance: English and Chinese design documents analyze the Archmage-X precedent and define canonical chain identity, package boundaries, catalog reconciliation, persistence, protected RPC credentials, endpoint probing/routing, origin-scoped dApp selection, failure semantics, and V1 exclusions.
  - Verification: paired-document review, `pnpm run ci`.

- [x] Add `@cypheria/web3/network` and the bundled network catalog.
  - Acceptance: strict EVM and Solana chain identity, network, explorer, endpoint, public projection, and protocol-conversion schemas replace untyped or mixed chain identifiers.
  - Include: stable IDs, canonical chain keys, immutable identity, URL normalization, minimal reviewed built-ins, and catalog fixtures.
  - Verification: `@cypheria/web3` network tests, `pnpm run ci`, `pnpm build`.

- [x] Persist network configuration and protect RPC credentials.
  - Acceptance: libSQL stores networks, ordered endpoints, revisions, and origin-scoped contexts while protected connection material remains outside ordinary columns under `$CYPHERIA_HOME/config/network-credentials`.
  - Include: migrations, catalog reconciliation, redacted projections, optimistic concurrency, non-cascading wallet/history behavior, and OS-backed credential protection.
  - Verification: database, credential-store, migration, and recovery tests; `pnpm run ci`, `pnpm build`.

- [x] Implement the runtime network manager and RPC router.
  - Acceptance: runtime probes endpoint identity, tracks disposable health, selects purpose-compatible endpoints, retries only safe reads, preserves operation stickiness, and reports ambiguous broadcasts without blind retry.
  - Include: SSRF destination policy, DNS/redirect checks, timeouts, response and concurrency bounds, redacted audit, and stable network errors.
  - Verification: runtime unit and integration tests with local fake EVM and Solana RPC servers; `pnpm run ci`, `pnpm build`.

- [x] Migrate wallet, policy, schedule, and dApp boundaries to canonical chain identity.
  - Acceptance: chain accounts, active wallet context, signing intents, policies, schedule scopes, permissions, and events use `ChainIdentity`/`ChainKey`; active network identity must match the selected chain account.
  - Include: data migrations and compatibility adapters for EIP-1193 hexadecimal IDs and Solana Wallet Standard identifiers.
  - Verification: `@cypheria/web3`, schedule, database, runtime, and desktop IPC tests.

- [x] Add origin-scoped network add/switch flows and desktop management UI.
  - Acceptance: each dApp origin selects Ethereum and Solana networks independently; EIP-3085 add and EIP-3326 switch requests require validated probes and approval; desktop manages network and endpoint ordering, enabled state, health, and redacted credentials.
  - Include: typed IPC, provider events emitted only after successful selection changes, built-in disable/custom delete behavior, and approval metadata diffs.
  - Verification: runtime, desktop, provider, and real sandboxed Electron tests; `pnpm run ci`, `pnpm build`.

- [x] Adopt Drizzle with libSQL as the local database adapter and specify the wallet architecture.
  - Acceptance: database services use `@libsql/client` instead of `better-sqlite3`; persistence APIs are asynchronous; English and Chinese wallet design documents define public data, encrypted vault, memory, and signing boundaries.
  - Verification: `pnpm run ci`, `pnpm build`, database and desktop tests.

- [x] Replace the wallet domain baseline.
  - Acceptance: `@cypheria/web3/wallet` models HD, private-key, private-key-group, watch, and watch-group wallets independently from storage concerns; wallet kind determines vault and read-only capabilities.
  - Include: Zod boundary schemas, stable identifiers, wallet/account/chain-account hierarchy, fingerprints, lifecycle states, derivation schemes, and renderer-safe projections.
  - Verification: `pnpm --filter @cypheria/web3 test`, `pnpm run ci`, `pnpm build`.

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
  - Include: viem signing adapters, signer/address consistency checks, lock behavior, replay protection, and no private keys in renderer, dApp, agent, or schedule contexts.
  - Verification: runtime, policy, wallet, and desktop IPC tests.

- [x] Implement policy runtime service.
  - Acceptance: runtime can list, validate, create, update, disable, and evaluate signing policies.
  - Verification: runtime and `@cypheria/web3` policy tests.

- [x] Implement signing intent and approval runtime flow.
  - Acceptance: dApp, schedule, and agent contexts can create signing intents; each intent is evaluated by policy and auditable.
  - Verification: runtime, policy, db, and desktop IPC tests.

- [x] Implement provider and dApp browser runtime service.
  - Acceptance: desktop can create origin-isolated dApp sessions; expose and discover Ethereum and Solana providers; persist protocol-scoped permissions; forward common Ethereum read-only RPC; deliver scoped provider events; and route EVM or Solana signing through policy-backed intents and injected executors.
  - Verification: `@cypheria/web3` provider, database, runtime, desktop controller, and real sandboxed Electron discovery tests.

- [x] Replace the local Automation stack with Server-owned Schedules.
  - Acceptance: `apps/server` can create, list, update, pause, resume, delete, run, recover, and inspect schedules through the versioned protocol; Desktop uses `@cypheria/client` and has no Automation IPC.
  - Include: once, interval, and cron cadence; new/existing Thread and bounded Web3 targets; durable leases and run history; no restart replay of in-flight Web3 operations; removal of `automation-core`, legacy tables, runtime service, and Desktop bridge.
  - Verification: protocol/client/server schedule tests, database baseline tests, Desktop typecheck/build, `pnpm run ci`, `pnpm build`.

## Review Rule

After each todo item is completed:

- Stop and request user review before starting the next item.
- Run the relevant verification commands.
- Update English and Chinese docs for behavior, architecture, command, public interface, package boundary, or runtime path changes.
- Keep commits focused on the completed item.
