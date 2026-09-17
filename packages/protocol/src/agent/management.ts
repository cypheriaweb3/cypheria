import { z } from "zod"
import { RequestIdSchema } from "../request-id.ts"
import { AgentIdSchema, AgentRegistryEntrySchema } from "./registry.ts"

export const AgentRunScopeSchema = z.enum(["shared", "session"])
export const AgentRuntimeStateSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "errored",
])
export const AgentIntegritySchema = z.enum(["verified", "unverified", "not-applicable"])

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
  runScope: AgentRunScopeSchema,
  runtimeState: AgentRuntimeStateSchema,
  integrity: AgentIntegritySchema,
})
export type AgentView = z.infer<typeof AgentViewSchema>

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
  unsupportedIds: z.array(z.string()),
})
export type AgentRegistrySyncState = z.infer<typeof AgentRegistrySyncStateSchema>

const agentRequest = <T extends string>(type: T) =>
  z.object({ requestId: RequestIdSchema, type: z.literal(type) })
const agentIdRequest = <T extends string>(type: T) =>
  agentRequest(type).extend({ payload: z.object({ agentId: AgentIdSchema }) })

export const AgentRegistryListRequestSchema = agentRequest("agent.registry.list.request")
export const AgentRegistryGetRequestSchema = agentIdRequest("agent.registry.get.request")
export const AgentRegistryRefreshRequestSchema = agentRequest("agent.registry.refresh.request")
export const AgentInstallRequestSchema = agentIdRequest("agent.install.request")
export const AgentUpdateRequestSchema = agentIdRequest("agent.update.request")
export const AgentUninstallRequestSchema = agentIdRequest("agent.uninstall.request")
export const AgentStartRequestSchema = agentIdRequest("agent.start.request")
export const AgentStopRequestSchema = agentIdRequest("agent.stop.request")
export const AgentEnabledSetRequestSchema = agentRequest("agent.enabled.set.request").extend({
  payload: z.object({ agentId: AgentIdSchema, enabled: z.boolean() }),
})
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

export const AgentRegistryListResponseSchema = response(
  "agent.registry.list.response",
  z.object({ agents: z.array(AgentViewSchema), registry: AgentRegistrySyncStateSchema })
)
export const AgentRegistryGetResponseSchema = response(
  "agent.registry.get.response",
  AgentViewSchema
)
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
export const AgentEnabledSetResponseSchema = response("agent.enabled.set.response", AgentViewSchema)
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
export const AgentStateNotificationSchema = z.object({
  payload: AgentViewSchema,
  type: z.literal("agent.state.notification"),
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
  AgentRegistryListRequestSchema,
  AgentRegistryGetRequestSchema,
  AgentRegistryRefreshRequestSchema,
  AgentInstallRequestSchema,
  AgentUpdateRequestSchema,
  AgentUninstallRequestSchema,
  AgentStartRequestSchema,
  AgentStopRequestSchema,
  AgentEnabledSetRequestSchema,
  AgentOperationGetRequestSchema,
  AgentOperationListRequestSchema,
  AgentToolchainListRequestSchema,
  AgentToolchainCheckUpdatesRequestSchema,
  AgentToolchainUpdateRequestSchema,
] as const

export const AGENT_MANAGEMENT_SERVER_SCHEMAS = [
  AgentRegistryListResponseSchema,
  AgentRegistryGetResponseSchema,
  AgentRegistryRefreshResponseSchema,
  AgentInstallResponseSchema,
  AgentUpdateResponseSchema,
  AgentUninstallResponseSchema,
  AgentStartResponseSchema,
  AgentStopResponseSchema,
  AgentEnabledSetResponseSchema,
  AgentOperationGetResponseSchema,
  AgentOperationListResponseSchema,
  AgentToolchainListResponseSchema,
  AgentToolchainCheckUpdatesResponseSchema,
  AgentToolchainUpdateResponseSchema,
  AgentRegistryUpdatedNotificationSchema,
  AgentStateNotificationSchema,
  AgentOperationProgressNotificationSchema,
  AgentOperationCompletedNotificationSchema,
  AgentOperationFailedNotificationSchema,
] as const

export type AgentManagementClientMessage = z.infer<(typeof AGENT_MANAGEMENT_CLIENT_SCHEMAS)[number]>
export type AgentManagementServerMessage = z.infer<(typeof AGENT_MANAGEMENT_SERVER_SCHEMAS)[number]>

export { AgentRegistryEntrySchema }
