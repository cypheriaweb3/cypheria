# Client/Server Protocol

> Status: Current implementation

`@cypheria/protocol` is the source of truth for the public Cypheria client/server contract. It exports strict TypeScript types, compiled Zod validators, serializers, capability constants, and generated upstream artifacts used inside Server adapters.

## Scope

The public protocol covers Server operations, Agents, Projects, Threads, Sections, Canonical Timeline, integrations, schedules, terminals, and Web3. Agent-native protocols are not public client APIs. They are validated adapter inputs behind `apps/server`.

Generated Codex App Server files live under `packages/protocol/src/generated/codex/`. Their [generated reference](codex-app-server-api.md) is for adapter development, not direct client use.

## Transport

Clients connect to `/api/v1/ws` with WebSocket subprotocol `cypheria.v2`. Text frames contain JSON, with a versioned SuperJSON envelope only when a value such as `bigint` requires metadata. Binary frames are rejected.

Top-level messages are:

```ts
{ type: "hello", clientId, clientType, protocolVersion, appVersion?, capabilities? }
{ type: "ping" }
{ type: "pong" }
{ type: "session", message: logicalMessage }
```

The first non-ping client message must be `hello`. Supported client kinds are `desktop`, `mobile`, `web`, `cli`, `mcp`, and `hub`. A successful attachment is confirmed by `server.status.notification`; there is no public session identifier or resume token.

The Server rejects incompatible versions, malformed messages, duplicate in-flight request IDs on one source transport, oversized frames, and connections that miss the hello deadline.

## Logical messages

Each logical message has a concrete dotted `type`. Requests carry a `requestId`; correlated responses return the same ID. Domain schemas commonly place arguments in `payload` and represent domain failure as a typed `{ ok: false, error }` result rather than a transport failure. Notifications do not require correlation.

Examples of message families:

```text
server.status.request              -> server.status.response
project.list.request               -> project.list.response
thread.turn.start.request          -> thread.turn.start.response
thread.timeline.appended.notification
schedule.run.request               -> schedule.run.response
web3.signing_intent.create.request -> web3.signing_intent.create.response
```

The exported Zod schemas, not prose examples, are authoritative for exact fields.

## Versioning and capabilities

`CYPHERIA_PROTOCOL_VERSION` controls transport compatibility. A client must reject a Server protocol version it cannot safely consume. `server.status.notification` advertises stable capabilities and optional feature flags. Clients gate optional UI on those values rather than assuming that an application version implies a feature.

Unknown feature-flag names are preserved. Additive optional fields are preferred within a protocol version; incompatible shape changes require a new protocol version.

## Projects, Threads, and Sections

Projects group workspace roots and ordered Thread membership. Threads are the durable Agent conversation identity and carry `agentId`, provider session linkage, state, capabilities, pending interactions, recency, archive state, and optional Project or Section placement. Sections order both Projects and standalone Threads.

The protocol provides create, read, list, update, move, membership, archive, and delete operations. Ordering uses explicit positions and `before...` placement hints. The fixed Pinned Section is represented by a stable protocol constant; clients do not infer Section membership from provider metadata.

List endpoints are bounded and cursor-paginated. Mutation responses return the authoritative Server value so clients can reconcile optimistic updates.

## Canonical Timeline

The append-only Canonical Timeline is the durable conversation history. Each row has a monotonic sequence number, timestamp, optional turn ID, optional provider item ID, and one discriminated item:

- `message` for user and assistant content;
- `reasoning`;
- `tool`;
- `plan`;
- `command`;
- `diff`;
- `approval`;
- `artifact`;
- `status`;
- `error`;
- `provider` for an Agent-specific event with no common representation.

Common items may include `providerData` for provenance and diagnostics without changing their shared meaning. Provider-only items retain `agentId`, native type, and validated payload so a client can select a provider extension.

Timeline cursors contain an epoch and sequence. The epoch detects replacement or rebuilt history. Reads support `tail`, `before`, and `after`, and can request canonical rows or projected display items. Projection folds later rows for the same item into a stable display item while retaining exact source sequence ranges.

Clients subscribe to append notifications and re-read after a replacement notification, cursor gap, reconnect, or epoch mismatch. The persisted Server Timeline remains authoritative even when an AI SDK stream is used for live consumption.

## Turns and interactions

Thread input is an ordered list of text, image, audio, resource-link, or embedded-resource blocks, restricted by advertised Thread capabilities. A client-generated message ID makes start and steer operations safely correlatable. Active turns can be cancelled through the Thread API.

Permission requests, questions, and MCP elicitation are normalized as pending Thread interactions. Responses use discriminated outcomes such as allow, deny, selection, text, answers, elicitation action, or cancellation. Provider metadata preserves native context while the common lifecycle stays uniform.

## Errors and reconnects

Transport and protocol violations close the affected connection. Correlated domain operations return stable error codes and human-readable messages. `@cypheria/client` converts connection, capability, protocol, and timeout failures into dedicated error classes.

A logical session is keyed by authenticated principal and `clientId`. Reconnecting within the configured grace period attaches to the retained logical session, but clients must still reconcile current state and Timeline cursors. Logical sessions are not durable across worker restarts.

## Client facade

`@cypheria/client` is the supported application entry point. `createCypheriaClient()` owns one connection; `createCypheriaApi()` borrows an existing internal connection. Current facades are:

```text
client.agents
client.projects
client.threads
client.sections
client.timeline
client.providers.codex
client.providers.claude
client.providers.pi
client.providers.opencode
client.providers.acp
client.schedules
client.web3
client.integrations
client.terminals
client.artifacts
client.settings
client.server
```

Provider facades expose only genuine provider extensions. Codex Apps, account, guardian, models, and permission settings live under `providers.codex`; common integration operations remain available through `integrations`.

## Validation rules

- Validate every inbound and outbound boundary with the exported schema for its direction.
- Never hand-write or copy generated Agent protocol types.
- Never expose a provider-native message union as durable client state.
- Keep request IDs unique while in flight on one transport.
- Treat cursors as opaque outside the owning domain.
- Use capability and feature negotiation for optional behavior.
