import { z } from "zod"

import { RequestIdSchema } from "./request-id.ts"

export const CodexNativeProviderSchema = z.enum(["openai", "amazon-bedrock", "ollama", "lmstudio"])
export type CodexNativeProvider = z.infer<typeof CodexNativeProviderSchema>

export const CodexAccountViewSchema = z
  .object({
    email: z.string().nullable(),
    planType: z.string().nullable(),
    requiresOpenaiAuth: z.boolean(),
    type: z.enum(["apiKey", "chatgpt", "amazonBedrock"]).nullable(),
  })
  .strict()
export type CodexAccountView = z.infer<typeof CodexAccountViewSchema>

export const CodexLoginInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chatgpt") }).strict(),
  z.object({ apiKey: z.string().min(1), type: z.literal("apiKey") }).strict(),
])
export type CodexLoginInput = z.infer<typeof CodexLoginInputSchema>

export const CodexLoginResultSchema = z
  .object({
    authUrl: z.url().optional(),
    loginId: z.string().optional(),
    type: z.enum(["apiKey", "chatgpt"]),
  })
  .strict()
export type CodexLoginResult = z.infer<typeof CodexLoginResultSchema>

export const CodexModelViewSchema = z
  .object({
    defaultReasoningEffort: z.string(),
    defaultServiceTier: z.string().nullable(),
    description: z.string(),
    displayName: z.string(),
    hidden: z.boolean(),
    id: z.string().min(1),
    inputModalities: z.array(z.string()),
    isDefault: z.boolean(),
    model: z.string().min(1),
    reasoningEfforts: z.array(z.object({ description: z.string(), value: z.string() }).strict()),
    serviceTiers: z.array(
      z.object({ description: z.string(), id: z.string(), name: z.string() }).strict()
    ),
  })
  .strict()
export type CodexModelView = z.infer<typeof CodexModelViewSchema>

export const CodexModelSettingsSchema = z
  .object({
    model: z.string().nullable(),
    provider: CodexNativeProviderSchema,
    reasoningEffort: z.string().nullable(),
    serviceTier: z.string().nullable(),
  })
  .strict()
export type CodexModelSettings = z.infer<typeof CodexModelSettingsSchema>

export const CodexApprovalPolicySchema = z.enum(["on-request", "never"])
export const CodexApprovalsReviewerSchema = z.enum(["user", "auto_review"])
export const CodexSandboxModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"])
export const CodexPermissionDefaultsWriteSchema = z
  .object({
    approvalPolicy: CodexApprovalPolicySchema,
    approvalsReviewer: CodexApprovalsReviewerSchema,
    modelReasoningSummary: z.enum(["auto", "concise", "detailed", "none"]).nullable(),
    modelVerbosity: z.enum(["low", "medium", "high"]).nullable(),
    networkAccess: z.boolean(),
    sandboxMode: CodexSandboxModeSchema,
    webSearch: z.enum(["disabled", "cached", "indexed", "live"]).nullable(),
  })
  .strict()
export type CodexPermissionDefaultsWrite = z.infer<typeof CodexPermissionDefaultsWriteSchema>
export const CodexAgentSettingsSchema = CodexModelSettingsSchema.extend({
  ...CodexPermissionDefaultsWriteSchema.shape,
  personality: z.enum(["friendly", "pragmatic", "none"]),
  pluginsEnabled: z.boolean(),
}).strict()
export type CodexAgentSettings = z.infer<typeof CodexAgentSettingsSchema>
export const CodexPermissionDefaultsSchema = CodexPermissionDefaultsWriteSchema.extend({
  allowedApprovalPolicies: z.array(CodexApprovalPolicySchema).nullable(),
  allowedApprovalsReviewers: z.array(CodexApprovalsReviewerSchema).nullable(),
  allowedSandboxModes: z.array(CodexSandboxModeSchema).nullable(),
  allowedWebSearchModes: z.array(z.enum(["disabled", "cached", "indexed", "live"])).nullable(),
  configPath: z.string().min(1),
}).strict()
export type CodexPermissionDefaults = z.infer<typeof CodexPermissionDefaultsSchema>
export const CodexPermissionSelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      agentMode: z.enum(["read-only", "auto", "granular", "guardian-approvals", "full-access"]),
      kind: z.literal("agent-mode"),
    })
    .strict(),
  z.object({ kind: z.literal("profile"), profileId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("custom") }).strict(),
  z.object({ kind: z.literal("server-default") }).strict(),
])
export type CodexPermissionSelection = z.infer<typeof CodexPermissionSelectionSchema>
export const CodexPermissionsCatalogSchema = z
  .object({
    autoReviewAvailable: z.boolean(),
    availableAgentModes: z.array(
      z.enum(["read-only", "auto", "granular", "guardian-approvals", "full-access"])
    ),
    configPath: z.string().min(1),
    fullAccessCanBeShown: z.boolean(),
    profiles: z.array(
      z
        .object({ allowed: z.boolean(), description: z.string().nullable(), id: z.string().min(1) })
        .strict()
    ),
    selected: CodexPermissionSelectionSchema,
    source: z.enum(["config", "managed", "selection", "server-default"]),
  })
  .strict()
export type CodexPermissionsCatalog = z.infer<typeof CodexPermissionsCatalogSchema>

const request = <const T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) })
const error = z.object({ code: z.string(), message: z.string() }).strict()
const result = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ error, ok: z.literal(false) }).strict(),
  ])
const response = <const T extends string, S extends z.ZodType>(type: T, value: S) =>
  z.object({ payload: result(value), requestId: RequestIdSchema, type: z.literal(type) })
const succeeded = z.object({ succeeded: z.literal(true) }).strict()
const jsonObject = z.record(z.string(), z.json())

export const CodexAccountGetRequestSchema = request(
  "harness.codex.account.get.request",
  z.object({ refresh: z.boolean().optional() }).strict()
)
export const CodexAccountLoginRequestSchema = request(
  "harness.codex.account.login.request",
  CodexLoginInputSchema
)
export const CodexAccountLoginCancelRequestSchema = request(
  "harness.codex.account.login.cancel.request",
  z.object({ loginId: z.string().min(1) }).strict()
)
export const CodexAccountLogoutRequestSchema = request(
  "harness.codex.account.logout.request",
  z.object({}).strict()
)
export const CodexModelListRequestSchema = request(
  "harness.codex.model.list.request",
  z.object({ includeHidden: z.boolean().optional() }).strict()
)
export const CodexModelSettingsGetRequestSchema = request(
  "harness.codex.model-settings.get.request",
  z.object({}).strict()
)
export const CodexModelSettingsSetRequestSchema = request(
  "harness.codex.model-settings.set.request",
  CodexModelSettingsSchema
)
export const CodexPermissionDefaultsGetRequestSchema = request(
  "harness.codex.permissions.defaults.get.request",
  z.object({}).strict()
)
export const CodexPermissionDefaultsSetRequestSchema = request(
  "harness.codex.permissions.defaults.set.request",
  CodexPermissionDefaultsWriteSchema
)
export const CodexPermissionsCatalogGetRequestSchema = request(
  "harness.codex.permissions.catalog.get.request",
  z.object({ cwd: z.string().min(1).optional() }).strict()
)
export const CodexGuardianRetryRequestSchema = request(
  "harness.codex.guardian.retry.request",
  z.object({ event: z.json(), threadId: z.string().min(1) }).strict()
)

const codexThreadRequest = <const T extends string>(type: T) => request(type, jsonObject)
const codexThreadResponse = <const T extends string>(type: T) => response(type, z.json())

export const CodexThreadGoalGetRequestSchema = codexThreadRequest(
  "harness.codex.thread.goal.get.request"
)
export const CodexThreadGoalSetRequestSchema = codexThreadRequest(
  "harness.codex.thread.goal.set.request"
)
export const CodexThreadGoalClearRequestSchema = codexThreadRequest(
  "harness.codex.thread.goal.clear.request"
)
export const CodexThreadQueueListRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.list.request"
)
export const CodexThreadQueueAddRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.add.request"
)
export const CodexThreadQueueUpdateRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.update.request"
)
export const CodexThreadQueueDeleteRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.delete.request"
)
export const CodexThreadQueueReorderRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.reorder.request"
)
export const CodexThreadQueueStartRequestSchema = codexThreadRequest(
  "harness.codex.thread.queue.start.request"
)
export const CodexThreadUsageGetRequestSchema = codexThreadRequest(
  "harness.codex.thread.usage.get.request"
)
export const CodexThreadBackgroundTerminalsListRequestSchema = codexThreadRequest(
  "harness.codex.thread.background-terminals.list.request"
)
export const CodexThreadBackgroundTerminalsTerminateRequestSchema = codexThreadRequest(
  "harness.codex.thread.background-terminals.terminate.request"
)
export const CodexThreadBackgroundTerminalsCleanRequestSchema = codexThreadRequest(
  "harness.codex.thread.background-terminals.clean.request"
)
export const CodexThreadCompactRequestSchema = codexThreadRequest(
  "harness.codex.thread.compact.request"
)
export const CodexThreadRevertRequestSchema = codexThreadRequest(
  "harness.codex.thread.revert.request"
)
export const CodexThreadReviewStartRequestSchema = codexThreadRequest(
  "harness.codex.thread.review.start.request"
)
export const CodexAccountRateLimitsGetRequestSchema = request(
  "harness.codex.account.rate-limits.get.request",
  jsonObject
)

export const CodexAccountGetResponseSchema = response(
  "harness.codex.account.get.response",
  CodexAccountViewSchema
)
export const CodexAccountLoginResponseSchema = response(
  "harness.codex.account.login.response",
  CodexLoginResultSchema
)
export const CodexAccountLoginCancelResponseSchema = response(
  "harness.codex.account.login.cancel.response",
  z.object({ cancelled: z.boolean() }).strict()
)
export const CodexAccountLogoutResponseSchema = response(
  "harness.codex.account.logout.response",
  succeeded
)
export const CodexModelListResponseSchema = response(
  "harness.codex.model.list.response",
  z.object({ models: z.array(CodexModelViewSchema) }).strict()
)
export const CodexModelSettingsGetResponseSchema = response(
  "harness.codex.model-settings.get.response",
  CodexModelSettingsSchema
)
export const CodexModelSettingsSetResponseSchema = response(
  "harness.codex.model-settings.set.response",
  CodexModelSettingsSchema
)
export const CodexPermissionDefaultsGetResponseSchema = response(
  "harness.codex.permissions.defaults.get.response",
  CodexPermissionDefaultsSchema
)
export const CodexPermissionDefaultsSetResponseSchema = response(
  "harness.codex.permissions.defaults.set.response",
  CodexPermissionDefaultsSchema
)
export const CodexPermissionsCatalogGetResponseSchema = response(
  "harness.codex.permissions.catalog.get.response",
  CodexPermissionsCatalogSchema
)
export const CodexGuardianRetryResponseSchema = response(
  "harness.codex.guardian.retry.response",
  succeeded
)
export const CodexThreadGoalGetResponseSchema = codexThreadResponse(
  "harness.codex.thread.goal.get.response"
)
export const CodexThreadGoalSetResponseSchema = codexThreadResponse(
  "harness.codex.thread.goal.set.response"
)
export const CodexThreadGoalClearResponseSchema = codexThreadResponse(
  "harness.codex.thread.goal.clear.response"
)
export const CodexThreadQueueListResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.list.response"
)
export const CodexThreadQueueAddResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.add.response"
)
export const CodexThreadQueueUpdateResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.update.response"
)
export const CodexThreadQueueDeleteResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.delete.response"
)
export const CodexThreadQueueReorderResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.reorder.response"
)
export const CodexThreadQueueStartResponseSchema = codexThreadResponse(
  "harness.codex.thread.queue.start.response"
)
export const CodexThreadUsageGetResponseSchema = codexThreadResponse(
  "harness.codex.thread.usage.get.response"
)
export const CodexThreadBackgroundTerminalsListResponseSchema = codexThreadResponse(
  "harness.codex.thread.background-terminals.list.response"
)
export const CodexThreadBackgroundTerminalsTerminateResponseSchema = codexThreadResponse(
  "harness.codex.thread.background-terminals.terminate.response"
)
export const CodexThreadBackgroundTerminalsCleanResponseSchema = codexThreadResponse(
  "harness.codex.thread.background-terminals.clean.response"
)
export const CodexThreadCompactResponseSchema = codexThreadResponse(
  "harness.codex.thread.compact.response"
)
export const CodexThreadRevertResponseSchema = codexThreadResponse(
  "harness.codex.thread.revert.response"
)
export const CodexThreadReviewStartResponseSchema = codexThreadResponse(
  "harness.codex.thread.review.start.response"
)
export const CodexAccountRateLimitsGetResponseSchema = codexThreadResponse(
  "harness.codex.account.rate-limits.get.response"
)

export const CODEX_HARNESS_CLIENT_SCHEMAS = [
  CodexAccountGetRequestSchema,
  CodexAccountLoginRequestSchema,
  CodexAccountLoginCancelRequestSchema,
  CodexAccountLogoutRequestSchema,
  CodexModelListRequestSchema,
  CodexModelSettingsGetRequestSchema,
  CodexModelSettingsSetRequestSchema,
  CodexPermissionDefaultsGetRequestSchema,
  CodexPermissionDefaultsSetRequestSchema,
  CodexPermissionsCatalogGetRequestSchema,
  CodexGuardianRetryRequestSchema,
  CodexThreadGoalGetRequestSchema,
  CodexThreadGoalSetRequestSchema,
  CodexThreadGoalClearRequestSchema,
  CodexThreadQueueListRequestSchema,
  CodexThreadQueueAddRequestSchema,
  CodexThreadQueueUpdateRequestSchema,
  CodexThreadQueueDeleteRequestSchema,
  CodexThreadQueueReorderRequestSchema,
  CodexThreadQueueStartRequestSchema,
  CodexThreadUsageGetRequestSchema,
  CodexThreadBackgroundTerminalsListRequestSchema,
  CodexThreadBackgroundTerminalsTerminateRequestSchema,
  CodexThreadBackgroundTerminalsCleanRequestSchema,
  CodexThreadCompactRequestSchema,
  CodexThreadRevertRequestSchema,
  CodexThreadReviewStartRequestSchema,
  CodexAccountRateLimitsGetRequestSchema,
] as const

export const CODEX_HARNESS_SERVER_SCHEMAS = [
  CodexAccountGetResponseSchema,
  CodexAccountLoginResponseSchema,
  CodexAccountLoginCancelResponseSchema,
  CodexAccountLogoutResponseSchema,
  CodexModelListResponseSchema,
  CodexModelSettingsGetResponseSchema,
  CodexModelSettingsSetResponseSchema,
  CodexPermissionDefaultsGetResponseSchema,
  CodexPermissionDefaultsSetResponseSchema,
  CodexPermissionsCatalogGetResponseSchema,
  CodexGuardianRetryResponseSchema,
  CodexThreadGoalGetResponseSchema,
  CodexThreadGoalSetResponseSchema,
  CodexThreadGoalClearResponseSchema,
  CodexThreadQueueListResponseSchema,
  CodexThreadQueueAddResponseSchema,
  CodexThreadQueueUpdateResponseSchema,
  CodexThreadQueueDeleteResponseSchema,
  CodexThreadQueueReorderResponseSchema,
  CodexThreadQueueStartResponseSchema,
  CodexThreadUsageGetResponseSchema,
  CodexThreadBackgroundTerminalsListResponseSchema,
  CodexThreadBackgroundTerminalsTerminateResponseSchema,
  CodexThreadBackgroundTerminalsCleanResponseSchema,
  CodexThreadCompactResponseSchema,
  CodexThreadRevertResponseSchema,
  CodexThreadReviewStartResponseSchema,
  CodexAccountRateLimitsGetResponseSchema,
] as const

export const CODEX_HARNESS_RESPONSE_TYPES = CODEX_HARNESS_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type CodexHarnessClientMessage = z.infer<(typeof CODEX_HARNESS_CLIENT_SCHEMAS)[number]>
export type CodexHarnessServerMessage = z.infer<(typeof CODEX_HARNESS_SERVER_SCHEMAS)[number]>
