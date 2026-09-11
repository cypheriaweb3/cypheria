# Cypheria Server

`apps/server` is the process boundary between Cypheria clients and privileged local capabilities. It follows the useful daemon shape from Paseo—a stable supervisor, a replaceable worker, explicit session handshake, health and diagnostics, PID ownership, crash recovery, and graceful lifecycle control—while using Hono instead of Express.

The running foundation server still dispatches no agent, project, wallet, policy, or automation product service. It hosts a bare `CypheriaRuntime`, whose built-in `runtime.info`, `runtime.health`, and `runtime.services` methods are enough to validate the transport. `@cypheria/protocol` now reserves the complete Codex App Server API under `agent.codex.*` and carries ACP under `agent.acp.*`; server-side agent dispatch remains a separate implementation step.

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

`@cypheria/protocol` owns the Cypheria wire protocol and the generated Codex App Server artifacts. It does not hand-write Codex DTOs: TypeScript, JSON Schemas, response mappings, validators, and the checked-in dotted API registry are generated or derived together in this package. Codex-generated TypeScript remains the compile-time source of truth; pinned Hey API generation converts the Codex JSON Schema definitions into committed static Zod 4 validators. `@cypheria/codex-bridge` consumes the dedicated protocol subpath. All HTTP and WebSocket boundary values are validated with Zod.

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

### Codex agent API names

The complete Codex App Server surface is part of the live client/server unions using new, dotted Cypheria names:

```txt
agent.codex.<operation>.request
agent.codex.<operation>.response
agent.codex.<operation>.notification
```

Upstream slash separators become dots and camel-case segments become snake case. For example:

```txt
thread/start                 -> agent.codex.thread.start.request
thread/memoryMode/set        -> agent.codex.thread.memory_mode.set.request
threadSection/list           -> agent.codex.thread_section.list.request
getConversationSummary      -> agent.codex.get_conversation_summary.request
```

For ordinary RPCs, the client sends `{ type, requestId, ...params }` and the server returns `{ type, payload: { requestId, ...result } }`. This follows Paseo's current convention: request fields are top-level, while correlated response fields live in `payload`. For App Server-initiated RPCs such as approvals, the server sends the request and the capable client returns the response. Server notifications carry the upstream notification params directly in `payload`; the App Server `initialized` client notification has no payload.

The generated registry records all 158 client-initiated RPCs, 11 server-initiated RPCs, 83 server notifications, and one client notification, including each upstream Params/Response type name and reverse wire-name lookup. Its generation check runs before protocol build, typecheck, and test so a Codex regeneration cannot silently drift from the public Cypheria API catalog.

### ACP agent messages

ACP traffic remains an unmodified JSON-RPC wire message inside one of two directional Cypheria envelopes:

```ts
{
  type: "agent.acp.client.message"
  payload: { protocolVersion: 1 | 2; message: AcpWireMessage }
}

{
  type: "agent.acp.server.message"
  payload: { protocolVersion: 1 | 2; message: AcpWireMessage }
}
```

`client` and `server` identify the Cypheria sender, while the inner ACP method or response correlation determines the ACP client/agent role. Protocol version `1` uses the stable `@agentclientprotocol/sdk` types and accepts one message; version `2` uses its explicit `experimental/v2` types and additionally accepts non-empty call or response batches. The boundary composes the SDK-generated `AgentRequest`, `AgentResponse`, `AgentNotification`, `ClientRequest`, `ClientResponse`, and `ClientNotification` Zod schemas, then applies the same per-method request and notification parameter schemas used by the SDK App API. It rejects known methods used in the wrong direction and preserves unknown extension methods as JSON. Method-specific response validation and capability/lifecycle enforcement remain connection-state responsibilities because a JSON-RPC response carries an ID but no method.

SDK 1.4.0 ships those generated Zod modules but does not expose them through package exports. A minimal pinned pnpm patch exposes `@agentclientprotocol/sdk/zod` and `@agentclientprotocol/sdk/experimental/v2/zod`; Cypheria imports the upstream modules directly instead of copying their generated definitions.

`Acp-Connection-Id` is an ACP HTTP transport header, not an ACP JSON-RPC field. It is therefore not embedded in these WebSocket envelopes; the Cypheria session and its server-owned ACP connection provide routing context.

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
