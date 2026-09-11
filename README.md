# Cypheria

Cypheria is a cross-platform Web3 agent product inspired by Codex. It is built in TypeScript and combines Codex-powered software engineering workflows with Cypheria-owned Web3 runtime capabilities: wallets, an isolated dApp browser, signing policies, local automation, and audit logs.

Cypheria does not reimplement the Codex agent core. The target architecture has one long-running Cypheria server that owns privileged runtime and Codex integration, while desktop, Expo, web, mobile, CLI, and SDK surfaces are clients. Web3 permissions, wallet state, signing, automation, policy evaluation, and auditability remain in the Cypheria runtime behind that server boundary.

## Product Direction

Cypheria V1 is organized around one server and multiple clients:

- **Runtime**: the TypeScript core for Cypheria-owned non-agent capabilities, including wallets, chains, policies, automation, browser permissions, settings, local state, and audit logs.
- **Server**: a Hono + Node.js control plane that owns runtime lifecycle, client sessions, diagnostics, static web hosting, and later Codex/product services.
- **Expo client**: one Expo Router application for iOS, Android, and static web output. The server embeds the web output.
- **Shared client**: `@cypheria/client` provides the WebSocket protocol driver, a borrowed API
  facade, and a connection-owning facade without owning the privileged runtime.
- **CLI and SDK clients**: planned product clients built on the server protocol.
- **Desktop client**: eventually starts a local server when necessary and connects to it. The current desktop implementation remains unchanged until the new server is reviewed and migration is approved.
- **Marketplace**: a TanStack Start app on Cloudflare Workers for submission, scanning, review, publication, discovery, and synchronization of reviewed ChatGPT/Codex plugins to the official Cypheria GitHub repo marketplace.

The default safety model is human approval. Read-only mode and conditional auto-signing are explicit policy modes. Codex and automation flows may create signing intents, but every signing intent must go through Cypheria policy evaluation before a signature or transaction broadcast.

## Tech Stack

- **Language**: TypeScript
- **Monorepo**: Turborepo + pnpm workspace
- **Desktop**: Electron
- **Cross-platform client**: Expo SDK 57 + Expo Router
- **Server**: Hono on Node.js with HTTP and WebSocket transports
- **Frontend**: TanStack Start, TanStack Router, TanStack Query
- **State**: Jotai
- **Forms and validation**: TanStack Form + Zod
- **Lint/format**: Biome
- **UI**: shadcn-style copied components, Base UI primitives, Cypheria CSS tokens, lucide-react
- **Cypheria client protocol**: versioned Zod contracts with metadata-assisted `bigint` transport in `@cypheria/protocol`
- **Desktop agent integration**: `codex app-server` over WebSocket JSON-RPC
- **Codex protocol types and validation**: owned by `@cypheria/protocol` and generated with `pnpm --filter @cypheria/protocol generate:codex-all`
- **Marketplace hosting**: Cloudflare Workers, D1, R2, Queues, and Workflows
- **Web3**: viem, Privy, WalletConnect / Reown
- **Data**: SQLite + Drizzle ORM

See [docs/technical-stack.md](docs/technical-stack.md) for the full technical stack.
See [docs/codex-app-server-api.md](docs/codex-app-server-api.md) for the complete generated Codex App Server API reference.

## Architecture

```txt
apps/expo / @cypheria/client / future apps/cli / packages/sdk
  -> @cypheria/protocol over HTTP or WebSocket
  -> apps/server
  -> @cypheria/runtime

apps/server
  -> Hono HTTP + WebSocket control plane
  -> supervisor + worker lifecycle
  -> embedded apps/expo static web export

apps/desktop renderer
  -> Electron typed IPC
  -> Electron main
  -> @cypheria/runtime
  -> @cypheria/codex-bridge
  -> persistent codex app-server over WS
  (temporary pre-migration implementation; unchanged)

apps/marketplace
  -> TanStack Start on Cloudflare Workers
  -> D1 publication system of record + R2 immutable artifacts
  -> Queues + Workflows for scan/review/publication
  -> generated .agents/plugins/marketplace.json in the official GitHub repo

apps/desktop plugins
  -> Cypheria Marketplace API for discovery/trust (planned)
  -> Codex App Server marketplace/add + plugin/install
```

The desktop renderer is a product UI, not a privileged runtime. It uses typed IPC to request capabilities from Electron main. Private keys, signing operations, dApp browser sessions, local database access, automation execution, and Codex App Server lifecycle management stay outside the renderer.

See [docs/architecture.md](docs/architecture.md) for the architecture baseline, [docs/codex-permissions.md](docs/codex-permissions.md) for the Codex Desktop permissions design, and [docs/network-management.md](docs/network-management.md) for the network and RPC design.

## Repository Layout

```txt
apps/cli
  Non-TUI command-line app.

apps/expo
  Expo Router client for iOS, Android, and static web.

apps/server
  Hono server, client-session protocol, runtime host, web host, and supervised daemon.

apps/desktop
  ipc/        Desktop-local typed IPC contracts and schemas
  main/       Electron main process
  preload/   Secure bridges for app and browser surfaces
  renderer/  TanStack Start renderer app

apps/marketplace
  Plugin submission, review, publication, discovery, and GitHub marketplace synchronization

packages/sdk
packages/client
packages/protocol
packages/runtime
packages/codex-bridge
packages/acp-ai-provider
packages/ui
packages/network-core
packages/wallet-core
packages/automation-core
packages/wallet-provider
packages/policy-engine
packages/db
```

`apps/cli`, `apps/marketplace`, and `packages/sdk` remain planned. `apps/server`, `apps/expo`,
`packages/client`, and `packages/protocol` provide the client/server foundation. See
[docs/server.md](docs/server.md) for its protocol, operations, security, and packaging contract.

## Runtime Home

Cypheria owns its local application home:

```sh
CYPHERIA_HOME="${CYPHERIA_HOME:-~/.cypheria}"
CODEX_HOME="$CYPHERIA_HOME/codex"
```

Recommended layout:

```txt
$CYPHERIA_HOME/
  codex/        Cypheria-managed Codex home
  db/           SQLite databases
  vault/        encrypted wallet vault files and metadata
  logs/         app, automation, policy, and audit logs
  cache/        disposable app caches
  browser/      dApp browser session partitions and metadata
  automation/   task definitions, run state, and worker metadata
  config/       Cypheria settings
```

## Development

Install dependencies:

```sh
pnpm install
```

Run all checks:

```sh
pnpm run ci
```

Run TypeScript checks through Turborepo:

```sh
pnpm check
```

Run the build pipeline:

```sh
pnpm build
```

Run the server daemon or Expo client during development:

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server daemon start
pnpm --filter @cypheria/expo dev
```

Run the renderer dev server:

```sh
pnpm --filter @cypheria/desktop dev:renderer
```

Load the renderer in Electron during local development:

```sh
CYPHERIA_RENDERER_URL=http://127.0.0.1:5173 pnpm --filter @cypheria/desktop dev
```

Format files:

```sh
pnpm format
```

In this repository, pnpm-related commands should usually run outside the sandbox so pnpm can use its global store.

## Current Status

The repository now includes the versioned Cypheria protocol, the layered `@cypheria/client`, a
supervised Hono server with HTTP/WebSocket operations and embedded web hosting, and an Expo SDK 57
client that exports iOS, Android, and static web surfaces. The existing desktop implementation is
deliberately untouched and remains on its current direct-runtime path until server review and a
separate migration change.

The next implementation sequence is tracked in [docs/todo.md](docs/todo.md).
The canonical logo, application-icon assets, and usage rules are documented in [docs/brand.md](docs/brand.md).

## License

MIT
