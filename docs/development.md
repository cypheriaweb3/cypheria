---
title: Development
---

# Development

This guide is the canonical reference for the workspace, toolchain, generated artifacts, and verification workflow. Product ownership belongs in [Architecture](architecture.md).

## Requirements

- Node.js 24 or newer
- pnpm 11.1.3, as pinned by the root `packageManager`
- Go 1.25 for `apps/relay`, `apps/node-repl`, and `apps/browser-extension-host`
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
| `apps/cua` | The Computer Use runtime: the `cua_repl` launcher and `cua` API, the Server host for its surfaces, the embedded cua-driver supervisor, and the hidden `cua` plugin template |
| `apps/node-repl` | Go node_repl MCP server and supervisor, plus the TypeScript kernel it embeds, for persistent sandboxed JavaScript execution |
| `apps/browser-extension` | The Cypheria Chromium extension (WXT, Manifest V3) and the protocol it shares with its native host and Desktop |
| `apps/browser-extension-host` | Go native messaging host that relays the extension's messages to Desktop |
| `apps/website` | TanStack Start marketing and Fumadocs site on Cloudflare Workers |

Implemented packages:

| Workspace | Responsibility |
| --- | --- |
| `packages/protocol` | Public protocol, Zod validation, generated Codex artifacts |
| `packages/client` | Public TypeScript SDK, connection lifecycle, and domain facades |
| `packages/db` | SQLite schema, migrations, and repositories |
| `packages/storage` | Cross-platform client key/value, replica, attachment, and Jotai adapters |
| `packages/web3` | Pure Web3 domain modules |
| `packages/relay` | Pairing, E2EE, and relay transport helpers |
| `packages/ui` | Shared UI and conversation presentation primitives |

Bundled plugins:

| Workspace | Responsibility |
| --- | --- |
| `plugins` | The bundled `cypheria-bundled` marketplace: Codex and Claude marketplace files beside the plugins they list |
| `plugins/cypheria-app-tools` | The app tools plugin: manifests and the MCP relay, with no build |
| `plugins/code-review` | The `code-review` plugin and its package: manifests, the MCP relay in `src/server`, and the Code Review MCP App in `src/app`, built into `dist/app.html` |
| `plugins/browser`, `plugins/chrome`, `plugins/computer-use` | Manifests and icons of the Computer Use surfaces; their runtime is `apps/cua` |

Agents install bundled plugins from `plugins/` in a checkout. A Server build assembles the marketplace in `apps/server/dist/marketplace` and packages `code-review` the way `node plugins/code-review/scripts/build.mjs --plugin-dir <dir>` does, so the installed plugin carries only its manifests, relay, and built App.

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

Both Desktop commands also build the browser extension into `apps/browser-extension/.output/chrome-mv3` and its native host into `apps/browser-extension-host/dist/<platform>-<arch>/`; Desktop installs the host and registers it with your browsers at startup. To use the extension, load that directory as an unpacked extension at the browser's extensions page; see [Browser extension](features/browser-extension.md#development).

Development builds show a **Chat Demo** item at `/chat-demo`: an interactive showcase of the shared chat components with fixture data and no Agent runtime, covering the virtualized long transcript, every Timeline family, every panel tab, the workspace Files tab, and the composer's references and attachments. Packaged builds hide the item and redirect the route. Its removal is planned in the [roadmap](roadmap.md#desktop).

The product CLI is built separately:

```sh
pnpm --filter @cypheria/cli build
pnpm --filter @cypheria/cli exec cypheria --help
```

See [Server](server/runtime.md) for lifecycle commands and runtime paths.

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

This maintainer command downloads, validates, normalizes, and writes `packages/protocol/src/generated/acp/registry.json` plus the reviewed subset in `agent-ids.ts`. Every approved ID must exist in the snapshot. Both files are committed and reviewed together. Normal builds and checks validate only the local snapshot and never fetch registry data.

The node_repl kernel is written in TypeScript under `apps/node-repl/src/` and bundled by Vite into `apps/node-repl/internal/assets/files/`, which the Go binary embeds. Third-party dependencies such as `meriyah` go into a minified `vendor.js` chunk with their notices in `THIRD_PARTY_LICENSES.txt`, while Cypheria sources stay unminified for debugging:

```sh
pnpm --filter @cypheria/node-repl build:js
```

The bundle is ignored by Git except `package.json`. The package `build`, `check`, and `test` scripts regenerate it before running Go, so run `build:js` first only when invoking `go` directly.

The Computer Use launcher and runtime are built by Vite into `apps/cua/dist`. Native app control needs the pinned cua-driver release, which a maintainer fetches with digest verification before a Desktop build; see [Computer Use](features/computer-use.md#desktop-apps):

```sh
pnpm --filter @cypheria/cua build
pnpm --filter @cypheria/cua fetch:cua-driver
```

The browser engine vendors parts of Playwright from the pinned `playwright-core`; run `pnpm --filter @cypheria/cua vendor:playwright` after changing that pin.

## Testing strategy

- Protocol tests validate schemas, version negotiation, harness adapters, and Timeline projection.
- Client tests validate transports, request lifecycle, domain facades, relay transport, and error normalization.
- Server tests cover Agent runtimes, lazy harness catalog caching and invalidation, configuration, projects and threads, schedules, integrations, Web3 services, and operations.
- Desktop tests cover Server management, preload contracts, the flattened Settings navigation model, Sidebar data adaptation, and conversation behavior. Settings navigation and model catalogs have independent virtualizers; Agent child rows must not introduce a nested navigation virtualizer.
- Relay tests cover cryptography and data-plane behavior.

Tests should exercise public boundaries rather than import private files from another workspace. Fixture replay is preferred for native Agent event adaptation.

## Dependency rules

- Clients depend on `@cypheria/client` and `@cypheria/protocol`, not Server internals or databases.
- Conversation consumers use `@cypheria/client` directly; no AI SDK compatibility layer is maintained.
- Renderer code does not import Agent SDKs, generated native protocols, database code, or privileged Web3 services.
- Domain packages do not depend on `apps/server`; the Server composes them through explicit injection.
- CLI uses `@cypheria/client` directly and does not depend on Electron or Desktop.

## Documentation workflow

Documents live under `docs/` by domain: `server/` for the Server process and its contracts, `agents/` for harnesses, Codex, and plugins, `desktop/` for the Desktop client, `features/` for product capabilities that span the Server and clients, `design/` for the visual system, and `planned/` for designs not yet implemented. [Architecture](architecture.md), this guide, and the [roadmap](roadmap.md) stay at the top. File names are short lowercase nouns without a repeated folder prefix.

English is the source document and each maintained product page has a complete `.zh-CN.md` companion with the same heading topology. One page owns each subject; other pages link to it. Documents describe Cypheria. Where Cypheria follows ChatGPT or the official Codex desktop, they say so, but specific ChatGPT versions, bundle names, and local analysis paths belong in the ChatGPT analysis notes, not here.

Run `pnpm docs:check` after documentation changes. Generated pages are updated through their generator. Current behavior is left unmarked; planned work and generated references must be labeled explicitly. Historical change logs belong in Git, not the product documentation.

## Contribution workflow

1. Choose one reviewable, testable item from [Roadmap](roadmap.md) or an agreed issue.
2. Inspect the repository implementation before changing public behavior or boundaries.
3. Update English and Chinese documentation in the same change when behavior, architecture, commands, or interfaces change.
4. Run the narrowest relevant checks, then root CI for cross-workspace changes.
5. Keep commits focused and signed.

Never commit secrets, local application homes, build output, caches, or dependency directories.
