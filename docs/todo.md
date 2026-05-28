# Cypheria Development Todo

This todo tracks implementation work at a reviewable granularity. Each item should be small enough to implement, verify, and review in one focused pass, but large enough to produce a meaningful project capability.

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

## Foundation

- [x] Initialize Turborepo + pnpm monorepo.
  - Acceptance: root scripts, workspace packages, TypeScript base config, Biome, Turbo pipeline, and lockfile are present.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add project README, architecture, technical stack, and agent instructions.
  - Acceptance: English primary docs and `.zh-CN.md` companion docs exist where applicable.
  - Verification: `pnpm run ci`.

- [x] Add runtime home resolution.
  - Acceptance: `@cypheria/runtime` resolves `$CYPHERIA_HOME`, defaults to `~/.cypheria`, and derives `CODEX_HOME=$CYPHERIA_HOME/codex`.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add runtime directory initialization.
  - Acceptance: runtime package can explicitly create all Cypheria-owned runtime directories.
  - Verification: `pnpm run ci`, `pnpm build`.

- [x] Add Electron main runtime bootstrap helper.
  - Acceptance: desktop main package exposes `initializeDesktopRuntime()` and returns runtime paths plus Codex environment.
  - Verification: `pnpm run ci`, `pnpm build`.

## Desktop App Shell

- [x] Add real Electron main entrypoint.
  - Acceptance: `@cypheria/desktop` has a runnable main process entry that initializes runtime directories before creating windows.
  - Include: app lifecycle, single-instance lock, graceful shutdown hooks, and basic error logging.
  - Update docs if startup behavior or runtime paths change.
  - Verification: `pnpm run ci`, `pnpm build`, launch smoke test.

- [x] Add TanStack Start renderer skeleton.
  - Acceptance: renderer has a minimal app shell with routing, layout placeholders, and a root route.
  - Include: app frame, sidebar placeholders, main content area, theme baseline, and Jotai/TanStack Query providers.
  - Update docs if frontend structure changes.
  - Verification: `pnpm run ci`, `pnpm build`, browser/Electron screenshot smoke test when runnable.

- [ ] Add typed preload bridge baseline.
  - Acceptance: renderer can call a small typed API exposed by preload without Node.js access.
  - Include: runtime info read endpoint and app metadata endpoint.
  - Update architecture docs if IPC boundary changes.
  - Verification: `pnpm run ci`, `pnpm build`, preload typecheck.

## IPC And Service Contracts

- [ ] Define typed IPC contract package.
  - Acceptance: `@cypheria/ipc` contains shared request/response/event contract types and Zod schemas for initial runtime/app APIs.
  - Include: namespace conventions, error envelope, event envelope, and version field.
  - Update architecture docs if IPC wire shape changes.
  - Verification: `pnpm run ci`, `pnpm build`.

- [ ] Implement main-process IPC router.
  - Acceptance: Electron main can register typed handlers and validate inputs/outputs using the shared contracts.
  - Include: runtime info route and health route.
  - Update docs if handler registration patterns become part of architecture.
  - Verification: `pnpm run ci`, `pnpm build`, renderer/preload smoke call.

## Local Data

- [ ] Add database package baseline.
  - Acceptance: `@cypheria/db` defines SQLite path resolution under `$CYPHERIA_HOME/db`, Drizzle config, and initial schema shell.
  - Include: settings, audit logs, workspaces, and runtime metadata tables as initial schema candidates.
  - Update docs if table names or data boundaries change.
  - Verification: `pnpm run ci`, `pnpm build`, migration generation/check.

- [ ] Add audit log write path.
  - Acceptance: main-process service can append structured audit events to local SQLite.
  - Include: event type, actor, timestamp, source, payload hash/summary, and correlation id.
  - Update architecture docs if audit model changes.
  - Verification: `pnpm run ci`, `pnpm build`, unit tests for append/read.

## Codex Integration

- [ ] Define Codex App Server transport adapter.
  - Acceptance: `@cypheria/codex-bridge` models JSONL messages, request ids, lifecycle states, and normalized events.
  - Include: transport interface, message parser, event normalization shell, and error handling types.
  - Update docs if Codex event model changes.
  - Verification: `pnpm run ci`, `pnpm build`, parser unit tests.

- [ ] Implement Codex child process supervisor.
  - Acceptance: Electron main can launch a configured Codex App Server process with `CODEX_HOME=$CYPHERIA_HOME/codex`.
  - Include: start/stop, stdout JSONL stream, stderr logging, exit state, and restart decision placeholder.
  - Update docs if process lifecycle changes.
  - Verification: `pnpm run ci`, `pnpm build`, local start smoke test if Codex binary is available.

## Wallet And Policy

- [ ] Define wallet domain types.
  - Acceptance: `@cypheria/wallet-core` contains account, chain, RPC, signing intent, wallet source, and permission types.
  - Include: local wallet, Privy wallet, external wallet, read-only mode, human approval mode, and conditional auto-signing mode.
  - Update technical stack docs if wallet boundaries change.
  - Verification: `pnpm run ci`, `pnpm build`.

- [ ] Define policy engine schema and evaluator baseline.
  - Acceptance: `@cypheria/policy-engine` validates signing policies and evaluates simple allow/deny/require-human-approval decisions.
  - Include: origin, wallet, chain, method, contract allowlist, value limit, expiration, and enabled flag.
  - Update docs if policy shape changes.
  - Verification: `pnpm run ci`, `pnpm build`, unit tests for policy decisions.

## Web3 Browser

- [ ] Define dApp browser session model.
  - Acceptance: `@cypheria/web3-browser` defines origin-scoped session keys, permission records, and provider request/response types.
  - Include: EIP-1193 method coverage for account request, chain switching, signing, and transaction sending.
  - Update architecture docs if browser isolation model changes.
  - Verification: `pnpm run ci`, `pnpm build`.

- [ ] Add provider bridge baseline.
  - Acceptance: preload/browser bridge can serialize provider requests to main-process handlers without exposing Node.js APIs.
  - Include: request id, origin, chain id, method, params, and structured provider errors.
  - Update docs if provider bridge wire shape changes.
  - Verification: `pnpm run ci`, `pnpm build`, bridge unit tests or smoke test.

## Automation

- [ ] Define automation task model.
  - Acceptance: shared types describe manual, scheduled, and agent-triggered tasks.
  - Include: task id, workspace, wallet policy scope, trigger, status, run history, and audit correlation id.
  - Update docs if automation scope changes.
  - Verification: `pnpm run ci`, `pnpm build`.

- [ ] Add local automation runner baseline.
  - Acceptance: main process can run a no-op/manual task through a worker boundary and persist run status.
  - Include: cancellation placeholder, structured logs, and audit event hook.
  - Update architecture docs if runner model changes.
  - Verification: `pnpm run ci`, `pnpm build`, no-op run smoke test.

## UI

- [ ] Add shadcn-based UI package baseline.
  - Acceptance: `@cypheria/ui` exposes shared primitives or copied shadcn components with Cypheria styling conventions.
  - Include: Button, Input, Dialog/Sheet, Sidebar shell, Tooltip, Badge, and Toast baseline.
  - Update technical stack docs if UI dependency choices change.
  - Verification: `pnpm run ci`, `pnpm build`, visual smoke check when renderer is runnable.

- [ ] Add first app shell screen.
  - Acceptance: desktop renderer shows a Codex Desktop-like shell with sidebar navigation for Workspaces, Browser, Wallets, Automations, Security, and Settings.
  - Include: empty states only; no deep feature implementation.
  - Update README screenshots/usage once stable.
  - Verification: `pnpm run ci`, `pnpm build`, screenshot review.

## Review Rule

After each todo item is completed:

- Stop and request user review before starting the next item.
- Run the relevant verification commands.
- Update English and Chinese docs for any behavior, architecture, command, or interface changes.
- Keep commits focused on the completed item.
