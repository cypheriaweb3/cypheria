import { z } from "zod"

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

export const CodexLoginRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chatgpt") }).strict(),
  z.object({ apiKey: z.string().min(1), type: z.literal("apiKey") }).strict(),
])
export type CodexLoginRequest = z.infer<typeof CodexLoginRequestSchema>

export const CodexLoginResultSchema = z
  .object({
    authUrl: z.url().optional(),
    loginId: z.string().optional(),
    type: z.enum(["apiKey", "chatgpt"]),
  })
  .strict()
export type CodexLoginResult = z.infer<typeof CodexLoginResultSchema>

export const CodexLoginCancelSchema = z.object({ loginId: z.string().min(1) }).strict()

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

export const CodexModelListRequestSchema = z
  .object({ includeHidden: z.boolean().optional() })
  .strict()

export const CodexModelSettingsSchema = z
  .object({
    model: z.string().nullable(),
    provider: CodexNativeProviderSchema,
    reasoningEffort: z.string().nullable(),
    serviceTier: z.string().nullable(),
  })
  .strict()
export type CodexModelSettings = z.infer<typeof CodexModelSettingsSchema>

export const CodexThreadViewSchema = z
  .object({
    cwd: z.string(),
    id: z.string().min(1),
    modelProvider: z.string(),
    projectId: z.string().nullable(),
    sectionId: z.string().nullable(),
    sectionName: z.string().nullable(),
    status: z.enum(["active", "idle", "notLoaded", "systemError"]),
    title: z.string(),
    updatedAt: z.number(),
  })
  .strict()
export type CodexThreadView = z.infer<typeof CodexThreadViewSchema>

export const CodexThreadListPageSchema = z
  .object({
    data: z.array(CodexThreadViewSchema),
    nextCursor: z.string().nullable(),
  })
  .strict()
export type CodexThreadListPage = z.infer<typeof CodexThreadListPageSchema>

export const CodexThreadListRequestSchema = z
  .object({
    archived: z.boolean().optional(),
    cursor: z.string().nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    searchTerm: z.string().optional(),
    sectionId: z.string().nullable().optional(),
  })
  .strict()

export const CodexUiMessageSchema = z
  .object({
    id: z.string().min(1),
    parts: z.array(z.object({ type: z.string().min(1) }).loose()),
    role: z.enum(["system", "user", "assistant"]),
  })
  .loose()

export const CodexChatStartSchema = z
  .object({
    approvalPolicy: z.enum(["untrusted", "on-request", "never"]).default("on-request"),
    chatId: z.string().min(1),
    cwd: z.string().min(1).optional(),
    messages: z.array(CodexUiMessageSchema).min(1),
    model: z.string().min(1),
    provider: CodexNativeProviderSchema,
    requestId: z.uuid(),
    reasoningEffort: z.string().min(1).optional(),
    resumeThreadId: z.string().min(1).optional(),
    sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]),
    serviceTier: z.string().min(1).optional(),
  })
  .strict()
export type CodexChatStart = z.infer<typeof CodexChatStartSchema>

export const CodexChatStartResultSchema = z.object({ requestId: z.string().min(1) }).strict()
export type CodexChatStartResult = z.infer<typeof CodexChatStartResultSchema>

export const CodexChatInterruptSchema = z.object({ requestId: z.string().min(1) }).strict()

export const CodexChatEventSchema = z.discriminatedUnion("type", [
  z.object({ chunk: z.unknown(), requestId: z.string(), type: z.literal("chunk") }).strict(),
  z
    .object({ requestId: z.string(), threadId: z.string().optional(), type: z.literal("done") })
    .strict(),
  z.object({ message: z.string(), requestId: z.string(), type: z.literal("error") }).strict(),
])
export type CodexChatEvent = z.infer<typeof CodexChatEventSchema>

export const CodexInteractionMethodSchema = z.enum([
  "applyPatchApproval",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
])
export type CodexInteractionMethod = z.infer<typeof CodexInteractionMethodSchema>

export const CodexInteractionQuestionSchema = z
  .object({
    header: z.string(),
    id: z.string().min(1),
    isOther: z.boolean(),
    isSecret: z.boolean(),
    options: z.array(z.object({ description: z.string(), label: z.string() }).strict()).nullable(),
    question: z.string(),
  })
  .strict()
export type CodexInteractionQuestion = z.infer<typeof CodexInteractionQuestionSchema>

export const CodexInteractionEventSchema = z
  .object({
    description: z.string().nullable(),
    interactionId: z.uuid(),
    kind: z.enum(["approval", "elicitation", "user-input"]),
    method: CodexInteractionMethodSchema,
    params: z.unknown(),
    questions: z.array(CodexInteractionQuestionSchema).optional(),
    threadId: z.string().nullable(),
    title: z.string(),
    turnId: z.string().nullable(),
  })
  .strict()
export type CodexInteractionEvent = z.infer<typeof CodexInteractionEventSchema>

export const CodexInteractionResponseSchema = z
  .object({
    action: z.enum(["accept", "accept-for-session", "cancel", "decline"]),
    answers: z.record(z.string(), z.array(z.string())).optional(),
    content: z.json().optional(),
    interactionId: z.uuid(),
  })
  .strict()
export type CodexInteractionResponse = z.infer<typeof CodexInteractionResponseSchema>

export const CodexPluginViewSchema = z
  .object({
    availability: z.enum(["AVAILABLE", "DISABLED_BY_ADMIN"]),
    brandColor: z.string().nullable(),
    capabilities: z.array(z.string()),
    category: z.string().nullable(),
    description: z.string().nullable(),
    developerName: z.string().nullable(),
    displayName: z.string(),
    enabled: z.boolean(),
    featured: z.boolean(),
    id: z.string().min(1),
    installed: z.boolean(),
    installPolicy: z.enum(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]),
    logoUrl: z.string().nullable(),
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    name: z.string().min(1),
    sourceType: z.enum(["local", "git", "npm", "remote"]),
    version: z.string().nullable(),
  })
  .strict()
export type CodexPluginView = z.infer<typeof CodexPluginViewSchema>

export const CodexPluginDetailViewSchema = z
  .object({
    description: z.string().nullable(),
    shareUrl: z.string().nullable(),
    prompts: z.array(z.string()),
    websiteUrl: z.string().nullable(),
    privacyPolicyUrl: z.string().nullable(),
    termsOfServiceUrl: z.string().nullable(),
    apps: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          category: z.string().nullable(),
          installUrl: z.string().nullable(),
        })
        .strict()
    ),
    skills: z.array(
      z
        .object({
          name: z.string(),
          description: z.string(),
          enabled: z.boolean(),
          path: z.string().nullable(),
        })
        .strict()
    ),
    mcpServers: z.array(z.string()),
  })
  .strict()
export type CodexPluginDetailView = z.infer<typeof CodexPluginDetailViewSchema>

export const CodexMarketplaceViewSchema = z
  .object({
    catalog: z.enum(["public", "openai", "personal"]),
    displayName: z.string().min(1),
    name: z.string().min(1),
    path: z.string().nullable(),
    plugins: z.array(CodexPluginViewSchema),
  })
  .strict()
export type CodexMarketplaceView = z.infer<typeof CodexMarketplaceViewSchema>

export const CodexPluginListResultSchema = z
  .object({
    errors: z.array(z.object({ message: z.string(), path: z.string() }).strict()),
    marketplaces: z.array(CodexMarketplaceViewSchema),
  })
  .strict()
export type CodexPluginListResult = z.infer<typeof CodexPluginListResultSchema>

export const CodexPluginListRequestSchema = z
  .object({ cwd: z.string().min(1).optional(), forceRefetch: z.boolean().optional() })
  .strict()

export const CodexPluginLocatorSchema = z
  .object({
    marketplaceName: z.string().min(1),
    marketplacePath: z.string().nullable(),
    pluginName: z.string().min(1),
  })
  .strict()
export type CodexPluginLocator = z.infer<typeof CodexPluginLocatorSchema>

export const CodexPluginInstallResultSchema = z
  .object({ appsNeedingAuth: z.array(z.string()), installed: z.literal(true) })
  .strict()
export type CodexPluginInstallResult = z.infer<typeof CodexPluginInstallResultSchema>

export const CodexPluginUninstallRequestSchema = z.object({ pluginId: z.string().min(1) }).strict()
export const CodexPluginEnabledRequestSchema = z
  .object({ enabled: z.boolean(), pluginId: z.string().min(1) })
  .strict()

export const CodexSkillViewSchema = z
  .object({
    brandColor: z.string().nullable(),
    cwd: z.string(),
    dependencyCount: z.number().int().nonnegative(),
    description: z.string(),
    displayName: z.string(),
    enabled: z.boolean(),
    iconUrl: z.string().nullable(),
    name: z.string().min(1),
    path: z.string().min(1),
    pluginId: z.string().nullable(),
    scope: z.enum(["user", "repo", "system", "admin"]),
  })
  .strict()
export type CodexSkillView = z.infer<typeof CodexSkillViewSchema>

export const CodexSkillListResultSchema = z
  .object({
    errors: z.array(z.object({ message: z.string(), path: z.string().nullable() }).strict()),
    skills: z.array(CodexSkillViewSchema),
  })
  .strict()
export type CodexSkillListResult = z.infer<typeof CodexSkillListResultSchema>

export const CodexSkillListRequestSchema = z
  .object({ cwd: z.string().min(1).optional(), forceReload: z.boolean().optional() })
  .strict()
export const CodexSkillEnabledRequestSchema = z
  .object({ enabled: z.boolean(), path: z.string().min(1) })
  .strict()

export const CodexMarketplaceAddRequestSchema = z
  .object({
    refName: z.string().min(1).optional(),
    source: z.string().min(1),
    sparsePaths: z.array(z.string().min(1)).optional(),
  })
  .strict()
export const CodexMarketplaceMutationResultSchema = z
  .object({ marketplaceName: z.string().min(1).nullable(), succeeded: z.literal(true) })
  .strict()
