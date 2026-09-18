# Cypheria Server

`apps/server` is the process boundary between Cypheria clients and privileged local capabilities. It adopts the useful Paseo process shape—a stable supervisor, a replaceable worker, explicit session handshake, health and diagnostics, PID ownership, crash recovery, and graceful lifecycle control—while consistently naming the Cypheria process and API a server and using Hono instead of Express.

The server owns the SQLite-backed project, thread, project-membership, section, and section-membership service and advertises it as the `project-thread` capability. It initializes the fixed pinned section before accepting connections and dispatches the corresponding logical session messages. Agent-session association for Cypheria threads is deliberately deferred: the reserved field remains null and has no bind, update, or lookup operation. The server also hosts `CypheriaRuntime` and the agent surfaces described below; wallet, policy, and automation product services remain separate implementation steps.

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

The supervisor restarts a worker after an explicit restart or unexpected failure, applies bounded exponential backoff, stops after five failures in one minute, and force-terminates the worker process group when graceful shutdown expires. Liveness is bidirectional: the worker heartbeat lets the supervisor detect a stalled worker, while a one-second supervisor heartbeat plus parent/IPC checks prevents an orphan worker from continuing after its supervisor disappears. Process logs append to `$CYPHERIA_HOME/logs/server.log`; the stable server identity is stored with owner-only permissions at `$CYPHERIA_HOME/config/server-id`.

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

`@cypheria/client` is the reusable consumer of this contract. Its internal `ServerClient` owns the transport, WebSocket session, request correlation, subscriptions, timeout handling, and reconnect policy. `createCypheriaApi()` exposes a borrowed capability facade without connection controls, while `createCypheriaClient()` creates a facade that owns its connection lifecycle. The public API exposes provider-neutral `agent`, `thread`, `projectThread`, and `server` actions. Provider runtimes and sessions are owned by the server.

WebSocket clients connect to `/api/v1/ws` with the existing `cypheria.v2` subprotocol. The wire follows Paseo's two-level shape. WebSocket-level messages are `hello`, `ping`, `pong`, and `session`; Agent, Thread, project/section, and server operations are logical-session messages carried as `{ type: "session", message }`. The first non-ping client message must be a top-level `hello` containing protocol version, client identity, client type, optional app version, and optional per-transport capabilities. Supported client types are `desktop`, `mobile`, `web`, `cli`, `mcp`, and `hub`. There is no `session.ready`: the server confirms attachment with the logical `server.status.notification` message.

The in-memory registry keys a logical session by authenticated principal and `clientId`. The current direct-token and relay-pairing admission paths both resolve to the single local owner principal. Multiple physical WebSockets or decrypted relay channels may attach to the same logical session at once. A correlated response returns only through the source transport, while status broadcasts reach every attached transport. The reconnect grace period starts only after the final transport detaches. Reconnecting with the same authenticated principal and `clientId` automatically resumes that logical session; no public session ID, resume token, or `session.goodbye` message exists. Closing a client closes only its physical transport. Logical sessions are not persisted across worker restart.

Supported foundation messages are:

| Level / client message | Server result | Purpose |
| --- | --- | --- |
| WebSocket `hello` | session `server.status.notification` | Attach this transport and advertise peer metadata |
| WebSocket `ping` | WebSocket `pong` | Transport liveness |
| `server.status.request` | `server.status.response` | Identity, version, runtime state, and connection count |
| `server.diagnostics.request` | `server.diagnostics.response` | Process, memory, connection, and runtime diagnostics |
| `server.config.get.request` | `server.config.get.response` | Read desired server configuration |
| `server.config.patch.request` | `server.config.patch.response` | Persist a partial desired server configuration |
| `server.config.reload.request` | `server.config.reload.response` | Reload desired server configuration from disk |

Rows without a WebSocket prefix are logical-session messages and therefore travel inside the top-level `session` envelope. The server closes a connection that sends an invalid or unsupported logical message. The server rejects binary frames, duplicate in-flight request IDs on the same source transport, incompatible protocol versions, oversized messages, and connections that do not send hello within the configured deadline. An RFC 6455 heartbeat also terminates stale direct sockets so the operational registry cannot retain dead clients indefinitely.

### Internal provider adapter contracts

The complete Codex App Server surface is retained as an internal, validated adapter catalog using dotted Cypheria names. These messages are not part of the live public client/server unions:

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

For ordinary RPCs, the inner logical message sent by the client is `{ type, requestId, ...params }` and the inner server response is `{ type, payload: { requestId, ...result } }`. Both are wrapped by the directional top-level `session` envelope. This follows Paseo's current convention: request fields are top-level, while correlated response fields live in `payload`. For App Server-initiated RPCs such as approvals, the server sends the request and the capable client returns the response. Server notifications carry the upstream notification params directly in `payload`; the App Server `initialized` client notification has no payload.

The generated registry records all 158 client-initiated RPCs, 11 server-initiated RPCs, 83 server notifications, and one client notification, including each upstream Params/Response type name and reverse wire-name lookup. Its generation check runs before protocol build, typecheck, and test so a Codex regeneration cannot silently drift from the public Cypheria API catalog.

### ACP agent messages

ACP traffic is normalized into directly discriminable logical-session messages before it enters the top-level `session` envelope. The normalized method and direction are exposed by `type`; stable v1 and draft v2 are selected by the numeric `protocolVersion` discriminator:

```ts
{
  type: "agent.acp.session.new.request"
  protocolVersion: 1
  requestId: 7
  cwd: "/workspace"
}

{
  type: "agent.acp.session.new.response"
  protocolVersion: 1
  payload: { requestId: 7; result: { sessionId: "session-1" } }
}
```

Known requests flatten their method params beside `type`, `protocolVersion`, and `requestId`; notifications carry method params in `payload`; responses carry `requestId` plus exactly one of `result` or `error` in `payload`. Every known params/result value is returned in the canonical form produced by its official SDK validator. Extension methods use `agent.acp.extension.request|response|notification`, require an underscore-prefixed `method`, and keep that method plus optional `params` nested in `payload`. Protocol cancellation uses `agent.acp.cancel_request.notification` and requires its request ID payload.

ACP v2 batches use the special `agent.acp.batch` type with `protocolVersion: 2` and store non-empty logical messages under `payload.messages`. That array has its own `type`-based discriminated union. Call and response entries cannot be mixed, initialization requests and responses must be the only batch entry, and v1 has no batch message. The session schema nests its `type` discriminator around the ACP family, whose next discriminator is `protocolVersion`, followed by each version's `type` discriminator.

The generated catalog is derived from the official SDK handler declarations and checked before protocol build, test, and typecheck. It currently records 51 RPC pairs and 22 notifications across v1 and v2. Each known request, response, and notification uses the corresponding SDK-generated method-specific Zod schema. The client adapter reconstructs the SDK's raw JSON-RPC stream and uses connection-local request-ID correlation when an SDK response must be assigned its logical response type.

SDK 1.4.0 ships those generated Zod modules but does not expose them through package exports. A minimal pinned pnpm patch exposes `@agentclientprotocol/sdk/zod` and `@agentclientprotocol/sdk/experimental/v2/zod`; Cypheria imports the upstream modules directly instead of copying their generated definitions.

`Acp-Connection-Id` is an ACP HTTP transport header, not an ACP JSON-RPC field. It is therefore not embedded in these WebSocket envelopes; the Cypheria session and its server-owned ACP connection provide routing context.

### Claude Code agent messages

The protocol pins `@anthropic-ai/claude-agent-sdk@0.3.270` and maps every selected network-safe top-level function, every `Query` control method, serializable query options, and all 40 `SDKMessage` output variants to `agent.claude.*` logical messages. Requests and responses are paired by `requestId`, and a client-selected `queryId` identifies a running async iterator. Text prompts are carried directly; `AsyncIterable<SDKUserMessage>` is represented by a stream prompt followed by ordered input and input-complete notifications. `startup()`, `tool()`, and `createSdkMcpServer()` are explicitly outside this remote surface.

SDK output remains provider-transparent in `payload`, but each upstream `type`/`subtype` branch receives a concrete Cypheria notification type such as `agent.claude.assistant.notification`, `agent.claude.result.success.notification`, or `agent.claude.system.status.notification`. The generated registry and lifecycle checks detect drift in the SDK's message union, `Query` methods, option keys, exported functions, and pinned version. Callback-bearing hooks, permission handlers, custom SDK MCP servers, process factories, abort controllers, and session-store objects deliberately stay server-local. See [Claude Agent SDK Protocol](claude-agent-sdk-protocol.md) for the complete mapping and exclusions.

## HTTP Operations

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | No | Process liveness |
| `GET` | `/api/v1/ready` | No | Runtime/listener readiness |
| `GET` | `/api/v1/status` | Bearer when configured | Server information |
| `GET` | `/api/v1/state` | Bearer when configured | Live operational state |
| `GET` | `/api/v1/diagnostics` | Bearer when configured | Operational diagnostics |
| `GET` | `/api/v1/config` | Bearer when configured | Desired config and restart status |
| `POST` | `/api/v1/config/patch` | Bearer when configured | Validate and atomically persist a config patch |
| `POST` | `/api/v1/config/reload` | Bearer when configured | Re-read desired config from disk |
| `GET` | `/api/v1/relay/pairing-offer` | Bearer when configured | E2EE relay offer and connection state |
| `POST` | `/api/v1/runtime/request` | Bearer when configured | Runtime request forwarding |
| `POST` | `/api/v1/lifecycle/restart` | Bearer when configured | Supervised worker restart |
| `POST` | `/api/v1/lifecycle/shutdown` | Bearer when configured | Full server shutdown |

API routes never fall through to the SPA. Request bodies and runtime method namespaces are bounded and validated.

## Security Defaults

The default listener is `127.0.0.1:6768`. Binding to any non-loopback address is rejected unless `CYPHERIA_SERVER_TOKEN` is configured. HTTP uses `Authorization: Bearer <token>`. Browser-compatible WebSocket clients carry the same token in a `cypheria.bearer.<token>` subprotocol because the browser WebSocket API cannot set an authorization header.

Native clients without an `Origin` header are allowed. Browser WebSockets default to same-origin only. Cross-origin HTTP and WebSocket access requires an explicit `CYPHERIA_SERVER_ALLOWED_ORIGINS` allowlist. Tokens are never accepted in URLs, and the Expo bundle does not compile a server token into public client code.

## Configuration And State

Desired configuration is stored at `$CYPHERIA_HOME/config/server.json` with schema version `1`. Missing files use secure defaults without writing user state. A patch is validated as a complete configuration and then written atomically with owner-only permissions. The running worker keeps its resolved startup snapshot immutable: changed fields are returned as `restartRequiredPaths`, while values controlled by launch-time environment variables are returned as `overrideControlledPaths` and are not falsely reported as file-controlled changes.

The persistent document owns listener, CORS, message limits, relay, session deadlines, shutdown, and embedded-web settings. `CYPHERIA_SERVER_TOKEN` remains environment-only and is never returned by config or state APIs. Live state is separate and reports active/retained sessions, relay connectivity, runtime lifecycle, worker/supervisor PIDs, and whether desired configuration requires restart. PID ownership remains in `$CYPHERIA_HOME/config/server.pid`; identity and relay keys remain separate owner-only files.

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CYPHERIA_SERVER_HOST` | `127.0.0.1` | Listener address |
| `CYPHERIA_SERVER_PORT` | `6768` | Listener port; `0` selects an ephemeral port |
| `CYPHERIA_SERVER_TOKEN` | unset | Shared operational credential, required off loopback |
| `CYPHERIA_SERVER_ALLOWED_ORIGINS` | unset | Comma-separated cross-origin allowlist |
| `CYPHERIA_SERVER_MAX_MESSAGE_BYTES` | `1048576` | HTTP runtime body and WebSocket frame limit |
| `CYPHERIA_SERVER_HELLO_TIMEOUT_MS` | `10000` | WebSocket hello deadline |
| `CYPHERIA_SERVER_RECONNECT_GRACE_MS` | `30000` | Logical-session retention after transport loss |
| `CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS` | `10000` | HTTP graceful-shutdown deadline |
| `CYPHERIA_SERVER_WEB_ENABLED` | `true` | Enable embedded Expo web hosting |
| `CYPHERIA_SERVER_WEB_DIR` | bundled `dist/web` | Override the hosted static directory |
| `CYPHERIA_SERVER_RELAY_ENABLED` | `false` | Connect the server to a relay |
| `CYPHERIA_SERVER_RELAY_ENDPOINT` | unset | Server-facing relay endpoint |
| `CYPHERIA_SERVER_RELAY_USE_TLS` | `true` | Default scheme for the server-facing endpoint |
| `CYPHERIA_SERVER_RELAY_PUBLIC_ENDPOINT` | server endpoint | Endpoint published in pairing offers |
| `CYPHERIA_SERVER_RELAY_PUBLIC_USE_TLS` | server TLS setting | Default scheme published in offers |

TLS termination is intentionally outside this Node process. Any non-loopback deployment should place the server behind a trusted TLS reverse proxy in addition to using authentication and an explicit origin allowlist.

When relay support is enabled, the server keeps a control socket and creates one encrypted data
socket per remote client. Its X25519 key is stored at `$CYPHERIA_HOME/config/relay-key.json` with
mode `0600`. The pairing endpoint remains under the normal HTTP Bearer policy, while relay data
sockets do not carry that token. See [Cypheria Relay](relay.md).

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
