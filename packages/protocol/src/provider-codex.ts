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

export const CodexAccountGetRequestSchema = request(
  "provider.codex.account.get.request",
  z.object({ refresh: z.boolean().optional() }).strict()
)
export const CodexAccountLoginRequestSchema = request(
  "provider.codex.account.login.request",
  CodexLoginInputSchema
)
export const CodexAccountLoginCancelRequestSchema = request(
  "provider.codex.account.login.cancel.request",
  z.object({ loginId: z.string().min(1) }).strict()
)
export const CodexAccountLogoutRequestSchema = request(
  "provider.codex.account.logout.request",
  z.object({}).strict()
)
export const CodexModelListRequestSchema = request(
  "provider.codex.model.list.request",
  z.object({ includeHidden: z.boolean().optional() }).strict()
)
export const CodexModelSettingsGetRequestSchema = request(
  "provider.codex.model-settings.get.request",
  z.object({}).strict()
)
export const CodexModelSettingsSetRequestSchema = request(
  "provider.codex.model-settings.set.request",
  CodexModelSettingsSchema
)

export const CodexAccountGetResponseSchema = response(
  "provider.codex.account.get.response",
  CodexAccountViewSchema
)
export const CodexAccountLoginResponseSchema = response(
  "provider.codex.account.login.response",
  CodexLoginResultSchema
)
export const CodexAccountLoginCancelResponseSchema = response(
  "provider.codex.account.login.cancel.response",
  z.object({ cancelled: z.boolean() }).strict()
)
export const CodexAccountLogoutResponseSchema = response(
  "provider.codex.account.logout.response",
  succeeded
)
export const CodexModelListResponseSchema = response(
  "provider.codex.model.list.response",
  z.object({ models: z.array(CodexModelViewSchema) }).strict()
)
export const CodexModelSettingsGetResponseSchema = response(
  "provider.codex.model-settings.get.response",
  CodexModelSettingsSchema
)
export const CodexModelSettingsSetResponseSchema = response(
  "provider.codex.model-settings.set.response",
  CodexModelSettingsSchema
)

export const CODEX_PROVIDER_CLIENT_SCHEMAS = [
  CodexAccountGetRequestSchema,
  CodexAccountLoginRequestSchema,
  CodexAccountLoginCancelRequestSchema,
  CodexAccountLogoutRequestSchema,
  CodexModelListRequestSchema,
  CodexModelSettingsGetRequestSchema,
  CodexModelSettingsSetRequestSchema,
] as const

export const CODEX_PROVIDER_SERVER_SCHEMAS = [
  CodexAccountGetResponseSchema,
  CodexAccountLoginResponseSchema,
  CodexAccountLoginCancelResponseSchema,
  CodexAccountLogoutResponseSchema,
  CodexModelListResponseSchema,
  CodexModelSettingsGetResponseSchema,
  CodexModelSettingsSetResponseSchema,
] as const

export const CODEX_PROVIDER_RESPONSE_TYPES = CODEX_PROVIDER_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type CodexProviderClientMessage = z.infer<(typeof CODEX_PROVIDER_CLIENT_SCHEMAS)[number]>
export type CodexProviderServerMessage = z.infer<(typeof CODEX_PROVIDER_SERVER_SCHEMAS)[number]>
