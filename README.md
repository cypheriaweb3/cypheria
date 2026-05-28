# Cypheria

Cypheria is a cross-platform Web3 agent desktop inspired by Codex Desktop. It combines local coding-agent workflows with Web3-native capabilities: wallet management, an isolated dApp browser, task automation, and Web3 vibe coding.

The project is currently in early foundation work. The repository contains the monorepo skeleton, technical stack decisions, and architecture baseline that future implementation should build on.

## Product Direction

Cypheria V1 focuses on four product surfaces:

- **Wallet Manager**: local wallets, Privy wallets, account context, chain/RPC configuration, approvals, and signing policies.
- **Web3 App Browser**: an Electron-powered browser surface for dApps, with one isolated session per origin and an injected EIP-1193 provider bridge.
- **Task Automation**: scheduled and manual tasks that can use Codex, read chain state, draft transactions, and route signing intents through policy evaluation.
- **Web3 Vibe Coding**: Codex Desktop-style coding workflows for contracts, dApps, indexers, integrations, audits, tests, and workspace automation.

The default safety model is human approval. Read-only mode and conditional auto-signing are supported as explicit policy modes.

## Tech Stack

- **Desktop**: Electron
- **Frontend**: TanStack Start, TanStack Router, TanStack Query
- **State**: Jotai
- **Forms**: TanStack Form + Zod
- **Monorepo**: Turborepo + pnpm workspace
- **Lint/format**: Biome
- **UI**: shadcn/ui, Tailwind CSS, lucide-react, Sonner, Monaco Editor, xterm.js
- **Codex integration**: embedded Codex App Server via Electron main process
- **Web3**: viem, Privy, WalletConnect / Reown
- **Data**: SQLite + Drizzle ORM

See [docs/technical-stack.md](docs/technical-stack.md) for the full technical stack.

## Architecture

At a high level, Cypheria separates trusted local capabilities from untrusted web content:

```txt
Electron Main Process
  - Local permissions, wallets, signing, Codex child process, automation, database, audit logs

TanStack Start Renderer
  - Product UI, routing, state display, user interaction entry points

Isolated Web3 Browser WebContents
  - dApp pages, one persistent session per origin

Codex App Server Child Process
  - Codex threads, turns, approvals, diffs, terminal, MCP, workspace operations
```

See [docs/architecture.md](docs/architecture.md) for the architecture baseline.

## Repository Layout

```txt
apps/desktop
  main/       Electron main process
  preload/   Secure bridges for app and browser surfaces
  renderer/  TanStack Start renderer app

packages/ui
packages/ipc
packages/codex-bridge
packages/wallet-core
packages/web3-browser
packages/policy-engine
packages/runtime
packages/db
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

Run the current build pipeline:

```sh
pnpm build
```

Format files:

```sh
pnpm format
```

In this repository, pnpm-related commands should usually run outside the sandbox so pnpm can use its global store.

## Current Status

The repository currently contains the foundational monorepo setup and placeholder package boundaries. The next implementation milestones are:

- Add the TanStack Start renderer app.
- Define typed IPC contracts.
- Implement the Codex App Server bridge.
- Build the first wallet, policy, and Web3 browser service skeletons.
- Add the first shadcn-based UI shell.

## License

MIT
