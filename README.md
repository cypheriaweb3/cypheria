# Cypheria

Cypheria is a local-first, cross-platform Web3 agent workspace. A privileged Cypheria Server owns Agent runtimes, projects, threads, canonical conversation history, schedules, wallets, policy evaluation, and audit data. Desktop, Expo, CLI, and future clients use the same versioned protocol.

## What is implemented

- A supervised Hono/Node.js server with HTTP, WebSocket, configuration, diagnostics, and embedded web hosting.
- First-party Codex, Claude, Pi, and OpenCode adapters, plus registry-backed ACP agents.
- Durable Projects, Threads, Sections, Canonical Timeline, interactions, terminals, and artifacts.
- A public `@cypheria/client` TypeScript SDK with direct Thread, Timeline, interaction, and harness facades.
- An Electron + TanStack Start desktop client with the established Sidebar and conversation workspace.
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

Electron owns windows, isolated dApp WebContents, preload bridges, desktop-local settings, updates, and operating-system integration. Shared product state and privileged operations belong to the Server.

See the [architecture guide](docs/architecture.md) and [documentation index](docs/README.md).

## Repository layout

Implemented applications:

```text
apps/cli       Command-line client and Server lifecycle commands
apps/desktop   Electron main/preload plus TanStack Start renderer
apps/expo      Expo Router client foundation and static web export
apps/relay     Go relay data plane
apps/server    Privileged local Server and Agent adapters
apps/website   Marketing, documentation, and future Marketplace web application
```

Implemented packages:

```text
packages/client           Shared Server client and domain facades
packages/db               SQLite schema, repositories, and baseline migration
packages/protocol         Public protocol and generated Codex contracts
packages/relay            E2EE channel, pairing, and relay helpers
packages/ui               Shared UI and conversation presentation primitives
packages/web3             Pure Web3 domain modules
```

Marketplace is planned as a dynamic capability inside `apps/website`; no Marketplace routes, accounts, APIs, or storage bindings exist yet. Its intended boundary is documented in the [marketplace design](docs/marketplace.md) and [active roadmap](docs/todo.md).

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11
- Go 1.25 for relay development

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

Cypheria stores local application data below `$CYPHERIA_HOME`, defaulting to `~/.cypheria`. Cypheria-managed Codex processes use `$CYPHERIA_HOME/codex` as `CODEX_HOME` and do not mutate the user's default Codex home.

Development commands, generated-code workflows, and verification rules are in the [development guide](docs/development.md).

## Safety model

- Renderer and dApp pages never receive private keys or direct database access.
- Agents and schedules submit signing intents; the Server evaluates every intent through policy.
- Auto-signing is off by default and requires an explicit policy.
- dApp browser sessions are isolated by origin.
- Signatures, policy decisions, schedule runs, and transaction results are auditable.

See the [Web3 guide](docs/web3.md) and [security boundaries](docs/architecture.md#trust-boundaries).

## Documentation

Start with the [documentation index](docs/README.md). English is authoritative; each maintained product document has a complete Simplified Chinese companion.

## License

MIT
