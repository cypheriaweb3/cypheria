import type {
  AgentDefinition,
  ForkSessionOptions,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  GetSubagentMessagesOptions,
  ListSessionsOptions,
  ListSubagentsOptions,
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
  Query,
  ResolveSettingsOptions,
  SDKMessage,
  SDKUserMessage,
  Options as SdkOptions,
  SessionMutationOptions,
  Settings,
  ThinkingConfig,
  ToolConfig,
} from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

import {
  AGENT_CLAUDE_SDK_NOTIFICATIONS,
  type AgentClaudeSdkNotification,
  AgentClaudeSdkNotificationSchema,
  CLAUDE_AGENT_SDK_OPTION_KEYS,
  type CLAUDE_AGENT_SDK_QUERY_METHODS,
  type CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS,
} from "../generated/claude/messages.ts"
import {
  ClaudeQueryIdSchema,
  ClaudeSdkErrorSchema,
  claudeDiscriminatedUnion,
  claudeJsonSchema,
  claudeRequestSchema,
  claudeResponseSchema,
} from "./claude-schema-registry.ts"

export * from "../generated/claude/messages.ts"
export {
  ClaudeQueryIdSchema,
  type ClaudeSdkError,
  ClaudeSdkErrorSchema,
} from "./claude-schema-registry.ts"

/** SDK callback/process objects that cannot be represented by a network protocol. */
export const CLAUDE_AGENT_SDK_EXCLUDED_OPTION_KEYS = [
  "abortController",
  "canUseTool",
  "hooks",
  "loadTimeoutMs",
  "onElicitation",
  "onUserDialog",
  "sessionStore",
  "sessionStoreFlush",
  "spawnClaudeCodeProcess",
  "stderr",
  "supportedDialogKinds",
] as const satisfies readonly (typeof CLAUDE_AGENT_SDK_OPTION_KEYS)[number][]

/** Local helpers or function-bearing APIs that deliberately remain server-side. */
export const CLAUDE_AGENT_SDK_EXCLUDED_TOP_LEVEL_FUNCTIONS = [
  "createSdkMcpServer",
  "filterEscalatingDefaultMode",
  "foldSessionSummary",
  "importSessionToStore",
  "startup",
  "tool",
] as const satisfies readonly (typeof CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS)[number][]

type ExcludedOption = (typeof CLAUDE_AGENT_SDK_EXCLUDED_OPTION_KEYS)[number]
const excludedOptionKeys = new Set<string>(CLAUDE_AGENT_SDK_EXCLUDED_OPTION_KEYS)
export const CLAUDE_AGENT_SDK_SERIALIZABLE_OPTION_KEYS = CLAUDE_AGENT_SDK_OPTION_KEYS.filter(
  (key): key is Exclude<(typeof CLAUDE_AGENT_SDK_OPTION_KEYS)[number], ExcludedOption> =>
    !excludedOptionKeys.has(key)
)
export type ClaudeMcpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig
export type ClaudeQueryOptions = Omit<SdkOptions, ExcludedOption | "mcpServers"> & {
  mcpServers?: Record<string, ClaudeMcpServerConfig>
}
export type ClaudeSessionMutationOptions = Omit<SessionMutationOptions, "sessionStore">
export type ClaudeForkSessionOptions = Omit<ForkSessionOptions, "sessionStore">
export type ClaudeGetSessionInfoOptions = Omit<GetSessionInfoOptions, "sessionStore">
export type ClaudeGetSessionMessagesOptions = Omit<GetSessionMessagesOptions, "sessionStore">
export type ClaudeGetSubagentMessagesOptions = Omit<GetSubagentMessagesOptions, "sessionStore">
export type ClaudeListSessionsOptions = Omit<ListSessionsOptions, "sessionStore">
export type ClaudeListSubagentsOptions = Omit<ListSubagentsOptions, "sessionStore">
export type ClaudeResolveSettingsOptions = ResolveSettingsOptions

export type ClaudeQueryMethod = (typeof CLAUDE_AGENT_SDK_QUERY_METHODS)[number]
type QueryMethodResult<Method extends ClaudeQueryMethod> = Query[Method] extends (
  ...args: never[]
) => infer Result
  ? Awaited<Result>
  : never
type SdkFunction = typeof import("@anthropic-ai/claude-agent-sdk")
type SdkFunctionResult<Method extends keyof SdkFunction> = SdkFunction[Method] extends (
  ...args: never[]
) => infer Result
  ? Awaited<Result>
  : never

const stringRecordSchema = z.record(z.string(), z.string())
const nullableStringRecordSchema = z.record(z.string(), z.union([z.string(), z.null()]))

const ClaudeMcpStdioServerConfigSchema = z.object({
  alwaysLoad: z.boolean().optional(),
  args: z.array(z.string()).optional(),
  command: z.string(),
  env: stringRecordSchema.optional(),
  timeout: z.number().nonnegative().optional(),
  type: z.literal("stdio"),
})
const ClaudeMcpRemoteToolPolicySchema = z.object({
  name: z.string(),
  org_max_permission: z.enum(["allow", "ask", "blocked"]).optional(),
  permission_policy: z.enum(["always_allow", "always_ask", "always_deny"]).optional(),
})
const claudeMcpRemoteServerConfigSchema = <const Type extends "http" | "sse">(type: Type) =>
  z.object({
    alwaysLoad: z.boolean().optional(),
    headers: stringRecordSchema.optional(),
    timeout: z.number().nonnegative().optional(),
    tools: z.array(ClaudeMcpRemoteToolPolicySchema).optional(),
    type: z.literal(type),
    url: z.string(),
  })
const ClaudeMcpServerConfigSchema: z.ZodType<ClaudeMcpServerConfig> = z.preprocess(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("type" in value) &&
    "command" in value
      ? { ...value, type: "stdio" }
      : value,
  z.discriminatedUnion("type", [
    ClaudeMcpStdioServerConfigSchema,
    claudeMcpRemoteServerConfigSchema("http"),
    claudeMcpRemoteServerConfigSchema("sse"),
  ])
) as z.ZodType<ClaudeMcpServerConfig>

const ClaudeThinkingSchema: z.ZodType<ThinkingConfig> = z.discriminatedUnion("type", [
  z.object({ display: z.enum(["summarized", "omitted"]).optional(), type: z.literal("adaptive") }),
  z.object({
    budgetTokens: z.number().int().nonnegative().optional(),
    display: z.enum(["summarized", "omitted"]).optional(),
    type: z.literal("enabled"),
  }),
  z.object({ type: z.literal("disabled") }),
]) as z.ZodType<ThinkingConfig>

const ClaudeSystemPromptSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.discriminatedUnion("type", [
    z.object({
      prompt: z.union([z.string(), z.array(z.string())]),
      snapshot: z.boolean().optional(),
      type: z.literal("custom"),
    }),
    z.object({
      append: z.string().optional(),
      excludeDynamicSections: z.boolean().optional(),
      preset: z.literal("claude_code"),
      snapshot: z.boolean().optional(),
      type: z.literal("preset"),
    }),
  ]),
])

type SerializableOptionKey = Exclude<(typeof CLAUDE_AGENT_SDK_OPTION_KEYS)[number], ExcludedOption>
const claudeQueryOptionShape = {
  additionalDirectories: z.array(z.string()),
  agent: z.string(),
  agentProgressSummaries: z.boolean(),
  agents: claudeJsonSchema<Record<string, AgentDefinition>>(),
  allowDangerouslySkipPermissions: z.boolean(),
  allowedTools: z.array(z.string()),
  betas: z.array(z.literal("context-1m-2025-08-07")),
  continue: z.boolean(),
  cwd: z.string(),
  debug: z.boolean(),
  debugFile: z.string(),
  disallowedTools: z.array(z.string()),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  enableFileCheckpointing: z.boolean(),
  env: stringRecordSchema,
  executable: z.enum(["bun", "deno", "node"]),
  executableArgs: z.array(z.string()),
  extraArgs: nullableStringRecordSchema,
  fallbackModel: z.string(),
  forkSession: z.boolean(),
  forwardSubagentText: z.boolean(),
  includeHookEvents: z.boolean(),
  includePartialMessages: z.boolean(),
  managedSettings: claudeJsonSchema<Settings>(),
  maxBudgetUsd: z.number().nonnegative(),
  maxThinkingTokens: z.number().int().nonnegative(),
  maxTurns: z.number().int().positive(),
  mcpServers: z.record(z.string(), ClaudeMcpServerConfigSchema),
  model: z.string(),
  outputFormat: claudeJsonSchema<NonNullable<SdkOptions["outputFormat"]>>(),
  pathToClaudeCodeExecutable: z.string(),
  perTaskStopAffordance: z.boolean(),
  permissionMode: z.enum([
    "default",
    "acceptEdits",
    "bypassPermissions",
    "plan",
    "dontAsk",
    "auto",
  ]),
  permissionPromptToolName: z.string(),
  permissionPrompts: z.enum(["host", "none"]),
  persistSession: z.boolean(),
  planModeInstructions: z.string(),
  pluginDelivery: z.enum(["argv", "initialize"]),
  plugins: claudeJsonSchema<NonNullable<SdkOptions["plugins"]>>(),
  projectConfigRoot: z.string(),
  promptSuggestions: z.boolean(),
  resume: z.string(),
  resumeDropsTurn: z.string(),
  resumeSessionAt: z.string(),
  sandbox: claudeJsonSchema<NonNullable<SdkOptions["sandbox"]>>(),
  sessionId: z.string(),
  settingSources: z.array(z.enum(["user", "project", "local"])),
  settings: z.union([z.string(), claudeJsonSchema<Settings>()]),
  skills: z.union([z.literal("all"), z.array(z.string())]),
  strictMcpConfig: z.boolean(),
  systemPrompt: ClaudeSystemPromptSchema,
  taskBudget: z.object({ total: z.number().int().positive() }),
  thinking: ClaudeThinkingSchema,
  title: z.string(),
  toolAliases: stringRecordSchema,
  toolConfig: claudeJsonSchema<ToolConfig>(),
  tools: z.union([
    z.array(z.string()),
    z.object({ preset: z.literal("claude_code"), type: z.literal("preset") }),
  ]),
} satisfies Record<SerializableOptionKey, z.ZodType>

const ClaudeQueryOptionsObjectSchema = z.strictObject(claudeQueryOptionShape).partial()
export const ClaudeQueryOptionsSchema: z.ZodType<ClaudeQueryOptions> =
  ClaudeQueryOptionsObjectSchema as z.ZodType<ClaudeQueryOptions>
export const ClaudeSessionMutationOptionsSchema: z.ZodType<ClaudeSessionMutationOptions> =
  z.strictObject({ dir: z.string().optional() })
export const ClaudeForkSessionOptionsSchema: z.ZodType<ClaudeForkSessionOptions> = z.strictObject({
  dir: z.string().optional(),
  title: z.string().optional(),
  upToMessageId: z.string().optional(),
})
export const ClaudeGetSessionInfoOptionsSchema: z.ZodType<ClaudeGetSessionInfoOptions> =
  ClaudeSessionMutationOptionsSchema
export const ClaudeGetSessionMessagesOptionsSchema: z.ZodType<ClaudeGetSessionMessagesOptions> =
  z.strictObject({
    dir: z.string().optional(),
    includeSystemMessages: z.boolean().optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
export const ClaudeGetSubagentMessagesOptionsSchema: z.ZodType<ClaudeGetSubagentMessagesOptions> =
  z.strictObject({
    dir: z.string().optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
export const ClaudeListSessionsOptionsSchema: z.ZodType<ClaudeListSessionsOptions> = z.strictObject(
  {
    dir: z.string().optional(),
    includeProgrammatic: z.boolean().optional(),
    includeWorktrees: z.boolean().optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
  }
)
export const ClaudeListSubagentsOptionsSchema: z.ZodType<ClaudeListSubagentsOptions> =
  ClaudeSessionMutationOptionsSchema
export const ClaudeResolveSettingsOptionsSchema: z.ZodType<ClaudeResolveSettingsOptions> =
  z.strictObject({
    cwd: z.string().optional(),
    managedSettings: claudeJsonSchema<Settings>().optional(),
    serverManagedSettings: claudeJsonSchema<Settings>().optional(),
    settingSources: z.array(z.enum(["user", "project", "local"])).optional(),
  })

export const ClaudeQueryPromptSchema = z.discriminatedUnion("type", [
  z.object({ text: z.string(), type: z.literal("text") }),
  z.object({ type: z.literal("stream") }),
])
export type ClaudeQueryPrompt = z.infer<typeof ClaudeQueryPromptSchema>

const ClaudeSdkUserInputSchema: z.ZodType<SDKUserMessage> =
  claudeJsonSchema<SDKUserMessage>().refine(
    (message) => message.type === "user" && !("isReplay" in message && message.isReplay === true),
    "Claude query input must be a live SDKUserMessage"
  )

const queryIdParams = { queryId: ClaudeQueryIdSchema } as const
const emptyResultSchema = z.undefined()
const rpc = <
  const Scope extends "sdk" | "query",
  const Method extends string,
  const RequestType extends string,
  const ResponseType extends string,
  ParamsSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
>(
  scope: Scope,
  method: Method,
  request: RequestType,
  response: ResponseType,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema
) => ({
  method,
  request,
  requestSchema: claudeRequestSchema(request, paramsSchema),
  response,
  responseSchema: claudeResponseSchema(response, resultSchema),
  scope,
})

export const AGENT_CLAUDE_RPC = {
  query: rpc(
    "sdk",
    "query",
    "agent.claude.query.start.request",
    "agent.claude.query.start.response",
    z.strictObject({
      queryId: ClaudeQueryIdSchema,
      prompt: ClaudeQueryPromptSchema,
      options: ClaudeQueryOptionsSchema.optional(),
    }),
    z.object({ queryId: ClaudeQueryIdSchema })
  ),
  listSessions: rpc(
    "sdk",
    "listSessions",
    "agent.claude.session.list.request",
    "agent.claude.session.list.response",
    z.strictObject({ options: ClaudeListSessionsOptionsSchema.optional() }),
    claudeJsonSchema<SdkFunctionResult<"listSessions">>()
  ),
  getSessionInfo: rpc(
    "sdk",
    "getSessionInfo",
    "agent.claude.session.get.request",
    "agent.claude.session.get.response",
    z.strictObject({
      options: ClaudeGetSessionInfoOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    claudeJsonSchema<Exclude<SdkFunctionResult<"getSessionInfo">, undefined> | null>()
  ),
  getSessionMessages: rpc(
    "sdk",
    "getSessionMessages",
    "agent.claude.session.messages.list.request",
    "agent.claude.session.messages.list.response",
    z.strictObject({
      options: ClaudeGetSessionMessagesOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    claudeJsonSchema<SdkFunctionResult<"getSessionMessages">>()
  ),
  listSubagents: rpc(
    "sdk",
    "listSubagents",
    "agent.claude.session.subagent.list.request",
    "agent.claude.session.subagent.list.response",
    z.strictObject({
      options: ClaudeListSubagentsOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    claudeJsonSchema<SdkFunctionResult<"listSubagents">>()
  ),
  getSubagentMessages: rpc(
    "sdk",
    "getSubagentMessages",
    "agent.claude.session.subagent.messages.list.request",
    "agent.claude.session.subagent.messages.list.response",
    z.strictObject({
      agentId: z.string(),
      options: ClaudeGetSubagentMessagesOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    claudeJsonSchema<SdkFunctionResult<"getSubagentMessages">>()
  ),
  renameSession: rpc(
    "sdk",
    "renameSession",
    "agent.claude.session.rename.request",
    "agent.claude.session.rename.response",
    z.strictObject({
      options: ClaudeSessionMutationOptionsSchema.optional(),
      sessionId: z.string(),
      title: z.string(),
    }),
    emptyResultSchema
  ),
  tagSession: rpc(
    "sdk",
    "tagSession",
    "agent.claude.session.tag.request",
    "agent.claude.session.tag.response",
    z.strictObject({
      options: ClaudeSessionMutationOptionsSchema.optional(),
      sessionId: z.string(),
      tag: z.string().nullable(),
    }),
    emptyResultSchema
  ),
  deleteSession: rpc(
    "sdk",
    "deleteSession",
    "agent.claude.session.delete.request",
    "agent.claude.session.delete.response",
    z.strictObject({
      options: ClaudeSessionMutationOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    emptyResultSchema
  ),
  forkSession: rpc(
    "sdk",
    "forkSession",
    "agent.claude.session.fork.request",
    "agent.claude.session.fork.response",
    z.strictObject({
      options: ClaudeForkSessionOptionsSchema.optional(),
      sessionId: z.string(),
    }),
    claudeJsonSchema<SdkFunctionResult<"forkSession">>()
  ),
  resolveSettings: rpc(
    "sdk",
    "resolveSettings",
    "agent.claude.settings.resolve.request",
    "agent.claude.settings.resolve.response",
    z.strictObject({ options: ClaudeResolveSettingsOptionsSchema.optional() }),
    claudeJsonSchema<SdkFunctionResult<"resolveSettings">>()
  ),

  interrupt: rpc(
    "query",
    "interrupt",
    "agent.claude.query.interrupt.request",
    "agent.claude.query.interrupt.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<Exclude<QueryMethodResult<"interrupt">, undefined> | null>()
  ),
  setPermissionMode: rpc(
    "query",
    "setPermissionMode",
    "agent.claude.query.permission_mode.set.request",
    "agent.claude.query.permission_mode.set.response",
    z.strictObject({
      ...queryIdParams,
      mode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"]),
    }),
    emptyResultSchema
  ),
  setMcpPermissionModeOverride: rpc(
    "query",
    "setMcpPermissionModeOverride",
    "agent.claude.query.mcp_permission_mode_override.set.request",
    "agent.claude.query.mcp_permission_mode_override.set.response",
    z.strictObject({
      ...queryIdParams,
      mode: z.enum(["default", "auto"]).nullable(),
      serverName: z.string(),
    }),
    claudeJsonSchema<QueryMethodResult<"setMcpPermissionModeOverride">>()
  ),
  setModel: rpc(
    "query",
    "setModel",
    "agent.claude.query.model.set.request",
    "agent.claude.query.model.set.response",
    z.strictObject({ ...queryIdParams, model: z.string().nullable() }),
    emptyResultSchema
  ),
  setMaxThinkingTokens: rpc(
    "query",
    "setMaxThinkingTokens",
    "agent.claude.query.max_thinking_tokens.set.request",
    "agent.claude.query.max_thinking_tokens.set.response",
    z.strictObject({
      ...queryIdParams,
      maxThinkingTokens: z.number().int().nonnegative().nullable(),
      thinkingDisplay: z.enum(["summarized", "omitted"]).nullable().optional(),
    }),
    emptyResultSchema
  ),
  applyFlagSettings: rpc(
    "query",
    "applyFlagSettings",
    "agent.claude.query.flag_settings.apply.request",
    "agent.claude.query.flag_settings.apply.response",
    z.strictObject({ ...queryIdParams, settings: z.record(z.string(), z.json().nullable()) }),
    emptyResultSchema
  ),
  updateSettings: rpc(
    "query",
    "updateSettings",
    "agent.claude.query.settings.update.request",
    "agent.claude.query.settings.update.response",
    z.strictObject({
      ...queryIdParams,
      settings: z.record(z.string(), z.json()),
      source: z.literal("localSettings"),
    }),
    emptyResultSchema
  ),
  initializationResult: rpc(
    "query",
    "initializationResult",
    "agent.claude.query.initialization.get.request",
    "agent.claude.query.initialization.get.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"initializationResult">>()
  ),
  reinitialize: rpc(
    "query",
    "reinitialize",
    "agent.claude.query.reinitialize.request",
    "agent.claude.query.reinitialize.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"reinitialize">>()
  ),
  supportedCommands: rpc(
    "query",
    "supportedCommands",
    "agent.claude.query.command.list.request",
    "agent.claude.query.command.list.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"supportedCommands">>()
  ),
  supportedModels: rpc(
    "query",
    "supportedModels",
    "agent.claude.query.model.list.request",
    "agent.claude.query.model.list.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"supportedModels">>()
  ),
  supportedAgents: rpc(
    "query",
    "supportedAgents",
    "agent.claude.query.agent.list.request",
    "agent.claude.query.agent.list.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"supportedAgents">>()
  ),
  mcpServerStatus: rpc(
    "query",
    "mcpServerStatus",
    "agent.claude.query.mcp_server.status.request",
    "agent.claude.query.mcp_server.status.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"mcpServerStatus">>()
  ),
  getContextUsage: rpc(
    "query",
    "getContextUsage",
    "agent.claude.query.context_usage.get.request",
    "agent.claude.query.context_usage.get.response",
    z.strictObject({
      ...queryIdParams,
      options: z.object({ detail: z.enum(["summary", "full"]).optional() }).optional(),
    }),
    claudeJsonSchema<QueryMethodResult<"getContextUsage">>()
  ),
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: rpc(
    "query",
    "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
    "agent.claude.query.usage.get.request",
    "agent.claude.query.usage.get.response",
    z.strictObject({
      ...queryIdParams,
      options: z.object({ skipBehaviors: z.boolean().optional() }).optional(),
    }),
    claudeJsonSchema<
      QueryMethodResult<"usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET">
    >()
  ),
  readFile: rpc(
    "query",
    "readFile",
    "agent.claude.query.file.read.request",
    "agent.claude.query.file.read.response",
    z.strictObject({
      ...queryIdParams,
      options: z
        .object({
          encoding: z.enum(["utf-8", "base64"]).optional(),
          maxBytes: z.number().int().positive().optional(),
        })
        .optional(),
      path: z.string(),
    }),
    claudeJsonSchema<QueryMethodResult<"readFile">>()
  ),
  reloadPlugins: rpc(
    "query",
    "reloadPlugins",
    "agent.claude.query.plugin.reload.request",
    "agent.claude.query.plugin.reload.response",
    z.strictObject({
      ...queryIdParams,
      options: z.object({ holdOnCacheImpact: z.boolean().optional() }).optional(),
    }),
    claudeJsonSchema<QueryMethodResult<"reloadPlugins">>()
  ),
  reloadSkills: rpc(
    "query",
    "reloadSkills",
    "agent.claude.query.skill.reload.request",
    "agent.claude.query.skill.reload.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"reloadSkills">>()
  ),
  reloadOutputStyles: rpc(
    "query",
    "reloadOutputStyles",
    "agent.claude.query.output_style.reload.request",
    "agent.claude.query.output_style.reload.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"reloadOutputStyles">>()
  ),
  accountInfo: rpc(
    "query",
    "accountInfo",
    "agent.claude.query.account.get.request",
    "agent.claude.query.account.get.response",
    z.strictObject(queryIdParams),
    claudeJsonSchema<QueryMethodResult<"accountInfo">>()
  ),
  rewindFiles: rpc(
    "query",
    "rewindFiles",
    "agent.claude.query.file.rewind.request",
    "agent.claude.query.file.rewind.response",
    z.strictObject({
      ...queryIdParams,
      options: z.object({ dryRun: z.boolean().optional() }).optional(),
      userMessageId: z.string(),
    }),
    claudeJsonSchema<QueryMethodResult<"rewindFiles">>()
  ),
  seedReadState: rpc(
    "query",
    "seedReadState",
    "agent.claude.query.read_state.seed.request",
    "agent.claude.query.read_state.seed.response",
    z.strictObject({ ...queryIdParams, mtime: z.number().nonnegative(), path: z.string() }),
    emptyResultSchema
  ),
  reconnectMcpServer: rpc(
    "query",
    "reconnectMcpServer",
    "agent.claude.query.mcp_server.reconnect.request",
    "agent.claude.query.mcp_server.reconnect.response",
    z.strictObject({ ...queryIdParams, serverName: z.string() }),
    emptyResultSchema
  ),
  toggleMcpServer: rpc(
    "query",
    "toggleMcpServer",
    "agent.claude.query.mcp_server.toggle.request",
    "agent.claude.query.mcp_server.toggle.response",
    z.strictObject({ ...queryIdParams, enabled: z.boolean(), serverName: z.string() }),
    emptyResultSchema
  ),
  setMcpServers: rpc(
    "query",
    "setMcpServers",
    "agent.claude.query.mcp_server.set.request",
    "agent.claude.query.mcp_server.set.response",
    z.strictObject({
      ...queryIdParams,
      servers: z.record(z.string(), ClaudeMcpServerConfigSchema),
    }),
    claudeJsonSchema<QueryMethodResult<"setMcpServers">>()
  ),
  stopTask: rpc(
    "query",
    "stopTask",
    "agent.claude.query.task.stop.request",
    "agent.claude.query.task.stop.response",
    z.strictObject({ ...queryIdParams, taskId: z.string() }),
    emptyResultSchema
  ),
  backgroundTasks: rpc(
    "query",
    "backgroundTasks",
    "agent.claude.query.task.background.request",
    "agent.claude.query.task.background.response",
    z.strictObject({ ...queryIdParams, toolUseId: z.string().optional() }),
    z.boolean()
  ),
  close: rpc(
    "query",
    "close",
    "agent.claude.query.close.request",
    "agent.claude.query.close.response",
    z.strictObject(queryIdParams),
    emptyResultSchema
  ),
} as const

export type AgentClaudeRpcName = keyof typeof AGENT_CLAUDE_RPC
type ClaudeRpcDefinition = (typeof AGENT_CLAUDE_RPC)[keyof typeof AGENT_CLAUDE_RPC]
export type AgentClaudeClientRequest = z.output<ClaudeRpcDefinition["requestSchema"]>
export type AgentClaudeServerResponse = z.output<ClaudeRpcDefinition["responseSchema"]>

export const AgentClaudeClientRequestSchema = claudeDiscriminatedUnion<AgentClaudeClientRequest>(
  Object.values(AGENT_CLAUDE_RPC).map(({ requestSchema }) => requestSchema)
)
export const AgentClaudeServerResponseSchema = claudeDiscriminatedUnion<AgentClaudeServerResponse>(
  Object.values(AGENT_CLAUDE_RPC).map(({ responseSchema }) => responseSchema)
)

export const AGENT_CLAUDE_REQUEST_TYPE_TO_RPC = Object.fromEntries(
  Object.entries(AGENT_CLAUDE_RPC).map(([name, definition]) => [definition.request, name])
) as Record<ClaudeRpcDefinition["request"], AgentClaudeRpcName>
export const AGENT_CLAUDE_RESPONSE_TYPE_TO_RPC = Object.fromEntries(
  Object.entries(AGENT_CLAUDE_RPC).map(([name, definition]) => [definition.response, name])
) as Record<ClaudeRpcDefinition["response"], AgentClaudeRpcName>

/** Resolves the SDK target and method for a parsed Claude request. */
export const getAgentClaudeRpcDefinition = (
  request: AgentClaudeClientRequest
): ClaudeRpcDefinition => AGENT_CLAUDE_RPC[AGENT_CLAUDE_REQUEST_TYPE_TO_RPC[request.type]]

export const AgentClaudeQueryInputNotificationSchema = z.object({
  payload: ClaudeSdkUserInputSchema,
  queryId: ClaudeQueryIdSchema,
  type: z.literal("agent.claude.query.input.notification"),
})
export const AgentClaudeQueryInputCompleteNotificationSchema = z.object({
  queryId: ClaudeQueryIdSchema,
  type: z.literal("agent.claude.query.input.complete.notification"),
})
export type AgentClaudeQueryInputNotification = z.infer<
  typeof AgentClaudeQueryInputNotificationSchema
>
export type AgentClaudeQueryInputCompleteNotification = z.infer<
  typeof AgentClaudeQueryInputCompleteNotificationSchema
>

export const AgentClaudeQueryCompleteNotificationSchema = z.object({
  queryId: ClaudeQueryIdSchema,
  type: z.literal("agent.claude.query.complete.notification"),
})
export const AgentClaudeQueryErrorNotificationSchema = z.object({
  payload: ClaudeSdkErrorSchema,
  queryId: ClaudeQueryIdSchema,
  type: z.literal("agent.claude.query.error.notification"),
})
export type AgentClaudeQueryCompleteNotification = z.infer<
  typeof AgentClaudeQueryCompleteNotificationSchema
>
export type AgentClaudeQueryErrorNotification = z.infer<
  typeof AgentClaudeQueryErrorNotificationSchema
>

export type AgentClaudeClientNotification =
  | AgentClaudeQueryInputNotification
  | AgentClaudeQueryInputCompleteNotification
export const AgentClaudeClientNotificationSchema =
  claudeDiscriminatedUnion<AgentClaudeClientNotification>([
    AgentClaudeQueryInputNotificationSchema,
    AgentClaudeQueryInputCompleteNotificationSchema,
  ])

export type AgentClaudeServerNotification =
  | AgentClaudeSdkNotification
  | AgentClaudeQueryCompleteNotification
  | AgentClaudeQueryErrorNotification
export const AgentClaudeServerNotificationSchema =
  claudeDiscriminatedUnion<AgentClaudeServerNotification>([
    AgentClaudeSdkNotificationSchema,
    AgentClaudeQueryCompleteNotificationSchema,
    AgentClaudeQueryErrorNotificationSchema,
  ])

export type AgentClaudeClientMessage = AgentClaudeClientRequest | AgentClaudeClientNotification
export const AgentClaudeClientMessageSchema = claudeDiscriminatedUnion<AgentClaudeClientMessage>([
  AgentClaudeClientRequestSchema,
  AgentClaudeClientNotificationSchema,
])

export type AgentClaudeServerMessage = AgentClaudeServerResponse | AgentClaudeServerNotification
export const AgentClaudeServerMessageSchema = claudeDiscriminatedUnion<AgentClaudeServerMessage>([
  AgentClaudeServerResponseSchema,
  AgentClaudeServerNotificationSchema,
])

const matchesSdkMessage = (
  message: SDKMessage,
  definition: (typeof AGENT_CLAUDE_SDK_NOTIFICATIONS)[keyof typeof AGENT_CLAUDE_SDK_NOTIFICATIONS]
): boolean => {
  if (message.type !== definition.payloadType) return false
  if (
    definition.payloadSubtypes.length > 0 &&
    !("subtype" in message && definition.payloadSubtypes.includes(message.subtype as never))
  ) {
    return false
  }
  if (definition.replay === "replay") return "isReplay" in message && message.isReplay === true
  if (definition.replay === "live") return !("isReplay" in message && message.isReplay === true)
  return true
}

/** Wraps one SDK output item in its concrete Cypheria notification type. */
export const wrapClaudeSdkMessage = (
  queryId: string,
  message: SDKMessage
): AgentClaudeSdkNotification => {
  for (const definition of Object.values(AGENT_CLAUDE_SDK_NOTIFICATIONS)) {
    if (!matchesSdkMessage(message, definition)) continue
    return definition.schema.parse({ payload: message, queryId, type: definition.notification })
  }
  throw new TypeError(`Unsupported Claude Agent SDK message: ${message.type}`)
}

/** Returns the original SDK message carried by a Claude stream notification. */
export const unwrapClaudeSdkMessage = (notification: AgentClaudeSdkNotification): SDKMessage =>
  notification.payload
