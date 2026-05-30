# AGENTS.md

This file provides working instructions for agents contributing to Cypheria.

## Project Context

Cypheria is a TypeScript Web3 agent product inspired by Codex. It has four target surfaces:

- `@cypheria/runtime`: Cypheria-owned non-agent runtime for Web3, wallets, signing policy, dApp browser permissions, automation, local state, and audit logs.
- `apps/cli`: a non-TUI CLI that directly composes `@cypheria/runtime` and `@openai/codex-sdk`.
- `@cypheria/sdk`: a public TypeScript SDK that directly composes `@cypheria/runtime` and `@openai/codex-sdk`.
- `apps/desktop`: an Electron + TanStack Start app that runs Cypheria runtime in Electron main and talks to a persistent Codex App Server over WebSocket JSON-RPC.

Cypheria does not reimplement or fork the Codex agent runtime. Web3-specific capabilities belong to Cypheria runtime. Codex is used for agent threads, turns, model execution, code edits, shell/tool execution, MCP, and Codex approvals.

Primary references:

- `README.md`
- `README.zh-CN.md`
- `docs/architecture.md`
- `docs/architecture.zh-CN.md`
- `docs/technical-stack.md`
- `docs/technical-stack.zh-CN.md`
- `docs/todo.md`
- `docs/todo.zh-CN.md`

## Development Workflow

- Use `docs/todo.md` as the source of truth for implementation sequencing.
- Keep todo items at a reviewable granularity: one item should be meaningful, testable, and commit-sized.
- Implement one todo item at a time unless the user explicitly asks to batch work.
- After completing each todo item, stop and ask for user review before starting the next item.
- Run the relevant verification commands before reporting completion.
- Keep commits focused on the completed todo item.
- If implementation changes behavior, architecture, commands, public interfaces, package boundaries, or runtime paths, update the relevant English and Chinese docs in the same change.

## Language And Documentation

- English is the default language for primary project documents.
- Chinese companion documents should use the same base filename with a `.zh-CN.md` suffix.
- When adding or materially changing a primary document, add or update the matching Chinese document unless the change is clearly code-only or explicitly scoped to one language.
- Keep docs focused on the current V1 architecture. Do not preserve obsolete design history in project docs.

Examples:

- `README.md` and `README.zh-CN.md`
- `docs/architecture.md` and `docs/architecture.zh-CN.md`
- `docs/technical-stack.md` and `docs/technical-stack.zh-CN.md`

## Monorepo And Commands

- The monorepo uses Turborepo + pnpm workspace.
- Use pnpm for dependency management and scripts.
- In this repository, pnpm-related commands should usually run outside the sandbox so pnpm can use its global store.
- Do not use npm, yarn, or bun unless the user explicitly asks for it.

Common commands:

```sh
pnpm install
pnpm run ci
pnpm check
pnpm build
pnpm format
pnpm lint
```

## Package Layout

Target layout:

```txt
apps/cli
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

`apps/cli` and `packages/sdk` are planned packages. Do not treat their absence as a reason to route CLI or SDK behavior through desktop internals.

## Codex Integration Rules

- CLI directly uses `@cypheria/runtime` and `@openai/codex-sdk`.
- SDK directly uses `@cypheria/runtime` and `@openai/codex-sdk`.
- CLI must not depend on `@cypheria/sdk`.
- CLI and SDK must not depend on Electron, desktop packages, or `@cypheria/codex-bridge`.
- Desktop uses a persistent `codex app-server` process over WebSocket JSON-RPC.
- `@cypheria/codex-bridge` is the desktop-side Codex App Server bridge.
- Do not create `@cypheria/codex-protocol`.
- Do not hand-write Codex App Server protocol types.
- Codex App Server generated TypeScript must live in:

```txt
packages/codex-bridge/src/generated
```

Generate those files with:

```sh
codex app-server generate-ts --out packages/codex-bridge/src/generated
```

Generated protocol files should be committed so CI and contributors can typecheck without a matching local Codex binary.

## Formatting And Type Safety

- Biome owns linting and formatting.
- TypeScript should remain strict.
- Prefer Zod for runtime validation at boundaries, especially IPC, policy schemas, wallet inputs, automation definitions, and generated-protocol adapters.
- Keep package boundaries explicit and avoid reaching into another package's private files.
- Domain/data packages should not depend on `@cypheria/runtime`; runtime composes them through explicit service injection.

## Runtime Home Directories

Cypheria should have its own local application home directory.

- The app home directory is configured by `$CYPHERIA_HOME`.
- If `$CYPHERIA_HOME` is not set, default to `~/.cypheria`.
- Cypheria-owned local data, settings, logs, caches, databases, wallet vault metadata, automation state, and app-managed runtime files should live under `$CYPHERIA_HOME`.

Cypheria-managed Codex processes must use:

```sh
CODEX_HOME="$CYPHERIA_HOME/codex"
```

Recommended layout:

```txt
$CYPHERIA_HOME/
  codex/          Cypheria-managed Codex home
  db/             SQLite databases
  vault/          encrypted wallet vault files and metadata
  logs/           app, automation, policy, and audit logs
  cache/          disposable app caches
  browser/        dApp browser session partitions and related metadata
  automation/     task definitions, run state, and worker metadata
  config/         Cypheria settings
```

Implementation notes:

- Resolve `$CYPHERIA_HOME` once in the relevant process and pass derived paths into services.
- Do not let renderer or dApp pages choose privileged filesystem paths directly.
- Treat `$CYPHERIA_HOME/codex` as the only Codex home used by Cypheria-managed Codex processes.
- Do not read or mutate the user's default `$CODEX_HOME` unless the user explicitly asks for an import or migration flow.

## Security Boundaries

- Private keys, signing, automation execution, local database access, and browser session management belong in Electron main, Cypheria runtime, or isolated child/worker processes.
- Renderer code should use typed IPC only.
- dApp pages should never receive Node.js access or private key material.
- Codex and automation flows should create signing intents, not direct signatures.
- Every signing intent must go through the policy engine.
- Auto-signing must be disabled by default and enabled only through explicit user policy.
- Every signature, rejection, policy decision, automation run, and transaction hash should be auditable.

Electron browser defaults should remain conservative:

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

## UI Direction

- Prefer mature reusable components over custom base components.
- Use shadcn/ui-style copied components as the default component source.
- Use Base UI for overlays and interactive primitives where appropriate.
- Keep the visual style close to Codex Desktop: quiet, dense enough for real work, low saturation, panel-oriented, and focused on workspaces, threads, diffs, terminals, approvals, wallets, policies, and browser context.
- Avoid typical Web3 neon/gradient marketing aesthetics.
- Build custom components only for Cypheria-specific needs such as wallet switching, signing approval, transaction simulation, dApp permission inspection, policy editing, and Web3 browser controls.

## Git And Commits

- Keep commits focused.
- Do not commit local IDE files, caches, `node_modules`, `.turbo`, build output, or secrets.
- Signed commits are preferred in this repository; use `git commit -S` when committing.
- Do not rewrite published history unless the user explicitly allows it.

## What Not To Do In V1

- Do not fork the Codex runtime.
- Do not implement a TUI.
- Do not create `@cypheria/codex-protocol`.
- Do not hand-write Codex App Server protocol types.
- Do not store private keys in renderer, localStorage, IndexedDB, or normal SQLite tables.
- Do not share browser sessions across dApp origins.
- Do not make wagmi the core wallet layer.
- Do not introduce cloud agent execution.
- Do not introduce a complex workflow engine before the local runner proves its shape.
