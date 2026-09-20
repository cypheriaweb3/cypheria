import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import { RequestIdSchema } from "./request-id.ts"

export const HarnessSettingValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.number().finite(),
  z.null(),
])
export type HarnessSettingValue = z.infer<typeof HarnessSettingValueSchema>

const SettingBaseSchema = z.object({
  description: z.string().nullable(),
  id: z.string().min(1),
  label: z.string().min(1),
})

export const HarnessSettingDefinitionSchema = z.discriminatedUnion("type", [
  SettingBaseSchema.extend({
    defaultValue: z.string().nullable(),
    options: z.array(
      z
        .object({ description: z.string().nullable(), label: z.string(), value: z.string() })
        .strict()
    ),
    type: z.literal("select"),
    value: z.string().nullable(),
  }).strict(),
  SettingBaseSchema.extend({
    defaultValue: z.boolean(),
    type: z.literal("boolean"),
    value: z.boolean(),
  }).strict(),
  SettingBaseSchema.extend({
    defaultValue: z.number().nullable(),
    max: z.number().nullable(),
    min: z.number().nullable(),
    step: z.number().positive().nullable(),
    type: z.literal("number"),
    value: z.number().nullable(),
  }).strict(),
])
export type HarnessSettingDefinition = z.infer<typeof HarnessSettingDefinitionSchema>

export const HarnessSettingSectionSchema = z
  .object({
    description: z.string().nullable(),
    id: z.string().min(1),
    label: z.string().min(1),
    order: z.number().int(),
    settings: z.array(HarnessSettingDefinitionSchema),
  })
  .strict()
export type HarnessSettingSection = z.infer<typeof HarnessSettingSectionSchema>

export const HarnessThinkingOptionSchema = z
  .object({
    description: z.string().nullable(),
    id: z.string().min(1),
    isDefault: z.boolean(),
    label: z.string().min(1),
  })
  .strict()

export const AgentModelDefinitionSchema = z
  .object({
    agentId: AgentIdSchema,
    aliases: z.array(z.string()),
    contextWindowMaxTokens: z.number().int().positive().nullable(),
    defaultThinkingOptionId: z.string().nullable(),
    description: z.string().nullable(),
    id: z.string().min(1),
    isDefault: z.boolean(),
    isSelectable: z.boolean(),
    label: z.string().min(1),
    metadata: z.record(z.string(), z.json()),
    providerId: z.string().nullable(),
    providerLabel: z.string().nullable(),
    thinkingOptions: z.array(HarnessThinkingOptionSchema),
  })
  .strict()
export type AgentModelDefinition = z.infer<typeof AgentModelDefinitionSchema>

export const HarnessCatalogStatusSchema = z.enum([
  "loading",
  "ready",
  "unavailable",
  "unsupported",
  "error",
])
export const HarnessCatalogSnapshotSchema = z
  .object({
    agentId: AgentIdSchema,
    error: z.string().nullable(),
    fetchedAt: z.string().datetime().nullable(),
    models: z.array(AgentModelDefinitionSchema),
    settingSections: z.array(HarnessSettingSectionSchema),
    stale: z.boolean(),
    status: HarnessCatalogStatusSchema,
  })
  .strict()
export type HarnessCatalogSnapshot = z.infer<typeof HarnessCatalogSnapshotSchema>

export const HarnessAuthMethodSchema = z
  .object({
    description: z.string().nullable(),
    id: z.string().min(1),
    input: z.enum(["none", "secret", "terminal"]),
    label: z.string().min(1),
  })
  .strict()
export type HarnessAuthMethod = z.infer<typeof HarnessAuthMethodSchema>

export const HarnessViewSchema = z
  .object({
    agentId: AgentIdSchema,
    authMethods: z.array(HarnessAuthMethodSchema),
    connected: z.boolean(),
    detail: z.string().nullable(),
    logoutSupported: z.boolean(),
  })
  .strict()
export type HarnessView = z.infer<typeof HarnessViewSchema>

export const HarnessAuthFlowSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("completed") }).strict(),
  z.object({ message: z.string(), state: z.literal("failed") }).strict(),
  z
    .object({
      externalUrl: z.string().url().nullable(),
      flowId: z.string().min(1).nullable(),
      input: z.enum(["none", "text", "secret"]),
      message: z.string().nullable(),
      state: z.literal("pending"),
      terminalId: z.string().uuid().nullable().optional(),
    })
    .strict(),
])
export type HarnessAuthFlow = z.infer<typeof HarnessAuthFlowSchema>

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

const agentPayload = z.object({ agentId: AgentIdSchema }).strict()
const catalogPayload = z
  .object({ agentId: AgentIdSchema, refresh: z.boolean().optional() })
  .strict()

export const HarnessGetRequestSchema = request("harness.get.request", agentPayload)
export const HarnessAuthStartRequestSchema = request(
  "harness.auth.start.request",
  z
    .object({
      agentId: AgentIdSchema,
      methodId: z.string().min(1),
      secret: z.string().min(1).optional(),
    })
    .strict()
)
export const HarnessAuthCancelRequestSchema = request(
  "harness.auth.cancel.request",
  z.object({ agentId: AgentIdSchema, flowId: z.string().min(1) }).strict()
)
export const HarnessAuthRespondRequestSchema = request(
  "harness.auth.respond.request",
  z
    .object({
      agentId: AgentIdSchema,
      flowId: z.string().min(1),
      response: z.string().min(1),
    })
    .strict()
)
export const HarnessAuthLogoutRequestSchema = request("harness.auth.logout.request", agentPayload)
export const HarnessModelsListRequestSchema = request("harness.models.list.request", catalogPayload)
export const HarnessSettingsGetRequestSchema = request(
  "harness.settings.get.request",
  catalogPayload
)
export const HarnessSettingsUpdateRequestSchema = request(
  "harness.settings.update.request",
  z
    .object({
      agentId: AgentIdSchema,
      values: z.record(z.string().min(1), HarnessSettingValueSchema),
    })
    .strict()
)

export const HarnessGetResponseSchema = response("harness.get.response", HarnessViewSchema)
export const HarnessAuthStartResponseSchema = response(
  "harness.auth.start.response",
  HarnessAuthFlowSchema
)
export const HarnessAuthCancelResponseSchema = response(
  "harness.auth.cancel.response",
  z.object({ cancelled: z.boolean() }).strict()
)
export const HarnessAuthRespondResponseSchema = response(
  "harness.auth.respond.response",
  HarnessAuthFlowSchema
)
export const HarnessAuthLogoutResponseSchema = response(
  "harness.auth.logout.response",
  z.object({ succeeded: z.literal(true) }).strict()
)
export const HarnessModelsListResponseSchema = response(
  "harness.models.list.response",
  HarnessCatalogSnapshotSchema
)
export const HarnessSettingsGetResponseSchema = response(
  "harness.settings.get.response",
  HarnessCatalogSnapshotSchema
)
export const HarnessSettingsUpdateResponseSchema = response(
  "harness.settings.update.response",
  HarnessCatalogSnapshotSchema
)

export const HARNESS_CLIENT_SCHEMAS = [
  HarnessGetRequestSchema,
  HarnessAuthStartRequestSchema,
  HarnessAuthCancelRequestSchema,
  HarnessAuthRespondRequestSchema,
  HarnessAuthLogoutRequestSchema,
  HarnessModelsListRequestSchema,
  HarnessSettingsGetRequestSchema,
  HarnessSettingsUpdateRequestSchema,
] as const

export const HARNESS_SERVER_SCHEMAS = [
  HarnessGetResponseSchema,
  HarnessAuthStartResponseSchema,
  HarnessAuthCancelResponseSchema,
  HarnessAuthRespondResponseSchema,
  HarnessAuthLogoutResponseSchema,
  HarnessModelsListResponseSchema,
  HarnessSettingsGetResponseSchema,
  HarnessSettingsUpdateResponseSchema,
] as const

export const HARNESS_RESPONSE_TYPES = HARNESS_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type HarnessClientMessage = z.infer<(typeof HARNESS_CLIENT_SCHEMAS)[number]>
export type HarnessServerMessage = z.infer<(typeof HARNESS_SERVER_SCHEMAS)[number]>
