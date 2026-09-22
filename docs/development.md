---
title: Development
---

# Development

This guide is the canonical reference for the workspace, toolchain, generated artifacts, and verification workflow. Product ownership belongs in [Architecture](architecture.md).

## Requirements

- Node.js 24 or newer
- pnpm 11.1.3, as pinned by the root `packageManager`
- Go 1.25 for `apps/relay`
- A compatible Codex binary when regenerating Codex App Server artifacts

Use pnpm for JavaScript and TypeScript workspace commands. The repository uses Turborepo for task orchestration and Biome for formatting and linting.

## Workspace

Implemented applications:

| Workspace | Responsibility |
| --- | --- |
| `apps/server` | Hono/Node.js Server, Agent adapters, persistence, schedules, Web3, and web hosting |
| `apps/desktop` | Electron main/preload and TanStack Start desktop client |
| `apps/expo` | Expo Router foundation and static web export |
| `apps/cli` | Non-TUI protocol client and local Server lifecycle commands |
| `apps/relay` | Go encrypted relay data plane |
| `apps/website` | TanStack Start marketing and Fumadocs site on Cloudflare Workers |

Implemented packages:

| Workspace | Responsibility |
| --- | --- |
| `packages/protocol` | Public protocol, Zod validation, generated Codex artifacts |
| `packages/client` | Public TypeScript SDK, connection lifecycle, and domain facades |
| `packages/ai-sdk-provider` | Browser-safe AI SDK providers backed by the client |
| `packages/db` | SQLite schema, migrations, and repositories |
| `packages/web3` | Pure Web3 domain modules |
| `packages/relay` | Pairing, E2EE, and relay transport helpers |
| `packages/ui` | Shared UI primitives and AI Elements |

Future Marketplace routes belong to `apps/website`; the current application has no Marketplace route, account system, API, schema, or Cloudflare storage binding.

## Install and verify

```sh
pnpm install
pnpm run docs:check
pnpm run check
pnpm run ci
pnpm run build
```

The commands have distinct purposes:

- `docs:check` validates internal documentation and generated Codex API reference drift.
- `check` runs workspace type and package checks through Turborepo.
- `ci` runs documentation checks, Biome CI, and workspace checks.
- `build` produces all buildable workspace outputs.
- `format` writes Biome formatting; `lint` reports Biome lint results.

Use package filters while iterating:

```sh
pnpm --filter @cypheria/server test
pnpm --filter @cypheria/protocol check
pnpm --filter @cypheria/client test
pnpm --filter @cypheria/desktop typecheck
pnpm --filter @cypheria/website check
pnpm --filter @cypheria/cypheria-relay test
```

## Local development

Build the Server before using its packaged CLI:

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server server start
```

Common development processes:

```sh
pnpm dev:desktop
pnpm dev:desktop:stop
pnpm --filter @cypheria/server dev
pnpm --filter @cypheria/desktop dev
pnpm --filter @cypheria/expo dev
pnpm --filter @cypheria/website dev
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
```

`pnpm dev:desktop` is the integrated Desktop development command. It builds the Electron main and preload entry points, starts the watched Server and Vite renderer, waits for both to become ready, and then opens the development application. Renderer changes use Vite HMR and Server changes use the Server watcher; Electron main or preload changes require restarting the command. The command grants `http://127.0.0.1:5173` WebSocket access only to the Server process it starts and preserves any explicitly configured allowed origins. Stop it from the same terminal or run `pnpm dev:desktop:stop` from another terminal; either path terminates the complete Server, Vite, and Electron process trees. Packaged Desktop builds continue to load `cypheria://app` and do not trust the Vite origin.

Use `pnpm --filter @cypheria/desktop dev` only when testing the one-time built renderer instead of the HMR workflow.

The Desktop development shell exposes a fixed **Chat Demo** navigation item at `/chat-demo`. It is
a local interactive showcase for the shared chat components and does not contact an Agent runtime.
Its transcript uses `@tanstack/react-virtual` with 128 variable-height messages, measured rows,
overscan, sampled turn navigation, and live message appends so long-conversation behavior can be
inspected without production data. The preload bootstrap flag hides the item and redirects the
route in packaged production builds. Its right and bottom surfaces are simultaneously resizable and
offer all 25 audited content hosts as tabs: sources, subagents, plan, summary, goal, review,
pull request, terminal, file, image, browser, MCP App, automation, artifact, PDF, document, notebook,
presentation, workbook, entity details, side chat, MCP thread/file extensions, sandbox, and a
secondary timeline. A floating display controller switches nine Timeline families and individual
panel tabs between a compact curated view and the exhaustive catalog.

### Removing Chat Demo

Chat Demo is temporary development scaffolding. When the production conversation workspace has
adopted the shared chat components, remove the demo with this checklist:

1. Delete `apps/desktop/renderer/src/components/chat-demo.tsx`, its test, and
   `apps/desktop/renderer/src/routes/chat-demo.tsx`.
2. Remove the `Chat Demo` item, `MessageSquare` import, and development-item filtering from
   `chat-sidebar.tsx`.
3. If no other development-only renderer feature uses it, delete `development-mode.ts` and its
   test, then remove `bootstrap.development`, `CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX`, and the
   corresponding main/preload argument wiring.
4. Regenerate `routeTree.gen.ts` with `pnpm --filter @cypheria/desktop build:renderer`; never edit
   the generated route tree by hand.
5. Keep the complete, pinned `packages/ui/src/components/icons` mirror. It is a shared UI asset and
   is intentionally not pruned according to Demo imports; only change it as a separately reviewed
   upstream-mirror update, including its README revision and license record.
6. Remove this cleanup section and the preceding Chat Demo paragraph, then run the Desktop tests,
   Desktop typecheck, strict Lingui compile, `pnpm docs:check`, and root `pnpm check`.

Do not delete `packages/ui/src/components/chat`, the icons directory itself, or the Codex
conversation UI reference documents when removing the demo. They are reusable production assets,
not demo scaffolding. Chat Demo deliberately has no Lingui catalog entries to clean up.

The product CLI is built separately:

```sh
pnpm --filter @cypheria/cli build
pnpm --filter @cypheria/cli exec cypheria --help
```

See [Server](server.md) for lifecycle commands and runtime paths.

The website uses English at root paths and Simplified Chinese under `/zh-CN`. Lingui owns marketing copy; Fumadocs consumes `docs/*.md` and their `.zh-CN.md` companions directly. `pnpm --filter @cypheria/website build` compiles strict catalogs, prerenders every marketing and documentation route, emits the static ZBSearch index, and builds the Worker fallback. Use `pnpm --filter @cypheria/website exec wrangler dev` for the production-shaped local runtime.

## Generated artifacts

Codex App Server TypeScript types, JSON Schemas, validators, response mappings, and API reference are generated from the installed Codex binary:

```sh
pnpm codex:generate
```

Generated output is committed under `packages/protocol/src/generated/codex/` and in the two Codex API reference pages. Do not edit these files manually. CI checks that the API pages match their generator; full protocol regeneration requires a compatible local Codex binary.

The generator normalizes Rust 64-bit integers to JSON `number`, adds explicit TypeScript extensions for NodeNext consumers, and enables the experimental API surface used by Cypheria.

The stable ACP registry snapshot and its runtime Agent ID allowlist are also generated artifacts:

```sh
pnpm --filter @cypheria/protocol generate:agent-acp-registry
```

This maintainer command downloads, validates, normalizes, and writes `packages/protocol/src/generated/acp/registry.json` plus `agent-ids.ts`. Both files are committed and reviewed together. Normal builds and checks validate only the local snapshot and never fetch registry data.

## Testing strategy

- Protocol tests validate schemas, version negotiation, harness adapters, and Timeline projection.
- Client tests validate transports, request lifecycle, domain facades, relay transport, and error normalization.
- Server tests cover Agent runtimes, lazy harness catalog caching and invalidation, configuration, projects and threads, schedules, integrations, Web3 services, and operations.
- Desktop tests cover Server management, preload contracts, the flattened Settings navigation model, Sidebar data adaptation, and conversation behavior. Settings navigation and model catalogs have independent virtualizers; Agent child rows must not introduce a nested navigation virtualizer.
- Relay tests cover cryptography and data-plane behavior.

Tests should exercise public boundaries rather than import private files from another workspace. Fixture replay is preferred for native Agent event adaptation.

## Dependency rules

- Clients depend on `@cypheria/client` and `@cypheria/protocol`, not Server internals or databases.
- AI SDK providers depend only on the client, protocol, and public AI SDK types.
- Renderer code does not import Agent SDKs, generated native protocols, database code, or privileged Web3 services.
- Domain packages do not depend on `apps/server`; the Server composes them through explicit injection.
- CLI uses `@cypheria/client` directly and does not depend on Electron or Desktop.

## Documentation workflow

English is the source document and each maintained product page has a complete `.zh-CN.md` companion with the same heading topology. One page owns each subject; other pages link to it.

Run `pnpm docs:check` after documentation changes. Generated pages are updated through their generator. Current behavior is left unmarked; planned work and generated references must be labeled explicitly. Historical change logs belong in Git, not the product documentation.

## Contribution workflow

1. Choose one reviewable, testable item from [Todo](todo.md) or an agreed issue.
2. Inspect the repository implementation before changing public behavior or boundaries.
3. Update English and Chinese documentation in the same change when behavior, architecture, commands, or interfaces change.
4. Run the narrowest relevant checks, then root CI for cross-workspace changes.
5. Keep commits focused and signed.

Never commit secrets, local application homes, build output, caches, or dependency directories.
