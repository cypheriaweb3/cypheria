# Cypheria Development Todo

This todo tracks implementation work at a reviewable granularity. Each item should be meaningful, testable, and commit-sized.

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

## Foundation Already In Place

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
  - Acceptance: `@cypheria/ipc` defines initial app/runtime contracts and desktop main validates handler inputs/outputs.
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

## Desktop Codex App Server Bridge

- [ ] Regenerate Codex app-server TypeScript into `@cypheria/codex-bridge`.
  - Acceptance: generated files live in `packages/codex-bridge/src/generated` and are committed.
  - Command: `codex app-server generate-ts --out packages/codex-bridge/src/generated`.
  - Include: package script to regenerate the files during explicit Codex upgrades.
  - Must not create: `@cypheria/codex-protocol`.
  - Verification: `pnpm --filter @cypheria/codex-bridge check`.

- [ ] Refactor `@cypheria/codex-bridge` to use generated app-server types.
  - Acceptance: bridge uses generated request, response, notification, and server request types instead of hand-written Codex app-server protocol types.
  - Include: WebSocket transport, initialize/initialized handshake, request/response correlation, notification stream, server request routing, disconnect handling, and overload retry handling.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/codex-bridge test`.

- [ ] Update desktop to use persistent Codex App Server over WebSocket.
  - Acceptance: Electron main starts Codex App Server with `CODEX_HOME=$CYPHERIA_HOME/codex`, connects through `@cypheria/codex-bridge`, and exposes Codex events to renderer through typed IPC.
  - Include: localhost port selection, process lifecycle, readiness, shutdown, stderr logging, and renderer-safe event mapping.
  - Verification: `pnpm run ci`, `pnpm build`, `pnpm --filter @cypheria/desktop test`, local desktop smoke test when Codex is available.

## Runtime Web3 Capabilities

- [ ] Implement wallet runtime service.
  - Acceptance: runtime can list wallet/account state, manage read-only accounts, and expose active account context without private keys entering renderer.
  - Verification: runtime and wallet tests.

- [ ] Implement policy runtime service.
  - Acceptance: runtime can list, validate, create, update, disable, and evaluate signing policies.
  - Verification: runtime and policy-engine tests.

- [ ] Implement signing intent and approval runtime flow.
  - Acceptance: dApp, automation, and agent contexts can create signing intents; each intent is evaluated by policy and auditable.
  - Verification: runtime, policy, db, and desktop IPC tests.

- [ ] Implement Web3 browser runtime service.
  - Acceptance: desktop can create origin-isolated dApp sessions, inject the provider bridge, and route provider requests through runtime.
  - Verification: web3-browser tests and desktop smoke test.

- [ ] Implement automation runtime service.
  - Acceptance: runtime can create, list, run, pause, resume, and inspect automation tasks and runs.
  - Include: tasks may call Codex SDK or create signing intents but cannot bypass policy.
  - Verification: automation-core, db, runtime, and desktop tests.

## Review Rule

After each todo item is completed:

- Stop and request user review before starting the next item.
- Run the relevant verification commands.
- Update English and Chinese docs for behavior, architecture, command, public interface, package boundary, or runtime path changes.
- Keep commits focused on the completed item.
