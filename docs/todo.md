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

- [x] Add typed IPC contract and router baseline.
  - Acceptance: desktop-local IPC contracts define initial app/runtime contracts and desktop main validates handler inputs/outputs.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add database, audit, wallet, policy, Web3 browser, automation, Codex bridge, and UI baselines.
  - Acceptance: domain packages contain initial types/services/tests for their V1 boundaries.
  - Verification: `pnpm run ci`, `pnpm build`, package-level tests where present.

## Architecture Alignment

- [x] Rewrite docs for the final Runtime / CLI / SDK / Desktop architecture.
  - Acceptance: README, architecture, technical stack, todo docs, and `AGENTS.md` describe the current target architecture only.
  - Include: no `@cypheria/codex-protocol`, CLI does not depend on SDK, CLI/SDK use `@openai/codex-sdk`, desktop uses Codex App Server over WebSocket, and generated app-server TS lives inside `@cypheria/codex-bridge`.
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
  - Acceptance: package exports a public `Cypheria` client.
  - Include: clients for runtime, wallet, policy, automation, and agent.
  - Agent path: directly use `@openai/codex-sdk`.
  - Must not import: `apps/cli`, `apps/desktop`, Electron, or `@cypheria/codex-bridge`.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/sdk test`.

- [ ] Add SDK test doubles for runtime and Codex SDK.
  - Acceptance: SDK tests can run without launching Codex or Electron.
  - Include: fake runtime client and fake agent thread.
  - Verification: `pnpm --filter @cypheria/sdk test`.

## CLI

- [ ] Add `apps/cli`.
  - Acceptance: package builds a `cypheria` Node CLI with no TUI.
  - Include: argument parsing, runtime initialization, readable output, JSONL output mode, and non-zero failure exits.
  - Dependencies: direct imports from `@cypheria/runtime` and `@openai/codex-sdk`.
  - Must not import: `@cypheria/sdk`, Electron, desktop packages, or `@cypheria/codex-bridge`.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/cli test`.

- [ ] Implement initial CLI commands.
  - Acceptance: `cypheria run`, `cypheria run --jsonl`, `cypheria runtime info`, `cypheria wallet list`, `cypheria policy list`, `cypheria automation run <task-id>`, and `cypheria doctor` are wired to runtime or Codex SDK.
  - Verification: CLI unit tests and command smoke tests.

- [x] Add desktop-owned sidebar collapse motion and hover previews.
  - Acceptance: native window controls remain fixed; the sidebar fully retracts, collapsed controls and the task title move together, and hover previews do not resize content. Shared UI primitives remain unchanged.
  - Verification: desktop typecheck/build, Biome, and Electron visual checks.

## Desktop Codex App Server Bridge

- [x] Regenerate Codex app-server TypeScript into `@cypheria/codex-bridge`.
  - Acceptance: generated files live in `packages/codex-bridge/src/generated` and are committed.
  - Command: `codex app-server generate-ts --out packages/codex-bridge/src/generated`.
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

- [x] Add the task-centered desktop workspace, Codex authentication, and native model settings.
  - Acceptance: the sidebar lists projects and recent threads; the main workspace streams AI SDK UI messages through App Server; account settings support ChatGPT, OpenAI API keys, and Amazon Bedrock; model settings support OpenAI, Bedrock, Ollama, and LM Studio.
  - Include: unauthenticated local-model use, task interruption, model/reasoning/service-tier controls, automation supervision, isolated dApp launch, approval and plugin/skill workbench routes, and client-only route shells for Electron builds.
  - Exclude: generic custom providers and OpenCodex integration until the provider strategy is decided.
  - Verification: `pnpm run ci`, `pnpm build`, and `pnpm --filter @cypheria/desktop test`.

- [x] Complete the desktop Web3 management loop and production renderer startup.
  - Acceptance: wallet creation/import/watch management, active account context, vault lock state, signing policies, pending approval decisions, and audit records are usable through typed IPC-backed screens.
  - Include: OS-backed desktop vault key storage, one-shot secret submission without renderer persistence, a two-level virtualized wallet/account manager with durable drag ordering and HD account derivation, pending counts in the sidebar, packaged SPA routing through the privileged `cypheria://` scheme, bundled libSQL native resolution, and copied database migrations.
  - Verification: all workspace tests, `pnpm run ci`, `pnpm build`, and real Electron smoke checks of the task workspace and wallet route.

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
