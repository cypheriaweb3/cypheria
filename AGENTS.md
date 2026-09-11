# AGENTS.md

This file provides working instructions for agents contributing to Cypheria.

## Project Context

Cypheria is a TypeScript Web3 agent product inspired by Codex. Its target architecture has one privileged server and multiple clients:

- `@cypheria/runtime`: Cypheria-owned non-agent runtime for Web3, wallets, signing policy, dApp browser permissions, automation, local state, and audit logs.
- `@cypheria/client`: the layered WebSocket client for the versioned Cypheria server protocol; `ServerClient` owns a connection, `CypheriaApi` borrows one, and `CypheriaClient` adds lifecycle control.
- `apps/server`: the Hono/Node.js process boundary that owns runtime lifecycle, versioned client connections, operations, web hosting, and eventually Codex/product services.
- `apps/expo`: the Expo Router client for iOS, Android, and static web; its web export is embedded by the server.
- `apps/cli`: a planned non-TUI client of the Cypheria server protocol.
- `@cypheria/sdk`: a planned public TypeScript client of the Cypheria server protocol.
- `apps/desktop`: an Electron + TanStack Start client that will ensure a local server is running. Until its migration is explicitly approved, its current direct runtime/Codex ownership remains unchanged.
- `apps/marketplace`: a TanStack Start application on Cloudflare Workers that owns Cypheria plugin submission, scanning, review, publication, public discovery, and deterministic synchronization to the official Cypheria GitHub repo marketplace.

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
apps/expo
apps/marketplace
apps/server

packages/sdk
packages/client
packages/protocol
packages/runtime
packages/codex-bridge
packages/ui
packages/network-core
packages/wallet-core
packages/wallet-provider
packages/policy-engine
packages/automation-core
packages/db
```

`apps/cli`, `apps/marketplace`, and `packages/sdk` are planned packages. Do not treat their absence as a reason to route CLI or SDK behavior through desktop internals or to bypass the server protocol.

Every Cypheria Marketplace plugin must follow the ChatGPT/Codex plugin specification and use a public open-source GitHub `url` or `git-subdir` source pinned by commit SHA. D1 owns review/publication state; the backend deterministically aggregates published entries into the official Cypheria GitHub repo at `.agents/plugins/marketplace.json`. Desktop uses the Cypheria API for discovery and trust metadata, then uses generated Codex App Server `marketplace/add`, `marketplace/upgrade`, and `plugin/install` methods for installation. Other public, personal, shared, workspace, repository, Git, npm, and local sources remain App Server-owned. Preserve provider provenance and never present one provider's trust or availability as the other's.

## Codex Integration Rules

- The target server owns `@cypheria/runtime` and Codex process/SDK integration for all clients.
- CLI and SDK use the versioned Cypheria server protocol and must not import `@cypheria/runtime` or `@openai/codex-sdk` directly.
- CLI must not depend on `@cypheria/sdk`.
- CLI and SDK must not depend on Electron, desktop packages, or `@cypheria/codex-bridge`.
- Desktop currently uses a persistent `codex app-server` process and runtime inside Electron main. Keep that implementation unchanged until the server is reviewed and desktop migration is explicitly requested.
- After migration, Electron main has the special client responsibility of ensuring a local Cypheria server is running while retaining Electron-only browser, secure-storage, preload, approval, and OS integration boundaries.
- `@cypheria/protocol` owns the Cypheria client/server protocol plus the generated Codex App Server types, JSON Schemas, response mappings, and per-message Zod validators.
- `@cypheria/codex-bridge` is the desktop-side Codex App Server bridge. It consumes raw Codex types from `@cypheria/protocol/codex-types` and Cypheria message contracts from `@cypheria/protocol`; it must not own a generated copy. Until the bridge is refactored around the Cypheria messages, its raw Codex JSON-RPC validation remains bridge-owned.
- Do not create `@cypheria/codex-protocol`.
- Do not hand-write Codex App Server protocol types.
- Codex App Server generated artifacts must live in:

```txt
packages/protocol/src/generated/codex/
  ts/
  schema/
```

Generate those files with:

```sh
pnpm --filter @cypheria/protocol generate:codex-all
```

The protocol package script always enables experimental APIs, normalizes generated Rust 64-bit integers to the JSON wire type `number`, adds explicit TypeScript extensions to relative generated imports for NodeNext consumers, and generates the JSON Schemas, response mappings, and per-message Zod schemas used for validation. Generated protocol files and schemas should be committed so CI and contributors can typecheck and validate without a matching local Codex binary.

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

- Private keys, signing, automation execution, local database access, and browser session management belong in the Cypheria server/runtime, Electron-only privileged services during the staged migration, or isolated child/worker processes.
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
- Before hand-writing common controls such as select menus, popovers, dropdown menus, dialogs, tabs, switches, sliders, color inputs, or tooltips, check whether the shadcn CLI can add the component to `packages/ui`; prefer installing and using the shared shadcn-style component unless the screen needs a genuinely custom control.
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
