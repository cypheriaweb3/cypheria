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
  z.object({ type: z.literal("chatgptDeviceCode") }).strict(),
  z.object({ apiKey: z.string().min(1), type: z.literal("apiKey") }).strict(),
  z
    .object({
      apiKey: z.string().min(1),
      region: z.string().min(1),
      type: z.literal("amazonBedrock"),
    })
    .strict(),
  z
    .object({
      accessKeyId: z.string().min(1),
      region: z.string().min(1),
      secretAccessKey: z.string().min(1),
      sessionToken: z.string().min(1).optional(),
      type: z.literal("amazonBedrockAccessKeys"),
    })
    .strict(),
])
export type CodexLoginRequest = z.infer<typeof CodexLoginRequestSchema>

export const CodexLoginResultSchema = z
  .object({
    authUrl: z.url().optional(),
    loginId: z.string().optional(),
    type: z.enum(["apiKey", "chatgpt", "chatgptDeviceCode", "amazonBedrock"]),
    userCode: z.string().optional(),
    verificationUrl: z.url().optional(),
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
    status: z.enum(["active", "idle", "notLoaded", "systemError"]),
    title: z.string(),
    updatedAt: z.number(),
  })
  .strict()
export type CodexThreadView = z.infer<typeof CodexThreadViewSchema>

export const CodexThreadListRequestSchema = z
  .object({ archived: z.boolean().optional(), searchTerm: z.string().optional() })
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
