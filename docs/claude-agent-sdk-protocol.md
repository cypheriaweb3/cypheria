# Claude Agent SDK Protocol

`@cypheria/protocol` pins `@anthropic-ai/claude-agent-sdk@0.3.270` and translates its network-safe public API into `agent.claude.*` logical-session messages. `@cypheria/client/claude` implements the client-side SDK-shaped facade; the `apps/server` adapter remains future work.

## Wire Model

Claude messages use the existing Paseo-shaped WebSocket envelope:

```ts
{ type: "session", message: { type: "agent.claude.query.start.request", ... } }
```

RPC requests flatten their arguments beside `type` and `requestId`. Responses carry correlation and exactly one outcome inside `payload`:

```ts
{
  type: "agent.claude.query.start.response"
  payload: { requestId: "request-1", result: { queryId: "query-1" } }
}

{
  type: "agent.claude.query.start.response"
  payload: {
    requestId: "request-1"
    error: { code: "query_failed", message: "Claude process exited" }
  }
}
```

`queryId` is selected by the client and identifies one live SDK `Query` async iterator. It is a protocol routing identifier, not a Claude session ID. Claude session IDs remain the SDK values returned in message payloads and session operations.

The prompt is a discriminated union:

- `{ type: "text", text }` maps to the SDK string prompt.
- `{ type: "stream" }` maps to an `AsyncIterable<SDKUserMessage>`. The client then sends ordered `agent.claude.query.input.notification` messages and terminates input with `agent.claude.query.input.complete.notification`.

The server emits `agent.claude.query.complete.notification` after normal iterator completion, or `agent.claude.query.error.notification` for an iteration failure. Individual SDK outputs are sent before completion with their original value in `payload`.

## SDK Calls

The registry exports the upstream target through `scope` and `method`, so a server adapter can dispatch without reverse-engineering wire names.

| SDK API | Cypheria operation |
| --- | --- |
| `query()` | `agent.claude.query.start` |
| `listSessions()` | `agent.claude.session.list` |
| `getSessionInfo()` | `agent.claude.session.get` |
| `getSessionMessages()` | `agent.claude.session.messages.list` |
| `listSubagents()` | `agent.claude.session.subagent.list` |
| `getSubagentMessages()` | `agent.claude.session.subagent.messages.list` |
| `renameSession()` / `tagSession()` / `deleteSession()` | `agent.claude.session.rename` / `.tag` / `.delete` |
| `forkSession()` | `agent.claude.session.fork` |
| `resolveSettings()` | `agent.claude.settings.resolve` |

All 29 `Query` methods are covered. `streamInput()` uses the input notifications described above. The remaining methods map to paired request/response operations:

| Area | SDK methods |
| --- | --- |
| Lifecycle | `interrupt`, `close`, `initializationResult`, `reinitialize` |
| Model and permissions | `setPermissionMode`, `setMcpPermissionModeOverride`, `setModel`, `setMaxThinkingTokens` |
| Settings | `applyFlagSettings`, `updateSettings` |
| Discovery | `supportedCommands`, `supportedModels`, `supportedAgents`, `accountInfo` |
| MCP | `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers` |
| Context and usage | `getContextUsage`, `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` |
| Files and reload | `readFile`, `rewindFiles`, `seedReadState`, `reloadPlugins`, `reloadSkills`, `reloadOutputStyles` |
| Tasks | `stopTask`, `backgroundTasks` |

Void responses omit `result` and carry only `requestId`. `getSessionInfo()` returns `null` when the SDK returns `undefined`, because that absence is itself the method's meaningful result and `undefined` is not a JSON wire value.

## Options And MCP

`ClaudeQueryOptionsSchema` models every serializable SDK `Options` key. Session and settings utility options have strict, per-field schemas.

MCP server configuration supports serializable stdio, HTTP, and SSE SDK configs. An SDK-compatible stdio config without `type` is canonicalized to `type: "stdio"`. In-process `{ type: "sdk", instance }` servers are excluded because the `McpServer` instance contains executable functions and process-local state.

These option keys are deliberately excluded from the wire:

```txt
abortController
canUseTool
hooks
loadTimeoutMs
onElicitation
onUserDialog
sessionStore
sessionStoreFlush
spawnClaudeCodeProcess
stderr
supportedDialogKinds
```

They carry callbacks, live handles, stores, or configuration whose meaning depends on an omitted callback. A future server adapter may supply its own local values after authorization; it must not accept them from an untrusted remote client.

These public top-level exports are not remote operations:

```txt
createSdkMcpServer
filterEscalatingDefaultMode
foldSessionSummary
importSessionToStore
startup
tool
```

`tool()` and `createSdkMcpServer()` construct function-bearing, process-local objects. The session-store helpers likewise consume local objects, `filterEscalatingDefaultMode` is a pure settings helper, and pre-warming through `startup()` is intentionally outside the remote API. SDK types are re-exported type-only from `@cypheria/protocol/claude-types` so adapters can reuse the exact pinned declarations without creating a second DTO model.

## Output Messages And Drift Control

The SDK has no published runtime validator equivalent to ACP's generated Zod modules. Cypheria therefore keeps each `SDKMessage` JSON-transparent, validates its upstream `type`, `subtype`, and live/replay discriminator, and wraps it in a concrete top-level notification. Examples include:

```txt
agent.claude.assistant.notification
agent.claude.user.notification
agent.claude.user_replay.notification
agent.claude.result.success.notification
agent.claude.result.error.notification
agent.claude.stream_event.notification
agent.claude.tool_progress.notification
agent.claude.tool_use_summary.notification
agent.claude.auth_status.notification
agent.claude.rate_limit_event.notification
agent.claude.prompt_suggestion.notification
agent.claude.conversation_reset.notification
agent.claude.system.<sdk_subtype>.notification
```

The system family currently expands into 28 concrete subtype messages; together with the other families, the generated union has 40 branches. The exact names and SDK type mappings live in `packages/protocol/src/generated/claude/messages.ts`.

`generate-agent-claude-code-messages.mjs` inspects the installed SDK declaration file with the TypeScript compiler API. Before build, typecheck, and test, `--check` compares the committed registry with the installed package and inventories:

- the 40 `SDKMessage` branches and discriminators;
- the 29 `Query` methods;
- all 67 `Options` keys;
- all 17 exported functions;
- the exact package version.

An SDK upgrade must update the exact dependency, regenerate the registry, classify every new option/export, update schemas and tests, and commit the result together.

## Adapter Responsibilities

`@cypheria/client/claude` presents the network-safe SDK call shape through a facade bound to a borrowed `CypheriaApi`. It allocates request/query IDs, converts async input iterables into notifications, reconstructs each query's async output stream, correlates responses, keeps `AbortController` local, and propagates transport failure.

A future server adapter should own SDK query objects, dispatch through `AGENT_CLAUDE_RPC`, convert named wire arguments to SDK calls, emit wrapped SDK messages in order, normalize non-JSON results, enforce authorization for filesystem/process/environment options, and dispose all active iterators when the logical session ends.
