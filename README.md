# Cypheria

Cypheria is a local-first, cross-platform Web3 agent workspace. A privileged Cypheria Server owns Agent runtimes, projects, threads, canonical conversation history, schedules, wallets, policy evaluation, and audit data. Desktop, Expo, CLI, and future clients use the same versioned protocol.

## What is implemented

- A supervised Hono/Node.js server with HTTP, WebSocket, configuration, diagnostics, and embedded web hosting.
- First-party Codex, Claude, Pi, and OpenCode adapters, plus registry-backed ACP agents.
- Durable Projects, Threads, Sections, Canonical Timeline, interactions, terminals, and artifacts.
- A public `@cypheria/client` TypeScript SDK with direct Thread, Timeline, interaction, and harness facades.
- An Electron + TanStack Start desktop client with the established Sidebar and conversation workspace, local Git review, worktrees, and Code Review.
- Computer Use: Agents operate the built-in browser, MCP Apps, the user's Chromium browsers, and desktop apps through one `cua_repl` runtime.
- Skills, MCP, and plugins across Agents, with the OpenAI MCP Extensions surfaces.
- Server-owned schedules, Web3 networks, wallets, signing policies, dApp sessions, approvals, and audit records.
- A non-TUI CLI and an optional end-to-end encrypted relay.
- An Expo Router foundation that builds for iOS, Android, and static web; product work on these surfaces is intentionally limited for now.
- A bilingual TanStack Start website and Fumadocs documentation site, prerendered behind a Cloudflare Worker.

Cypheria does not fork Agent runtimes. Harness-specific processes and protocols stay behind Server adapters. Clients operate on Cypheria Agent, Thread, Timeline, Integration, Schedule, and Web3 contracts.

## Architecture at a glance

```text
Desktop / Expo / CLI / other clients
              |
       @cypheria/client
              |
     @cypheria/protocol
              |
        apps/server
       /           \
Agent adapters   Cypheria runtime
                 Web3 / schedules / DB

Remote clients may use @cypheria/relay -> apps/relay -> apps/server.
```

Electron owns windows, the hardened boundary around built-in browser tabs and the dApp wallet provider, preload bridges, desktop-local settings, updates, and operating-system integration. Shared product state and privileged operations belong to the Server.

See the [architecture guide](docs/architecture.md) and [documentation index](docs/README.md).

## Repository layout

Applications live in `apps/`, shared packages in `packages/`, and the bundled plugins in `plugins/`; the [development guide](docs/development.md#workspace) lists each workspace and what it owns. Marketplace is planned as a dynamic capability inside `apps/website`; no Marketplace routes, accounts, APIs, or storage bindings exist yet. Its intended boundary is in the [Marketplace design](docs/planned/marketplace.md) and the [roadmap](docs/roadmap.md).

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11
- Go 1.25 for the relay, node_repl, and the browser extension's native host

```sh
pnpm install
pnpm run ci
pnpm build
```

Useful entry points:

```sh
pnpm --filter @cypheria/server build
pnpm --filter @cypheria/server server start
pnpm --filter @cypheria/desktop dev
pnpm --filter @cypheria/expo dev
pnpm --filter @cypheria/website dev
pnpm --filter @cypheria/cypheria-relay dev -- --mode=single
```

Cypheria stores local application data below `$CYPHERIA_HOME`, defaulting to `~/.cypheria`. Cypheria-managed Codex processes use `$CYPHERIA_HOME/agents/codex/home` as `CODEX_HOME` and do not mutate the user's default Codex home.

Development commands, generated-code workflows, and verification rules are in the [development guide](docs/development.md).

## Safety model

- Renderer and dApp pages never receive private keys or direct database access.
- Agents and schedules submit signing intents; the Server evaluates every intent through policy.
- Auto-signing is off by default and requires an explicit policy.
- dApp wallet sessions and permissions are isolated by origin; web tabs never receive a wallet provider.
- Signatures, policy decisions, schedule runs, and transaction results are auditable.

See the [Web3 guide](docs/features/web3.md) and [security boundaries](docs/architecture.md#trust-boundaries).

## Documentation

Start with the [documentation index](docs/README.md). English is authoritative; each maintained product document has a complete Simplified Chinese companion.

## License

MIT
