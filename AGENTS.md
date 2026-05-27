# AGENTS.md

This file provides working instructions for agents contributing to Cypheria.

## Project Context

Cypheria is a cross-platform Web3 agent desktop inspired by Codex Desktop. The repository is a Turborepo + pnpm monorepo with an Electron desktop app and shared packages for UI, IPC, Codex integration, wallets, Web3 browser behavior, policy evaluation, and local data.

Primary references:

- `README.md`
- `README.zh-CN.md`
- `docs/architecture.md`
- `docs/architecture.zh-CN.md`
- `docs/technical-stack.md`
- `docs/technical-stack.zh-CN.md`

## Language And Documentation

- English is the default language for primary project documents.
- Chinese companion documents should use the same base filename with a `.zh-CN.md` suffix.
- When adding or materially changing a primary document, add or update the matching Chinese document unless the change is clearly code-only or explicitly scoped to one language.

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

## Formatting And Type Safety

- Biome owns linting and formatting.
- TypeScript should remain strict.
- Prefer Zod for runtime validation at boundaries, especially IPC, policy schemas, wallet inputs, and automation definitions.
- Keep package boundaries explicit and avoid reaching into another package's private files.

## Runtime Home Directories

Cypheria should have its own local application home directory.

- The app home directory is configured by `$CYPHERIA_HOME`.
- If `$CYPHERIA_HOME` is not set, default to `~/.cypheria`.
- Cypheria-owned local data, settings, logs, caches, databases, wallet vault metadata, automation state, and app-managed runtime files should live under `$CYPHERIA_HOME`.

Codex App Server expects `$CODEX_HOME`. When Cypheria launches Codex App Server, it should set:

```sh
CODEX_HOME="$CYPHERIA_HOME/codex"
```

This keeps Codex state scoped inside Cypheria's application directory instead of leaking into the user's normal Codex installation.

Recommended layout:

```txt
$CYPHERIA_HOME/
  codex/          Codex App Server home, passed as CODEX_HOME
  db/             SQLite databases
  vault/          encrypted wallet vault files and metadata
  logs/           app, automation, policy, and audit logs
  cache/          disposable app caches
  browser/        dApp browser session partitions and related metadata
  automation/     task definitions, run state, and worker metadata
  config/         Cypheria settings
```

Implementation notes:

- Resolve `$CYPHERIA_HOME` once in the main process and pass derived paths into services.
- Do not let renderer or dApp pages choose privileged filesystem paths directly.
- Treat `$CYPHERIA_HOME/codex` as the only Codex home used by Cypheria-managed Codex processes.
- Do not read or mutate the user's default `$CODEX_HOME` unless the user explicitly asks for an import or migration flow.

## Security Boundaries

- Private keys, signing, automation execution, Codex child process management, local database access, and browser session management belong in the Electron main process or isolated child processes.
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
  webSecurity: true
}
```

## UI Direction

- Prefer mature reusable components over custom base components.
- Use shadcn/ui as the default component source.
- Keep the visual style close to Codex Desktop: quiet, dense enough for real work, low saturation, panel-oriented, and focused on workspaces, threads, diffs, terminals, approvals, and browser context.
- Avoid typical Web3 neon/gradient marketing aesthetics.
- Build custom components only for Cypheria-specific needs such as wallet switching, signing approval, transaction simulation, dApp permission inspection, policy editing, and Web3 browser controls.

## Git And Commits

- Keep commits focused.
- Do not commit local IDE files, caches, `node_modules`, `.turbo`, build output, or secrets.
- Signed commits are preferred in this repository; use `git commit -S` when committing.
- Do not rewrite published history unless the user explicitly allows it.

## What Not To Do In V1

- Do not fork the Codex runtime.
- Do not store private keys in renderer, localStorage, IndexedDB, or normal SQLite tables.
- Do not share browser sessions across dApp origins.
- Do not make wagmi the core wallet layer.
- Do not introduce cloud agent execution.
- Do not introduce a complex workflow engine before the local runner proves its shape.
