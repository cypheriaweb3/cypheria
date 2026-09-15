# Claude Agent SDK Protocol

`@cypheria/protocol` 精确固定 `@anthropic-ai/claude-agent-sdk@0.3.270`，并把其中适合网络传输的公共 API 转换成 `agent.claude.*` 逻辑 session 消息。`@cypheria/client/claude` 已实现 client 侧 SDK-shaped 门面；`apps/server` adapter 仍是后续工作。

## Wire 模型

Claude 消息使用现有 Paseo 形态的 WebSocket envelope：

```ts
{ type: "session", message: { type: "agent.claude.query.start.request", ... } }
```

RPC request 将参数与 `type`、`requestId` 平铺；response 在 `payload` 中携带关联信息，并且恰好包含一种结果：

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

`queryId` 由 client 选择，用来标识一条活跃 SDK `Query` async iterator。它是 protocol routing ID，不是 Claude session ID。Claude session ID 仍使用 SDK message payload 和 session operation 返回的值。

Prompt 是 discriminated union：

- `{ type: "text", text }` 映射为 SDK string prompt。
- `{ type: "stream" }` 映射为 `AsyncIterable<SDKUserMessage>`；client 随后按顺序发送 `agent.claude.query.input.notification`，并用 `agent.claude.query.input.complete.notification` 结束输入。

Iterator 正常结束后，server 发送 `agent.claude.query.complete.notification`；迭代失败时发送 `agent.claude.query.error.notification`。每条 SDK 输出会在完成通知前发送，原始值保留在 `payload` 中。

## SDK 调用

Registry 通过 `scope` 与 `method` 导出上游调用目标，因此 server adapter 不需要反向解析 wire name。

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

全部 29 个 `Query` method 都有表示。`streamInput()` 使用前述 input notification，其余 method 映射为配对 request/response operation：

| 领域 | SDK method |
| --- | --- |
| Lifecycle | `interrupt`、`close`、`initializationResult`、`reinitialize` |
| Model 与 permission | `setPermissionMode`、`setMcpPermissionModeOverride`、`setModel`、`setMaxThinkingTokens` |
| Settings | `applyFlagSettings`、`updateSettings` |
| Discovery | `supportedCommands`、`supportedModels`、`supportedAgents`、`accountInfo` |
| MCP | `mcpServerStatus`、`reconnectMcpServer`、`toggleMcpServer`、`setMcpServers` |
| Context 与 usage | `getContextUsage`、`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` |
| File 与 reload | `readFile`、`rewindFiles`、`seedReadState`、`reloadPlugins`、`reloadSkills`、`reloadOutputStyles` |
| Task | `stopTask`、`backgroundTasks` |

Void response 省略 `result`，只携带 `requestId`。`getSessionInfo()` 在 SDK 返回 `undefined` 时返回 `null`，因为该缺失值本身是 method 的有效结果，而 `undefined` 不是 JSON wire value。

## Option 与 MCP

`ClaudeQueryOptionsSchema` 表示 SDK `Options` 中每个可序列化 key。Session/settings utility option 使用严格的逐字段 schema。

MCP server configuration 支持可序列化的 stdio、HTTP 与 SSE SDK config。与 SDK 兼容、不带 `type` 的 stdio config 会规范化为 `type: "stdio"`。进程内 `{ type: "sdk", instance }` server 被排除，因为 `McpServer` instance 包含可执行函数与进程本地状态。

以下 option key 明确不进入 wire：

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

它们携带 callback、活跃 handle、store，或其语义依赖一个已排除 callback。未来 server adapter 可在授权后补充自己的本地值，但不得从不受信任的远程 client 接受这些对象。

以下公共顶层 export 不作为远程 operation：

```txt
createSdkMcpServer
filterEscalatingDefaultMode
foldSessionSummary
importSessionToStore
startup
tool
```

`tool()` 与 `createSdkMcpServer()` 会创建含函数、仅在进程内有效的对象；session-store helper 同样消费本地对象，`filterEscalatingDefaultMode` 是纯 settings helper，而通过 `startup()` 预热被明确排除在远程 API 之外。SDK type 由 `@cypheria/protocol/claude-types` 仅按类型重新导出，使 adapter 可以复用精确固定版本的 declaration，无需再创建一套 DTO model。

## 输出消息与漂移控制

该 SDK 没有发布类似 ACP generated Zod module 的运行时 validator。因此 Cypheria 保持每个 `SDKMessage` JSON-transparent，校验上游 `type`、`subtype` 与 live/replay discriminator，并将其包装成具体顶层 notification。例如：

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

System family 当前展开为 28 个具体 subtype message；与其他 family 合计后，generated union 共 40 个分支。精确名称与 SDK type mapping 位于 `packages/protocol/src/generated/claude/messages.ts`。

`generate-agent-claude-code-messages.mjs` 使用 TypeScript compiler API 检查已安装 SDK 的 declaration file。Build、typecheck 与 test 前，`--check` 会将已提交 registry 与安装包比较，并清点：

- 40 个 `SDKMessage` 分支及其 discriminator；
- 29 个 `Query` method；
- 全部 67 个 `Options` key；
- 全部 17 个 exported function；
- 精确 package version。

升级 SDK 时，必须同时更新精确 dependency、重新生成 registry、分类每个新增 option/export、更新 schema 与 test，并提交全部结果。

## Adapter 职责

`@cypheria/client/claude` 通过绑定借用 `CypheriaApi` 的门面提供网络安全的 SDK 调用形态。它分配 request/query ID，把 async input iterable 转成 notification，为每个 query 重建 async output stream，关联 response，让 `AbortController` 只在本地生效，并传播 transport failure。

未来 server adapter 应持有 SDK query object，通过 `AGENT_CLAUDE_RPC` dispatch，把具名 wire argument 转成 SDK call，按顺序发送已包装 SDK message，规范化非 JSON result，对 filesystem/process/environment option 做授权，并在逻辑 session 结束时释放全部活跃 iterator。
