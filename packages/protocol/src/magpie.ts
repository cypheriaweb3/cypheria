import { z } from "zod"

import { AgentIdSchema } from "./agent/registry.ts"
import { RequestIdSchema } from "./request-id.ts"

/**
 * The magpie gateway the Server runs over Cypheria's Agents. The Server
 * installs a pinned magpie release, writes its agents file and drives
 * `magpie web` through its HTTP API; clients see these Cypheria views only.
 */

/** Ports a magpie run by the user takes; Cypheria's never uses them. */
export const MAGPIE_STANDALONE_PORTS = [3425, 3430] as const
export const MAGPIE_DEFAULT_GATEWAY_PORT = 3445
export const MAGPIE_DEFAULT_API_PORT = 3446

const MagpiePortSchema = z
  .int()
  .min(1024)
  .max(65535)
  .refine((port) => !(MAGPIE_STANDALONE_PORTS as readonly number[]).includes(port), {
    message: "The port is a standalone magpie's default",
  })

export const MagpieConfigSchema = z
  .object({
    apiPort: MagpiePortSchema.default(MAGPIE_DEFAULT_API_PORT),
    enabled: z.boolean().default(false),
    gatewayPort: MagpiePortSchema.default(MAGPIE_DEFAULT_GATEWAY_PORT),
  })
  .strict()
  .refine((config) => config.apiPort !== config.gatewayPort, {
    message: "The gateway and API ports must differ",
  })
export type MagpieConfig = z.infer<typeof MagpieConfigSchema>

export const MagpieConfigPatchSchema = z.object({ enabled: z.boolean().optional() }).strict()
export type MagpieConfigPatch = z.infer<typeof MagpieConfigPatchSchema>

export const MagpieServiceStatusSchema = z.enum([
  "missing",
  "installing",
  "stopped",
  "starting",
  "ready",
  "error",
])
export type MagpieServiceStatus = z.infer<typeof MagpieServiceStatusSchema>

export const MagpieServiceViewSchema = z
  .object({
    config: MagpieConfigSchema,
    error: z.string().nullable(),
    /** Where Agents reach the gateway while it is ready. */
    gatewayUrl: z.string().nullable(),
    installedVersion: z.string().nullable(),
    startedAt: z.iso.datetime().nullable(),
    status: MagpieServiceStatusSchema,
    /** The magpie release this Cypheria build pins. */
    version: z.string().min(1),
  })
  .strict()
export type MagpieServiceView = z.infer<typeof MagpieServiceViewSchema>

export const MagpieAgentFieldOptionSchema = z
  .object({
    group: z.string().nullable(),
    label: z.string(),
    note: z.string(),
    value: z.string(),
  })
  .strict()
export type MagpieAgentFieldOption = z.infer<typeof MagpieAgentFieldOptionSchema>

export const MagpieAgentFieldSchema = z
  .object({
    key: z.string().min(1),
    label: z.string(),
    options: z.array(MagpieAgentFieldOptionSchema),
    value: z.string(),
  })
  .strict()
export type MagpieAgentField = z.infer<typeof MagpieAgentFieldSchema>

export const MagpieAgentDriftSchema = z
  .object({
    field: z.string(),
    kind: z.enum(["unwired", "replaced", "bypassed"]),
    now: z.string().nullable(),
  })
  .strict()
export type MagpieAgentDrift = z.infer<typeof MagpieAgentDriftSchema>

export const MagpieAgentViewSchema = z
  .object({
    agentId: AgentIdSchema,
    drift: MagpieAgentDriftSchema.nullable(),
    fields: z.array(MagpieAgentFieldSchema),
    icon: z.string(),
    name: z.string().min(1),
    /** The settings file magpie edits for the Agent. */
    path: z.string(),
  })
  .strict()
export type MagpieAgentView = z.infer<typeof MagpieAgentViewSchema>

export const MagpieProviderViewSchema = z
  .object({
    account: z
      .object({ agentId: AgentIdSchema.nullable(), plan: z.string().nullable(), user: z.string() })
      .strict()
      .nullable(),
    exposedModels: z.int().min(0),
    icon: z.string(),
    id: z.string().min(1),
    kind: z.enum(["subscription", "key"]),
    name: z.string().min(1),
    off: z.boolean(),
    ready: z.boolean(),
  })
  .strict()
export type MagpieProviderView = z.infer<typeof MagpieProviderViewSchema>

export const MagpieGroupViewSchema = z
  .object({
    id: z.string().min(1),
    members: z.array(z.string()),
    name: z.string(),
    ready: z.boolean(),
    routing: z.string().nullable(),
  })
  .strict()
export type MagpieGroupView = z.infer<typeof MagpieGroupViewSchema>

export const MagpieUsagePeriodSchema = z.enum(["today", "7d", "30d", "all"])
export type MagpieUsagePeriod = z.infer<typeof MagpieUsagePeriodSchema>

const MagpieUsageTotalsSchema = z
  .object({
    calls: z.int().min(0),
    costUsd: z.number().min(0),
    errors: z.int().min(0),
    inputTokens: z.int().min(0),
    outputTokens: z.int().min(0),
  })
  .strict()

export const MagpieUsageSummarySchema = z
  .object({
    byAgent: z.array(MagpieUsageTotalsSchema.extend({ id: z.string(), name: z.string() }).strict()),
    byModel: z.array(
      MagpieUsageTotalsSchema.extend({ model: z.string(), provider: z.string() }).strict()
    ),
    period: MagpieUsagePeriodSchema,
    totals: MagpieUsageTotalsSchema,
  })
  .strict()
export type MagpieUsageSummary = z.infer<typeof MagpieUsageSummarySchema>

const request = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ payload, requestId: RequestIdSchema, type: z.literal(type) }).strict()
const errorSchema = z.object({ code: z.string().min(1), message: z.string().min(1) })
const resultSchema = <S extends z.ZodType>(schema: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ error: errorSchema, ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({ payload: resultSchema(value), requestId: RequestIdSchema, type: z.literal(type) })
    .strict()
const empty = z.object({}).strict()
const agentsValue = z.object({ agents: z.array(MagpieAgentViewSchema) }).strict()

export const MagpieStatusGetRequestSchema = request("magpie.status.get.request", empty)
export const MagpieInstallRequestSchema = request("magpie.install.request", empty)
export const MagpieConfigSetRequestSchema = request(
  "magpie.config.set.request",
  z.object({ patch: MagpieConfigPatchSchema }).strict()
)
export const MagpieRestartRequestSchema = request("magpie.restart.request", empty)
export const MagpieAgentsListRequestSchema = request("magpie.agents.list.request", empty)
export const MagpieAgentSetRequestSchema = request(
  "magpie.agent.set.request",
  z.object({ agentId: AgentIdSchema, field: z.string().min(1), value: z.string() }).strict()
)
export const MagpieAgentReapplyRequestSchema = request(
  "magpie.agent.reapply.request",
  z.object({ agentId: AgentIdSchema }).strict()
)
export const MagpieProvidersListRequestSchema = request("magpie.providers.list.request", empty)
export const MagpieGroupsListRequestSchema = request("magpie.groups.list.request", empty)
export const MagpieUsageGetRequestSchema = request(
  "magpie.usage.get.request",
  z.object({ period: MagpieUsagePeriodSchema }).strict()
)

export const MagpieStatusGetResponseSchema = response(
  "magpie.status.get.response",
  MagpieServiceViewSchema
)
export const MagpieInstallResponseSchema = response(
  "magpie.install.response",
  MagpieServiceViewSchema
)
export const MagpieConfigSetResponseSchema = response(
  "magpie.config.set.response",
  MagpieServiceViewSchema
)
export const MagpieRestartResponseSchema = response(
  "magpie.restart.response",
  MagpieServiceViewSchema
)
export const MagpieAgentsListResponseSchema = response("magpie.agents.list.response", agentsValue)
export const MagpieAgentSetResponseSchema = response("magpie.agent.set.response", agentsValue)
export const MagpieAgentReapplyResponseSchema = response(
  "magpie.agent.reapply.response",
  agentsValue
)
export const MagpieProvidersListResponseSchema = response(
  "magpie.providers.list.response",
  z.object({ providers: z.array(MagpieProviderViewSchema) }).strict()
)
export const MagpieGroupsListResponseSchema = response(
  "magpie.groups.list.response",
  z.object({ groups: z.array(MagpieGroupViewSchema) }).strict()
)
export const MagpieUsageGetResponseSchema = response(
  "magpie.usage.get.response",
  MagpieUsageSummarySchema
)

export const MagpieStatusChangedNotificationSchema = z
  .object({
    payload: MagpieServiceViewSchema,
    type: z.literal("magpie.status.changed.notification"),
  })
  .strict()
export type MagpieStatusChangedNotification = z.infer<typeof MagpieStatusChangedNotificationSchema>

export const MAGPIE_CLIENT_SCHEMAS = [
  MagpieStatusGetRequestSchema,
  MagpieInstallRequestSchema,
  MagpieConfigSetRequestSchema,
  MagpieRestartRequestSchema,
  MagpieAgentsListRequestSchema,
  MagpieAgentSetRequestSchema,
  MagpieAgentReapplyRequestSchema,
  MagpieProvidersListRequestSchema,
  MagpieGroupsListRequestSchema,
  MagpieUsageGetRequestSchema,
] as const

export const MAGPIE_SERVER_SCHEMAS = [
  MagpieStatusGetResponseSchema,
  MagpieInstallResponseSchema,
  MagpieConfigSetResponseSchema,
  MagpieRestartResponseSchema,
  MagpieAgentsListResponseSchema,
  MagpieAgentSetResponseSchema,
  MagpieAgentReapplyResponseSchema,
  MagpieProvidersListResponseSchema,
  MagpieGroupsListResponseSchema,
  MagpieUsageGetResponseSchema,
  MagpieStatusChangedNotificationSchema,
] as const

export const MAGPIE_RESPONSE_TYPES = MAGPIE_SERVER_SCHEMAS.flatMap((schema) => {
  const type = schema.shape.type.value
  return type.endsWith(".response") ? [type] : []
})

export type MagpieClientMessage = z.infer<(typeof MAGPIE_CLIENT_SCHEMAS)[number]>
export type MagpieServerMessage = z.infer<(typeof MAGPIE_SERVER_SCHEMAS)[number]>
