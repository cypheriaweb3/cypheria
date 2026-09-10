# Cypheria Server

`apps/server` is the process boundary between Cypheria clients and privileged local capabilities. It follows the useful daemon shape from Paseo—a stable supervisor, a replaceable worker, explicit session handshake, health and diagnostics, PID ownership, crash recovery, and graceful lifecycle control—while using Hono instead of Express.

This foundation intentionally exposes no agent, project, wallet, policy, or automation product API. It hosts a bare `CypheriaRuntime`, whose built-in `runtime.info`, `runtime.health`, and `runtime.services` methods are enough to validate the transport. Product services can be injected after the server architecture and security boundary are reviewed.

## Process Model

```txt
cypheria-server CLI
  -> supervisor process
       -> owns $CYPHERIA_HOME/config/server.pid
       -> watches heartbeat and restart budget
       -> worker process
            -> Hono HTTP server
            -> WebSocket session registry
            -> CypheriaRuntime lifecycle
            -> embedded Expo web application
```

The supervisor restarts a worker after an explicit restart or unexpected failure, applies bounded exponential backoff, stops after five failures in one minute, and force-terminates a worker that ignores shutdown. The worker emits a heartbeat every five seconds. Process logs append to `$CYPHERIA_HOME/logs/server.log`; the stable server identity is stored with owner-only permissions at `$CYPHERIA_HOME/config/server-id`.

The server CLI supports:

```sh
cypheria-server start
cypheria-server start --foreground
cypheria-server status
cypheria-server restart
cypheria-server stop
```

## Client Protocol

`@cypheria/protocol` owns the Cypheria protocol only. It does not duplicate or hand-write Codex App Server types. All HTTP and WebSocket boundary values are validated with Zod.

WebSocket clients connect to `/api/v1/ws` with the `cypheria.v1` subprotocol. Their first message must be `session.hello` with protocol version, client identity, client kind, and capabilities. The server responds with `session.ready` and a stable session ID. Every request has a caller-supplied request ID; runtime events are broadcast without one.

Supported foundation messages are:

| Client message | Server result | Purpose |
| --- | --- | --- |
| `session.hello` | `session.ready` | Negotiate protocol and client metadata |
| `server.ping` | `server.pong` | Liveness and latency timestamps |
| `server.info` | `server.info.result` | Identity, version, runtime state, and connection count |
| `server.diagnostics` | `server.diagnostics.result` | Process, memory, connection, and runtime diagnostics |
| `runtime.request` | `runtime.response` | Forward a validated runtime method |
| `server.restart` / `server.shutdown` | `server.lifecycle.accepted` | Request supervised lifecycle action |
| `session.goodbye` | connection close | Graceful client disconnect |

Invalid messages return `server.error`. The server rejects binary frames, duplicate in-flight request IDs, incompatible protocol versions, oversized messages, and sessions that do not send hello within the configured deadline. A transport-level ping/pong heartbeat terminates stale sockets so the operational connection registry cannot retain dead clients indefinitely.

## HTTP Operations

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | No | Process liveness |
| `GET` | `/api/v1/ready` | No | Runtime/listener readiness |
| `GET` | `/api/v1/status` | Bearer when configured | Server information |
| `GET` | `/api/v1/diagnostics` | Bearer when configured | Operational diagnostics |
| `POST` | `/api/v1/runtime/request` | Bearer when configured | Runtime request forwarding |
| `POST` | `/api/v1/lifecycle/restart` | Bearer when configured | Supervised worker restart |
| `POST` | `/api/v1/lifecycle/shutdown` | Bearer when configured | Full daemon shutdown |

API routes never fall through to the SPA. Request bodies and runtime method namespaces are bounded and validated.

## Security Defaults

The default listener is `127.0.0.1:6768`. Binding to any non-loopback address is rejected unless `CYPHERIA_SERVER_TOKEN` is configured. HTTP uses `Authorization: Bearer <token>`. Browser-compatible WebSocket clients carry the same token in a `cypheria.bearer.<token>` subprotocol because the browser WebSocket API cannot set an authorization header.

Native clients without an `Origin` header are allowed. Browser WebSockets default to same-origin only. Cross-origin HTTP and WebSocket access requires an explicit `CYPHERIA_SERVER_ALLOWED_ORIGINS` allowlist. Tokens are never accepted in URLs, and the Expo bundle does not compile a server token into public client code.

Configuration variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | Listener address |
| `CYPHERIA_SERVER_PORT` | `6768` | Listener port; `0` selects an ephemeral port |
| `CYPHERIA_SERVER_TOKEN` | unset | Shared operational credential, required off loopback |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | unset | Comma-separated cross-origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body and WebSocket frame limit |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello deadline |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | HTTP graceful-shutdown deadline |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | Enable embedded Expo web hosting |
| `CYPHERIA_SERVER_WEB_DIR` | bundled `dist/web` | Override the hosted static directory |

TLS termination is intentionally outside this Node process. Any non-loopback deployment should place the server behind a trusted TLS reverse proxy in addition to using authentication and an explicit origin allowlist.

## Expo Packaging

`apps/expo` uses Expo SDK 57 and Expo Router with the React Native new architecture and React Compiler enabled. One source tree targets iOS, Android, and web. Web uses static output:

```sh
pnpm --filter @cypheria/expo build
```

The server declares Expo as a workspace build dependency. Its build bundles the Node entry points with tsdown, removes any stale embedded web directory, and copies the exact Expo `dist` output into `apps/server/dist/web`:

```sh
pnpm --filter @cypheria/server... build
```

Hono serves real assets first and falls back to `index.html` for client routes. HTML is not cached; fingerprinted static assets receive immutable caching. `/api/*` remains a strict JSON namespace.

The Expo client selects its server as follows:

- Web production uses the page's same origin.
- `EXPO_PUBLIC_CYPHERIA_SERVER_URL` overrides the server URL without carrying credentials.
- Native development defaults to `ws://127.0.0.1:6768/api/v1/ws`; Android emulator or physical-device development should set an address reachable from that device.

## Desktop Migration Boundary

`apps/desktop` was not modified in this change. It still starts `CypheriaRuntime` and Codex App Server inside Electron main exactly as before. After this server is reviewed, a separate migration can make desktop a Cypheria protocol client and give Electron main the special responsibility of ensuring a local server is running. That migration must preserve Electron-only dApp `WebContents`, preload, secure storage, OS integration, and approval UI boundaries rather than moving them prematurely.
