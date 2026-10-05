---
title: AI Gateway
---

# AI Gateway

The AI gateway gives the Agents Cypheria manages one local endpoint for every model provider and subscription, with routing groups and usage accounting. The Server provides it by running [magpie](https://github.com/cypheriaweb3/magpie), Cypheria's build of magpie, as a supervised child process. Clients reach it only through the `magpie` capability of the [protocol](protocol.md); magpie's own API stays behind the Server.

## Release and installation

`@cypheria/protocol` pins one magpie release in `src/generated/magpie/release.json`, with the SHA-256 of its terminal build for each platform. The release's OpenAPI document is committed beside it, and Zod schemas are generated from that document:

```sh
pnpm --filter @cypheria/protocol generate:magpie-zod
```

The command fetches the OpenAPI document of the pinned release tag before it generates. `check:magpie-zod` runs before the protocol package builds, tests, or typechecks, and fails when the generated schemas are stale.

The first time the gateway is turned on, the Server downloads the pinned `magpie-cli` build from the `cypheriaweb3/magpie-releases` release, verifies its SHA-256, and installs it as `$CYPHERIA_HOME/toolchains/magpie/<version>/magpie`. A download that does not match the pinned checksum is refused. magpie never updates itself, sends usage statistics, installs an Agent's CLI, or runs plugins in this mode.

## Lifecycle

The gateway is off until it is turned on in Desktop's Gateway settings. Once on, the Server starts it, starts it again with the Server, and restarts it when it exits, at most five times a minute. Turning it off stops it. The setting and the ports are kept in `$CYPHERIA_HOME/gateway/cypheria.json`.

The Server starts `magpie web` with:

- `MAGPIE_HOME=$CYPHERIA_HOME/gateway`, which holds all of magpie's settings, providers, sign-ins, usage, and caches;
- `MAGPIE_AGENTS_FILE=$CYPHERIA_HOME/gateway/agents.json`, which puts magpie in Cypheria integration mode;
- the gateway on `127.0.0.1` at the gateway port (default 3445), and magpie's API on `127.0.0.1` at the API port (default 3446), behind a key generated for each start.

The ports never take 3425 or 3430, a standalone magpie's defaults, so the user's own magpie keeps working beside Cypheria's. Before a start, the Server ends a magpie that an earlier Server left running, identified by `$CYPHERIA_HOME/gateway/magpie.pid` and its executable. If a port is still taken, the Server moves to the next free port, saves it, and once magpie is ready, wires again every Agent whose settings still point at the old gateway. magpie's output is written to `$CYPHERIA_HOME/logs/magpie.log`.

## Agents

The agents file lists every installed, enabled Agent by magpie's id (`antigravity-acp` is `agy`, `github-copilot-cli` is `copilot`, `grok-build` is `grok`) as Cypheria launches it:

- the command and the arguments that come before the CLI's own commands, without the arguments that start its ACP or app-server mode;
- its working folder;
- the variables it receives beyond the Server's environment: the toolchain `PATH` and its isolated home, such as `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, or its own XDG folders.

The Server writes the file when the gateway starts and whenever an Agent is installed, removed, enabled, or disabled; magpie reads it again when it changes. magpie therefore edits each Agent's settings, instructions, MCP servers, and skills, and reads its sessions, in the Agent's Cypheria home rather than the user's. It knows no other Agents and leaves the user's own Agents untouched.

## Subscriptions and providers

magpie signs in to, lists, and serves only the subscriptions of the listed Agents: Claude, Codex, Copilot, Cursor, Devin, Gemini, Antigravity, and Grok. It reads and writes each sign-in where the Agent keeps it, so the Agent and the gateway share it; magpie may switch an Agent to another of its accounts when one has used its allowance. Providers used with a key are not limited.

## Clients

The `magpie` capability offers:

- the gateway's status, version, ports, and errors; installing magpie; turning it on or off; and restarting it;
- the listed Agents with their magpie fields, setting a field, and wiring an Agent to the gateway again;
- providers, routing groups, and usage by period.

`magpie.status.changed.notification` reports every status change. Requests to magpie's data fail with `MAGPIE_NOT_RUNNING` while the gateway is not ready.
