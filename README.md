# Cypheria

Cypheria is a cross-platform Web3 agent product inspired by Codex. It is built in TypeScript and combines Codex-powered software engineering workflows with Cypheria-owned Web3 runtime capabilities: wallets, an isolated dApp browser, signing policies, local automation, and audit logs.

Cypheria does not reimplement the Codex agent core. CLI and SDK surfaces use the official Codex TypeScript SDK for agent workflows. The desktop app runs a long-lived Codex App Server and talks to it through WebSocket JSON-RPC. Web3 permissions, wallet state, signing, automation, policy evaluation, and auditability belong to the Cypheria runtime.

## Product Direction

Cypheria V1 has four entry points:

- **Runtime**: the TypeScript core for Cypheria-owned non-agent capabilities, including wallets, chains, policies, automation, browser permissions, settings, local state, and audit logs.
- **CLI**: a non-TUI command-line surface that directly composes `@cypheria/runtime` and `@openai/codex-sdk`.
- **SDK**: a TypeScript library for external apps that directly composes `@cypheria/runtime` and `@openai/codex-sdk`.
- **Desktop**: an Electron + TanStack Start app that runs Cypheria runtime in the main process and a persistent Codex App Server for rich agent workflows.

The default safety model is human approval. Read-only mode and conditional auto-signing are explicit policy modes. Codex and automation flows may create signing intents, but every signing intent must go through Cypheria policy evaluation before a signature or transaction broadcast.

## Tech Stack

- **Language**: TypeScript
- **Monorepo**: Turborepo + pnpm workspace
- **Desktop**: Electron
- **Frontend**: TanStack Start, TanStack Router, TanStack Query
- **State**: Jotai
- **Forms and validation**: TanStack Form + Zod
- **Lint/format**: Biome
- **UI**: shadcn-style copied components, Base UI primitives, Cypheria CSS tokens, lucide-react
- **CLI/SDK agent integration**: `@openai/codex-sdk`
- **Desktop agent integration**: `codex app-server` over WebSocket JSON-RPC
- **Desktop Codex protocol types**: generated with `codex app-server generate-ts --out packages/codex-bridge/src/generated`
- **Web3**: viem, Privy, WalletConnect / Reown
- **Data**: SQLite + Drizzle ORM

See [docs/technical-stack.md](docs/technical-stack.md) for the full technical stack.

## Architecture

```txt
apps/cli
  -> @cypheria/runtime
  -> @openai/codex-sdk

packages/sdk
  -> @cypheria/runtime
  -> @openai/codex-sdk

apps/desktop renderer
  -> Electron typed IPC
  -> Electron main
  -> @cypheria/runtime
  -> @cypheria/codex-bridge
  -> persistent codex app-server over WS
```

The desktop renderer is a product UI, not a privileged runtime. It uses typed IPC to request capabilities from Electron main. Private keys, signing operations, dApp browser sessions, local database access, automation execution, and Codex App Server lifecycle management stay outside the renderer.

See [docs/architecture.md](docs/architecture.md) for the architecture baseline.

## Repository Layout

```txt
apps/cli
  Non-TUI command-line app.

apps/desktop
  ipc/        Desktop-local typed IPC contracts and schemas
  main/       Electron main process
  preload/   Secure bridges for app and browser surfaces
  renderer/  TanStack Start renderer app

packages/sdk
packages/runtime
packages/codex-bridge
packages/ui
packages/wallet-core
packages/automation-core
packages/web3-browser
packages/policy-engine
packages/db
```

`apps/cli` and `packages/sdk` are planned packages. They are part of the target architecture and will be implemented through the todo sequence.

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

The repository contains the foundational pnpm/Turborepo workspace, desktop-local typed IPC contracts, runtime home handling, Electron main process bootstrap, persistent desktop Codex App Server lifecycle, wallet/policy/Web3 browser domain baselines, local SQLite audit and automation persistence, shared UI primitives, and the first TanStack Start desktop shell.

The next implementation sequence is tracked in [docs/todo.md](docs/todo.md).

## License

MIT
