---
title: Server
---

# Server

`apps/server` is the privileged process boundary for Cypheria. It owns shared state, Agent runtimes, persistence, schedules, Web3 execution, and versioned client connections. See [Architecture](architecture.md) for ownership and [Protocol](protocol.md) for wire contracts.

## Process model

```text
cypheria-server CLI
  └─ supervisor
      ├─ PID ownership, worker heartbeat, restart budget, log sink
      └─ worker
          ├─ Hono HTTP and WebSocket server
          ├─ session registry and Cypheria services
          ├─ Agent runtimes and adapters
          └─ embedded Expo web export (standalone Server only)
```

The supervisor has a stable PID while workers are replaceable. It applies bounded restart backoff, detects worker heartbeat loss, prevents orphan workers, and escalates termination when graceful shutdown expires. The worker initializes the runtime, repositories, fixed pinned Section, integrations, and recoverable schedules before reporting readiness.

## Lifecycle commands

After building `@cypheria/server`:

```sh
pnpm --filter @cypheria/server server start
pnpm --filter @cypheria/server server start --foreground
pnpm --filter @cypheria/server server status
pnpm --filter @cypheria/server server restart
pnpm --filter @cypheria/server server stop
pnpm --filter @cypheria/server server stop --if-idle
```

`--if-idle` leaves a Server running when active clients are present. Desktop uses the same ownership principle: it reuses a compatible process and only stops an instance it started when that instance is safe to reclaim. A Server process started by Desktop has embedded web hosting disabled; a compatible standalone Server that Desktop reuses keeps its independently selected configuration.

## Runtime home

`CYPHERIA_HOME` selects the application home and defaults to `~/.cypheria`.

```text
$CYPHERIA_HOME/
  codex/     Cypheria-managed Codex home
  config/    config.json, PID and Server identity, relay key
  db/        SQLite database
  logs/      Server and runtime logs
  vault/     encrypted wallet vault data
  cache/     disposable caches and managed toolchains
  browser/   dApp session metadata
```

The Server resolves this root once and passes derived paths to services. Cypheria-managed Codex processes receive `CODEX_HOME=$CYPHERIA_HOME/codex`; the user's default Codex home is not read or modified.

## Configuration

Desired shared configuration is stored at `$CYPHERIA_HOME/config/config.json`, currently schema version 1. The product has not shipped, so this is the current baseline and no legacy configuration migration is performed. Missing configuration uses secure defaults without writing a file. Patches are validated as a complete document and written atomically with owner-only permissions.

The document contains listener, CORS, message limits, session timeouts, shutdown, relay, embedded-web, logging, and shared Agent settings. Discovered new-session defaults for non-Codex harnesses are keyed by Agent ID under `agents.defaults`. Codex global settings are stored in its isolated native `config.toml`. Secrets such as `CYPHERIA_SERVER_TOKEN` are environment-only and never returned through settings APIs.

Configuration responses distinguish:

- desired values stored on disk;
- the immutable startup snapshot used by the running worker;
- paths that require a restart;
- paths currently controlled by environment overrides.

Desktop appearance, layout, shortcuts, window state, update preferences, and operating-system integration remain in Electron's local `config.json`, not Server configuration.

## Environment overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `CYPHERIA_HOME` | `~/.cypheria` | Application home |
| `CYPHERIA_LOG_LEVEL` | `info` | Console log threshold |
| `CYPHERIA_LOG_FILE_LEVEL` | `info` | File log threshold |
| `CYPHERIA_LOG_FILE_PATH` | `$CYPHERIA_HOME/logs/server.log` | File path; relative paths resolve from `CYPHERIA_HOME` |
| `CYPHERIA_LOG_ROTATE_SIZE_MB` | `10` | Maximum size per log file in MiB |
| `CYPHERIA_LOG_ROTATE_COUNT` | `3` | Rotated files retained |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | Listener host |
| `CYPHERIA_SERVER_PORT` | `6768` | Listener port; `0` requests an ephemeral port |
| `CYPHERIA_SERVER_TOKEN` | unset | Bearer credential; required for non-loopback binding |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | unset | Comma-separated browser origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body and WebSocket frame limit |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello deadline |
| `CYPHERIA_SERVER_RECONNECT_GRACE_MS` | `30000` | Logical-session retention after transport loss |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown deadline |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | Embedded web hosting |
| `CYPHERIA_SERVER_WEB_DIR` | bundled `dist/web` | Static web root override |
| `CYPHERIA_SERVER_RELAY_ENABLED` | `false` | Relay connection enablement |
| `CYPHERIA_SERVER_RELAY_ENDPOINT` | unset | Server-facing relay endpoint |

The configuration schema and code remain the final authority for optional relay publication and TLS flags.

## Agent and Server logs

The Server writes structured JSON logs to the console and rotating files. The worker writes `logs/server.log`; the supervisor writes `logs/server-supervisor.log`. The `server.logging` configuration stores console and file levels, optional file path, and rotation limits. Environment overrides take precedence; changes to persisted logging settings require a Server restart.

Codex, Pi, and ACP process lifecycle records include Agent ID, process ID, exit result, and the number of stderr bytes. Codex request timeouts include the method name. Agent stderr is drained so it cannot block the protocol, but its raw contents are not stored because they may contain credentials or user data. Conversation output remains in the canonical Timeline.

## HTTP operations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Process liveness |
| `GET` | `/api/v1/ready` | Runtime and listener readiness |
| `GET` | `/api/v1/status` | Server identity and state |
| `GET` | `/api/v1/state` | Live operational state |
| `GET` | `/api/v1/diagnostics` | Process, memory, connection, and runtime diagnostics |
| `GET` | `/api/v1/config` | Desired configuration and restart status |
| `POST` | `/api/v1/config/patch` | Validate and atomically persist a patch |
| `POST` | `/api/v1/config/reload` | Reload configuration from disk |
| `GET` | `/api/v1/relay/pairing-offer` | Authenticated relay pairing offer |
| `POST` | `/api/v1/runtime/request` | Validated privileged runtime request |
| `POST` | `/api/v1/lifecycle/restart` | Supervised worker restart |
| `POST` | `/api/v1/lifecycle/shutdown` | Full Server shutdown |

Most product operations use `/api/v1/ws`; REST operations never fall through to the hosted SPA.

## Authentication and network safety

Loopback is the default. A non-loopback listener is rejected unless a Server token is configured. HTTP uses a Bearer header. Browser WebSocket clients encode the token in the negotiated Cypheria subprotocol because the browser WebSocket API cannot set arbitrary authorization headers.

Native clients without an `Origin` are accepted. Browser connections are same-origin by default; cross-origin access requires an explicit allowlist. Tokens are not accepted in URLs or compiled into the Expo bundle. TLS termination is external to the Node process.

## Sessions and recovery

A logical session is keyed by authenticated principal and client ID. Multiple physical transports may attach to it. A response returns through its source transport, while status broadcasts reach all attachments. The reconnect grace period begins when the final transport detaches; logical sessions do not survive worker restart.

Persistent services recover from SQLite. Recoverable schedules are leased and resumed according to [Schedules](schedules.md). Interrupted Web3 signing and sending operations are never replayed automatically.

## Embedded web application

The standalone Server build copies the Expo static export into `apps/server/dist/web`. When standalone web hosting is enabled, Hono serves real assets first and `index.html` for client routes. HTML is not cached; fingerprinted assets use immutable caching. `/api/*` remains a strict API namespace. Desktop explicitly disables web hosting for a Server process it starts because the renderer is delivered by Electron (or Vite during development), not by the Server.

## Operational guarantees

- HTTP, WebSocket, configuration, and privileged runtime inputs are validated.
- PID, identity, relay key, configuration, and vault files use explicit ownership and permissions.
- Logs append under `$CYPHERIA_HOME/logs` without placing credentials in structured state responses.
- Diagnostics expose operational state, not private keys or secret configuration.
- Database, Agent, plugin, schedule, terminal, and Web3 lifecycles close during graceful shutdown.
