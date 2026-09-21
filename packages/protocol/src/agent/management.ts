import { z } from "zod"
import { RequestIdSchema } from "../request-id.ts"
import { AgentIdSchema, AgentRegistryEntrySchema } from "./registry.ts"

export const AgentRuntimeScopeSchema = z.enum(["shared", "thread"])
export const AgentRuntimeStateSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "errored",
])
export const AgentIntegritySchema = z.enum(["verified", "unverified", "not-applicable"])
export const AgentDistributionKindSchema = z.enum(["binary", "npx", "uvx"])

export const AgentCapabilitiesSchema = z
  .object({
    apps: z.boolean(),
    mcp: z.boolean(),
    plugins: z.boolean(),
    skills: z.boolean(),
    threads: z.boolean(),
  })
  .strict()
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>

export const AgentDescriptorSchema = z
  .object({
    capabilities: AgentCapabilitiesSchema,
    description: z.string(),
    icon: z.string().nullable(),
    id: AgentIdSchema,
    name: z.string(),
    native: z.boolean(),
  })
  .strict()
export type AgentDescriptor = z.infer<typeof AgentDescriptorSchema>

export const AgentViewSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  version: z.string().min(1),
  description: z.string(),
  repository: z.string().url().nullable(),
  website: z.string().url().nullable(),
  icon: z.string().nullable(),
  native: z.boolean(),
  installed: z.boolean(),
  enabled: z.boolean(),
  available: z.boolean(),
  availableVersion: z.string().nullable(),
  runtimeScope: AgentRuntimeScopeSchema,
  runtimeState: AgentRuntimeStateSchema,
  integrity: AgentIntegritySchema,
  installation: z
    .object({
      kind: AgentDistributionKindSchema,
      source: z.string().min(1),
    })
    .nullable(),
})
export type AgentView = z.infer<typeof AgentViewSchema>

export const AgentCatalogEntrySchema = z.object({
  description: z.string(),
  icon: z.string().nullable(),
  id: AgentIdSchema,
  name: z.string(),
  native: z.boolean(),
  version: z.string().min(1),
})
export type AgentCatalogEntry = z.infer<typeof AgentCatalogEntrySchema>

export const AgentOperationKindSchema = z.enum([
  "install",
  "update",
  "uninstall",
  "toolchain-update",
])
export const AgentOperationStatusSchema = z.enum(["queued", "running", "succeeded", "failed"])
export const ToolchainIdSchema = z.enum(["node", "python", "uv"])
export type ToolchainId = z.infer<typeof ToolchainIdSchema>

export const AgentOperationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ agentId: AgentIdSchema, kind: z.literal("agent") }),
  z.object({ kind: z.literal("toolchain"), toolchain: ToolchainIdSchema }),
])

export const AgentOperationSchema = z.object({
  completedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  id: z.string().min(1),
  kind: AgentOperationKindSchema,
  message: z.string().nullable(),
  progress: z.number().min(0).max(1).nullable(),
  startedAt: z.string().datetime().nullable(),
  status: AgentOperationStatusSchema,
  submittedAt: z.string().datetime(),
  target: AgentOperationTargetSchema,
})
export type AgentOperation = z.infer<typeof AgentOperationSchema>

export const ToolchainViewSchema = z.object({
  activeVersion: z.string().nullable(),
  availableVersion: z.string().nullable(),
  error: z.string().nullable(),
  id: ToolchainIdSchema,
  installedVersions: z.array(z.string()),
  state: z.enum(["missing", "checking", "ready", "updating", "errored"]),
  updateAvailable: z.boolean(),
})
export type ToolchainView = z.infer<typeof ToolchainViewSchema>

export const AgentRegistrySyncStateSchema = z.object({
  error: z.string().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  registryVersion: z.string().nullable(),
  stale: z.boolean(),
})
export type AgentRegistrySyncState = z.infer<typeof AgentRegistrySyncStateSchema>

const agentRequest = <T extends string>(type: T) =>
  z.object({ requestId: RequestIdSchema, type: z.literal(type) })
const agentIdRequest = <T extends string>(type: T) =>
  agentRequest(type).extend({ payload: z.object({ agentId: AgentIdSchema }) })

export const AgentListRequestSchema = agentRequest("agent.list.request")
export const AgentAddRequestSchema = agentIdRequest("agent.add.request")
export const AgentRemoveRequestSchema = agentIdRequest("agent.remove.request")
export const AgentGetRequestSchema = agentIdRequest("agent.get.request")
export const AgentRegistryRefreshRequestSchema = agentRequest("agent.registry.refresh.request")
export const AgentInstallRequestSchema = agentIdRequest("agent.install.request")
export const AgentUpdateRequestSchema = agentIdRequest("agent.update.request")
export const AgentUninstallRequestSchema = agentIdRequest("agent.uninstall.request")
export const AgentStartRequestSchema = agentIdRequest("agent.start.request")
export const AgentStopRequestSchema = agentRequest("agent.stop.request").extend({
  payload: z.object({ agentId: AgentIdSchema, force: z.boolean().default(false) }),
})
export const AgentEnableRequestSchema = agentIdRequest("agent.enable.request")
export const AgentDisableRequestSchema = agentIdRequest("agent.disable.request")
export const AgentOperationGetRequestSchema = agentRequest("agent.operation.get.request").extend({
  payload: z.object({ operationId: z.string().min(1) }),
})
export const AgentOperationListRequestSchema = agentRequest("agent.operation.list.request")
export const AgentToolchainListRequestSchema = agentRequest("agent.toolchain.list.request")
export const AgentToolchainCheckUpdatesRequestSchema = agentRequest(
  "agent.toolchain.check_updates.request"
)
export const AgentToolchainUpdateRequestSchema = agentRequest(
  "agent.toolchain.update.request"
).extend({ payload: z.object({ toolchain: ToolchainIdSchema }) })

const errorSchema = z.object({ code: z.string(), message: z.string() })
const resultPayload = <S extends z.ZodType>(schema: S) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ error: errorSchema, ok: z.literal(false) }),
  ])
const response = <T extends string, S extends z.ZodType>(type: T, schema: S) =>
  z.object({ payload: resultPayload(schema), requestId: RequestIdSchema, type: z.literal(type) })

export const AgentListResponseSchema = response(
  "agent.list.response",
  z.object({
    agents: z.array(AgentViewSchema),
    availableAgents: z.array(AgentCatalogEntrySchema),
    registry: AgentRegistrySyncStateSchema,
  })
)
export const AgentAddResponseSchema = response("agent.add.response", AgentViewSchema)
export const AgentRemoveResponseSchema = response(
  "agent.remove.response",
  z.object({ agentId: AgentIdSchema })
)
export const AgentGetResponseSchema = response("agent.get.response", AgentViewSchema)
export const AgentRegistryRefreshResponseSchema = response(
  "agent.registry.refresh.response",
  AgentRegistrySyncStateSchema
)
export const AgentInstallResponseSchema = response("agent.install.response", AgentOperationSchema)
export const AgentUpdateResponseSchema = response("agent.update.response", AgentOperationSchema)
export const AgentUninstallResponseSchema = response(
  "agent.uninstall.response",
  AgentOperationSchema
)
export const AgentStartResponseSchema = response("agent.start.response", AgentViewSchema)
export const AgentStopResponseSchema = response("agent.stop.response", AgentViewSchema)
export const AgentEnableResponseSchema = response("agent.enable.response", AgentViewSchema)
export const AgentDisableResponseSchema = response("agent.disable.response", AgentViewSchema)
export const AgentOperationGetResponseSchema = response(
  "agent.operation.get.response",
  AgentOperationSchema
)
export const AgentOperationListResponseSchema = response(
  "agent.operation.list.response",
  z.object({ operations: z.array(AgentOperationSchema) })
)
export const AgentToolchainListResponseSchema = response(
  "agent.toolchain.list.response",
  z.object({ toolchains: z.array(ToolchainViewSchema) })
)
export const AgentToolchainCheckUpdatesResponseSchema = response(
  "agent.toolchain.check_updates.response",
  z.object({ toolchains: z.array(ToolchainViewSchema) })
)
export const AgentToolchainUpdateResponseSchema = response(
  "agent.toolchain.update.response",
  AgentOperationSchema
)

export const AgentRegistryUpdatedNotificationSchema = z.object({
  payload: AgentRegistrySyncStateSchema,
  type: z.literal("agent.registry.updated.notification"),
})
export const AgentUpdatedNotificationSchema = z.object({
  payload: AgentViewSchema,
  type: z.literal("agent.updated.notification"),
})
export const AgentOperationProgressNotificationSchema = z.object({
  payload: AgentOperationSchema,
  type: z.literal("agent.operation.progress.notification"),
})
export const AgentOperationCompletedNotificationSchema = z.object({
  payload: AgentOperationSchema,
  type: z.literal("agent.operation.completed.notification"),
})
export const AgentOperationFailedNotificationSchema = z.object({
  payload: AgentOperationSchema,
  type: z.literal("agent.operation.failed.notification"),
})

export const AGENT_MANAGEMENT_CLIENT_SCHEMAS = [
  AgentListRequestSchema,
  AgentAddRequestSchema,
  AgentRemoveRequestSchema,
  AgentGetRequestSchema,
  AgentRegistryRefreshRequestSchema,
  AgentInstallRequestSchema,
  AgentUpdateRequestSchema,
  AgentUninstallRequestSchema,
  AgentStartRequestSchema,
  AgentStopRequestSchema,
  AgentEnableRequestSchema,
  AgentDisableRequestSchema,
  AgentOperationGetRequestSchema,
  AgentOperationListRequestSchema,
  AgentToolchainListRequestSchema,
  AgentToolchainCheckUpdatesRequestSchema,
  AgentToolchainUpdateRequestSchema,
] as const

export const AGENT_MANAGEMENT_SERVER_SCHEMAS = [
  AgentListResponseSchema,
  AgentAddResponseSchema,
  AgentRemoveResponseSchema,
  AgentGetResponseSchema,
  AgentRegistryRefreshResponseSchema,
  AgentInstallResponseSchema,
  AgentUpdateResponseSchema,
  AgentUninstallResponseSchema,
  AgentStartResponseSchema,
  AgentStopResponseSchema,
  AgentEnableResponseSchema,
  AgentDisableResponseSchema,
  AgentOperationGetResponseSchema,
  AgentOperationListResponseSchema,
  AgentToolchainListResponseSchema,
  AgentToolchainCheckUpdatesResponseSchema,
  AgentToolchainUpdateResponseSchema,
  AgentRegistryUpdatedNotificationSchema,
  AgentUpdatedNotificationSchema,
  AgentOperationProgressNotificationSchema,
  AgentOperationCompletedNotificationSchema,
  AgentOperationFailedNotificationSchema,
] as const

export type AgentManagementClientMessage = z.infer<(typeof AGENT_MANAGEMENT_CLIENT_SCHEMAS)[number]>
export type AgentManagementServerMessage = z.infer<(typeof AGENT_MANAGEMENT_SERVER_SCHEMAS)[number]>

export { AgentRegistryEntrySchema }
