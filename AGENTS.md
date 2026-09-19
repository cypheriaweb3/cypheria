# Contributor Instructions

## Read first

Use these documents instead of repeating architecture in task notes:

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Active roadmap](docs/todo.md)

`apps/marketplace` and `packages/sdk` are planned and do not exist. The implemented workspace is listed in [Development](docs/development.md#workspace).

## Workflow

- Use `docs/todo.md` as the source for approved incomplete work.
- Keep changes reviewable, testable, and focused.
- Inspect the implementation and tests before changing a public contract.
- Run narrow checks while iterating and root checks for cross-workspace changes.
- Preserve unrelated work in a dirty tree.
- Use signed commits: `git commit -S`.
- Do not rewrite published history without explicit authorization.

## Commands

Use pnpm, not npm, Yarn, or Bun. pnpm commands should normally run with access to the global pnpm store.

```sh
pnpm install
pnpm docs:check
pnpm check
pnpm run ci
pnpm build
pnpm format
pnpm lint
```

The relay additionally requires Go. Package-specific commands are documented in [Development](docs/development.md).

## Documentation

- English is the content source; maintained product pages have complete `.zh-CN.md` companions with matching heading topology.
- Leave implemented behavior unmarked; label planned and generated material explicitly. Do not preserve migration diaries, completed checklists, or obsolete designs.
- One document owns each fact. Link to it instead of copying details.
- Update relevant English and Chinese docs in the same change when behavior, architecture, commands, public interfaces, or package boundaries change.
- Generated Codex API pages are updated by their generator, never manually.
- Run `pnpm docs:check` after documentation changes.

## Code boundaries

- `apps/server` owns shared state, database access, Agent runtimes and adapters, schedules, integrations, privileged terminals, Web3 execution, and audit.
- Clients use `@cypheria/client` and `@cypheria/protocol`; they do not import Server internals, repositories, or Agent SDKs.
- Electron main may manage a local Server and owns only Desktop-local windows, isolated dApp views, preload, settings, updates, secure storage, and OS integration.
- AI SDK providers are browser-safe and depend on the shared client, protocol, and public AI SDK types.
- Domain packages do not depend on `apps/server`; Server composition uses explicit services.
- CLI does not depend on Desktop, Electron, Server internals, or the planned public SDK.

## Protocol and generated code

- Zod validates runtime boundaries; TypeScript remains strict.
- `@cypheria/protocol` owns the public protocol and generated native adapter artifacts.
- Do not hand-write Codex App Server types or create a separate Codex protocol package.
- Generate committed Codex artifacts with:

```sh
pnpm --filter @cypheria/protocol generate:codex-all
```

- Harness-native messages stay behind Server adapters. Public conversation history is the Canonical Timeline.
- Thread operations use Cypheria Thread IDs; harness session IDs are diagnostic linkage only.

## Runtime data

`CYPHERIA_HOME` defaults to `~/.cypheria`. Resolve it once per privileged process and pass derived paths to services. Cypheria-managed Codex processes use `CODEX_HOME=$CYPHERIA_HOME/codex` and do not mutate the user's default Codex home.

Do not commit local homes, IDE state, dependency directories, caches, build output, or secrets.

## Security

- Private keys, signing, policy evaluation, schedule execution, database access, Agent processes, and plugin processes stay in the Server or controlled workers.
- Renderer and dApp pages never receive Node.js access, private keys, raw signers, or database access.
- Every signing intent passes policy. Auto-signing is off unless an explicit enabled policy allows the exact action.
- dApp sessions are isolated by origin.
- Signatures, rejections, policy decisions, schedule runs, and transaction results are auditable.
- Interrupted signing or sending is never replayed automatically.

Electron browser views keep conservative defaults: no Node integration, context isolation and sandbox enabled, and web security enabled.

## UI

- Preserve the established Sidebar and conversation experience; they are release gates.
- Use shared shadcn-style and Base UI primitives before creating generic controls.
- Keep the visual system quiet, low-saturation, compact, accessible, and panel-oriented.
- Build custom controls only for genuine Cypheria domains such as Timeline items, wallets, signing, policy, dApp permissions, and browser context.
- Codex, Claude, Pi, OpenCode, and ACP share the common conversation shell; harness UI is an extension, not a cloned application.

## Out of scope unless explicitly approved

- Forking an Agent runtime
- A TUI
- Cloud Agent execution
- Multi-Agent orchestration
- A complex workflow engine
- Private keys in renderer, browser storage, ordinary SQLite fields, or logs
