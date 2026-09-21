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
  "authentication-required",
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

export const HarnessAuthValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])
export type HarnessAuthValue = z.infer<typeof HarnessAuthValueSchema>

export const HarnessAuthFieldSchema = z
  .object({
    defaultValue: HarnessAuthValueSchema.nullable(),
    description: z.string().nullable(),
    hidden: z.boolean(),
    id: z.string().min(1),
    label: z.string().min(1),
    max: z.number().nullable(),
    min: z.number().nullable(),
    options: z.array(
      z
        .object({
          description: z.string().nullable(),
          label: z.string(),
          value: z.string(),
        })
        .strict()
    ),
    placeholder: z.string().nullable(),
    required: z.boolean(),
    type: z.enum(["text", "secret", "number", "integer", "boolean", "multiselect", "external"]),
    url: z.string().url().nullable(),
    when: z.array(
      z
        .object({
          fieldId: z.string().min(1),
          operator: z.enum(["equals", "not-equals"]),
          value: z.union([z.string(), z.number(), z.boolean()]),
        })
        .strict()
    ),
  })
  .strict()
export type HarnessAuthField = z.infer<typeof HarnessAuthFieldSchema>

export const HarnessAuthMethodSchema = z
  .object({
    description: z.string().nullable(),
    fields: z.array(HarnessAuthFieldSchema),
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()
export type HarnessAuthMethod = z.infer<typeof HarnessAuthMethodSchema>

export const HarnessAuthProviderSchema = z
  .object({
    authMethods: z.array(HarnessAuthMethodSchema),
    busy: z.boolean(),
    description: z.string().nullable(),
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()
export type HarnessAuthProvider = z.infer<typeof HarnessAuthProviderSchema>

export const HarnessAuthConnectionSchema = z
  .object({
    detail: z.string().nullable(),
    disconnectSupported: z.boolean(),
    id: z.string().min(1),
    methodId: z.string().nullable(),
    methodLabel: z.string().nullable(),
    providerId: z.string().min(1),
    providerLabel: z.string().min(1),
    source: z.enum(["agent", "environment", "managed", "mixed"]),
    testSupported: z.boolean(),
  })
  .strict()
export type HarnessAuthConnection = z.infer<typeof HarnessAuthConnectionSchema>

export const HarnessViewSchema = z
  .object({
    agentId: AgentIdSchema,
    connections: z.array(HarnessAuthConnectionSchema),
    mode: z.enum(["single", "multiple"]),
    providers: z.array(HarnessAuthProviderSchema),
  })
  .strict()
export type HarnessView = z.infer<typeof HarnessViewSchema>

export const HarnessAuthPromptOptionSchema = z
  .object({
    description: z.string().nullable(),
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict()
export type HarnessAuthPromptOption = z.infer<typeof HarnessAuthPromptOptionSchema>

export const HarnessAuthDeviceCodeSchema = z
  .object({
    expiresInSeconds: z.number().positive().nullable(),
    intervalSeconds: z.number().positive().nullable(),
    userCode: z.string().min(1),
    verificationUri: z.string().url(),
  })
  .strict()
export type HarnessAuthDeviceCode = z.infer<typeof HarnessAuthDeviceCodeSchema>

export const HarnessAuthFlowSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("completed") }).strict(),
  z.object({ message: z.string(), state: z.literal("failed") }).strict(),
  z
    .object({
      deviceCode: HarnessAuthDeviceCodeSchema.nullable(),
      externalUrl: z.string().url().nullable(),
      flowId: z.string().min(1).nullable(),
      input: z.enum(["none", "text", "secret", "select"]),
      inputOptions: z.array(HarnessAuthPromptOptionSchema),
      message: z.string().nullable(),
      placeholder: z.string().nullable(),
      state: z.literal("pending"),
      terminalId: z.string().uuid().nullable(),
    })
    .strict()
    .superRefine((flow, context) => {
      if (flow.input === "select" && flow.inputOptions.length === 0) {
        context.addIssue({ code: "custom", message: "Select prompts require at least one option" })
      }
      if (flow.input !== "select" && flow.inputOptions.length > 0) {
        context.addIssue({ code: "custom", message: "Only select prompts may include options" })
      }
    }),
])
export type HarnessAuthFlow = z.infer<typeof HarnessAuthFlowSchema>

export const HarnessAuthTestResultSchema = z
  .object({
    latencyMs: z.number().int().nonnegative(),
    message: z.string(),
    status: z.enum(["failed", "succeeded", "unsupported"]),
    testedAt: z.string().datetime(),
  })
  .strict()
export type HarnessAuthTestResult = z.infer<typeof HarnessAuthTestResultSchema>

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
      providerId: z.string().min(1),
      values: z.record(z.string(), HarnessAuthValueSchema).optional(),
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
export const HarnessAuthPollRequestSchema = request(
  "harness.auth.poll.request",
  z.object({ agentId: AgentIdSchema, flowId: z.string().min(1) }).strict()
)
export const HarnessAuthLogoutRequestSchema = request(
  "harness.auth.logout.request",
  z.object({ agentId: AgentIdSchema, connectionId: z.string().min(1) }).strict()
)
export const HarnessAuthTestRequestSchema = request(
  "harness.auth.test.request",
  z.object({ agentId: AgentIdSchema, connectionId: z.string().min(1) }).strict()
)
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
export const HarnessAuthPollResponseSchema = response(
  "harness.auth.poll.response",
  HarnessAuthFlowSchema
)
export const HarnessAuthLogoutResponseSchema = response(
  "harness.auth.logout.response",
  z.object({ succeeded: z.literal(true) }).strict()
)
export const HarnessAuthTestResponseSchema = response(
  "harness.auth.test.response",
  HarnessAuthTestResultSchema
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
  HarnessAuthPollRequestSchema,
  HarnessAuthLogoutRequestSchema,
  HarnessAuthTestRequestSchema,
  HarnessModelsListRequestSchema,
  HarnessSettingsGetRequestSchema,
  HarnessSettingsUpdateRequestSchema,
] as const

export const HARNESS_SERVER_SCHEMAS = [
  HarnessGetResponseSchema,
  HarnessAuthStartResponseSchema,
  HarnessAuthCancelResponseSchema,
  HarnessAuthRespondResponseSchema,
  HarnessAuthPollResponseSchema,
  HarnessAuthLogoutResponseSchema,
  HarnessAuthTestResponseSchema,
  HarnessModelsListResponseSchema,
  HarnessSettingsGetResponseSchema,
  HarnessSettingsUpdateResponseSchema,
] as const

export const HARNESS_RESPONSE_TYPES = HARNESS_SERVER_SCHEMAS.map(
  (schema) => schema.shape.type.value
)

export type HarnessClientMessage = z.infer<(typeof HARNESS_CLIENT_SCHEMAS)[number]>
export type HarnessServerMessage = z.infer<(typeof HARNESS_SERVER_SCHEMAS)[number]>
