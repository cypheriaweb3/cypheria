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

`apps/marketplace` is a planned workspace and is not part of the dependency graph.

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
pnpm --filter @cypheria/server dev
pnpm --filter @cypheria/desktop dev
pnpm --filter @cypheria/expo dev
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
```

The product CLI is built separately:

```sh
pnpm --filter @cypheria/cli build
pnpm --filter @cypheria/cli exec cypheria --help
```

See [Server](server.md) for lifecycle commands and runtime paths.

## Generated artifacts

Codex App Server TypeScript types, JSON Schemas, validators, response mappings, and API reference are generated from the installed Codex binary:

```sh
pnpm codex:generate
```

Generated output is committed under `packages/protocol/src/generated/codex/` and in the two Codex API reference pages. Do not edit these files manually. CI checks that the API pages match their generator; full protocol regeneration requires a compatible local Codex binary.

The generator normalizes Rust 64-bit integers to JSON `number`, adds explicit TypeScript extensions for NodeNext consumers, and enables the experimental API surface used by Cypheria.

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
