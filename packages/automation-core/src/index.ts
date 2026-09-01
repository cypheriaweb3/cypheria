import { chainIdSchema, walletAccountIdSchema, walletIdSchema } from "@cypheria/wallet-core"
import { z } from "zod"

export type AutomationTaskId = `task_${string}`
export type AutomationRunId = `run_${string}`
export type AutomationAuditCorrelationId = `automation_${string}`

export const automationTaskStatuses = ["archived", "draft", "enabled", "paused"] as const
export const automationRunStatuses = [
  "cancelled",
  "failed",
  "queued",
  "running",
  "succeeded",
] as const

export const automationTaskIdSchema = z
  .string()
  .regex(/^task_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
  .transform((value): AutomationTaskId => value as AutomationTaskId)
export const automationRunIdSchema = z
  .string()
  .regex(/^run_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
  .transform((value): AutomationRunId => value as AutomationRunId)
export const automationAuditCorrelationIdSchema = z
  .string()
  .regex(/^automation_[A-Za-z0-9_-]+$/u)
  .transform((value): AutomationAuditCorrelationId => value as AutomationAuditCorrelationId)
export const automationTaskStatusSchema = z.enum(automationTaskStatuses)
export const automationRunStatusSchema = z.enum(automationRunStatuses)

export type AutomationTaskStatus = z.infer<typeof automationTaskStatusSchema>
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>

const isJsonValue = (root: unknown): boolean => {
  const pending = [root]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      continue
    }
    if (!value || typeof value !== "object" || seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    pending.push(...Object.values(value))
  }
  return true
}

const containsSensitiveField = (root: unknown): boolean => {
  const pending = [root]
  while (pending.length > 0) {
    const value = pending.pop()
    if (!value || typeof value !== "object") continue
    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:keystore|mnemonic|password|private[-_]?key|secret|seed)$/iu.test(key)) return true
      pending.push(item)
    }
  }
  return false
}

export const automationJsonValueSchema = z.unknown().refine(isJsonValue, "Invalid JSON value.")

export const automationTaskDefinitionSchema = z
  .object({
    handler: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u),
    input: automationJsonValueSchema.optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (containsSensitiveField(definition.input)) {
      context.addIssue({
        code: "custom",
        message: "Automation definitions must not contain secret material.",
      })
    }
  })

export const automationWorkspaceRefSchema = z
  .object({
    id: z.string().min(1).max(256),
    label: z.string().min(1).max(256).optional(),
    path: z.string().min(1),
  })
  .strict()

export const manualAutomationTriggerSchema = z
  .object({ kind: z.literal("manual"), requestedBy: z.enum(["agent", "system", "user"]) })
  .strict()
export const scheduledAutomationTriggerSchema = z
  .object({
    kind: z.literal("scheduled"),
    nextRunAt: z.iso.datetime().optional(),
    rrule: z.string().min(1).max(2048),
    timezone: z.string().min(1).max(128),
  })
  .strict()
export const agentTriggeredAutomationTriggerSchema = z
  .object({
    codexThreadId: z.string().min(1).max(256).optional(),
    kind: z.literal("agent-triggered"),
    reason: z.string().min(1).max(2048).optional(),
    sourceEventId: z.string().min(1).max(256).optional(),
  })
  .strict()
export const automationTriggerSchema = z.discriminatedUnion("kind", [
  agentTriggeredAutomationTriggerSchema,
  manualAutomationTriggerSchema,
  scheduledAutomationTriggerSchema,
])

export const automationWalletPolicyScopeSchema = z
  .object({
    accountIds: z.array(walletAccountIdSchema),
    chainIds: z.array(chainIdSchema),
    mode: z.enum(["conditional-auto-signing", "human-approval", "read-only"]),
    origins: z
      .array(z.url().refine((value) => new URL(value).origin === value, "Expected an origin URL."))
      .optional(),
    policyIds: z.array(z.string().regex(/^policy_[A-Za-z0-9][A-Za-z0-9_-]*$/u)).optional(),
    walletId: walletIdSchema.optional(),
  })
  .strict()
  .superRefine((scope, context) => {
    const hasDuplicates = (values: readonly unknown[] | undefined): boolean =>
      Boolean(values && new Set(values).size !== values.length)
    for (const values of [scope.accountIds, scope.chainIds, scope.origins, scope.policyIds]) {
      if (hasDuplicates(values)) {
        context.addIssue({ code: "custom", message: "Automation scope values must be unique." })
      }
    }
    if (
      scope.mode !== "read-only" &&
      (!scope.walletId || scope.accountIds.length === 0 || scope.chainIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A signing automation requires explicit wallet, account, and chain scopes.",
      })
    }
  })

export const automationRunLogEntrySchema = z
  .object({
    at: z.iso.datetime(),
    level: z.enum(["debug", "error", "info", "warn"]),
    message: z.string().min(1).max(4096),
  })
  .strict()
export const automationRunErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    recoverable: z.boolean().optional(),
  })
  .strict()

export const automationTaskRunSchema = z
  .object({
    auditCorrelationId: automationAuditCorrelationIdSchema,
    completedAt: z.iso.datetime().optional(),
    error: automationRunErrorSchema.optional(),
    id: automationRunIdSchema,
    logs: z.array(automationRunLogEntrySchema),
    queuedAt: z.iso.datetime(),
    revision: z.number().int().positive(),
    startedAt: z.iso.datetime().optional(),
    status: automationRunStatusSchema,
    taskId: automationTaskIdSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.auditCorrelationId !== createAutomationAuditCorrelationId(run.taskId, run.id)) {
      context.addIssue({ code: "custom", message: "The run audit scope is inconsistent." })
    }
    if (run.status === "queued" && (run.startedAt || run.completedAt || run.error)) {
      context.addIssue({ code: "custom", message: "A queued run cannot be started or completed." })
    }
    if (run.status === "running" && (!run.startedAt || run.completedAt || run.error)) {
      context.addIssue({ code: "custom", message: "A running run requires only a start time." })
    }
    if (["cancelled", "failed", "succeeded"].includes(run.status) && !run.completedAt) {
      context.addIssue({ code: "custom", message: "A terminal run requires a completion time." })
    }
    if (run.status === "failed" ? !run.error : Boolean(run.error)) {
      context.addIssue({ code: "custom", message: "Only a failed run may contain an error." })
    }
  })

export const automationTaskSchema = z
  .object({
    auditCorrelationId: automationAuditCorrelationIdSchema,
    createdAt: z.iso.datetime(),
    definition: automationTaskDefinitionSchema,
    description: z.string().min(1).max(4096).optional(),
    id: automationTaskIdSchema,
    revision: z.number().int().positive(),
    status: automationTaskStatusSchema,
    title: z.string().min(1).max(256),
    trigger: automationTriggerSchema,
    updatedAt: z.iso.datetime(),
    walletPolicyScope: automationWalletPolicyScopeSchema,
    workspace: automationWorkspaceRefSchema,
  })
  .strict()
  .superRefine((task, context) => {
    if (task.auditCorrelationId !== createAutomationAuditCorrelationId(task.id)) {
      context.addIssue({ code: "custom", message: "The task audit scope is inconsistent." })
    }
  })

export const createAutomationTaskInputSchema = z
  .object({
    definition: automationTaskDefinitionSchema,
    description: z.string().min(1).max(4096).optional(),
    status: z.enum(["draft", "enabled"]).optional(),
    title: z.string().min(1).max(256),
    trigger: automationTriggerSchema,
    walletPolicyScope: automationWalletPolicyScopeSchema,
    workspace: automationWorkspaceRefSchema,
  })
  .strict()

export type AutomationTaskDefinition = z.infer<typeof automationTaskDefinitionSchema>
export type AutomationWorkspaceRef = z.infer<typeof automationWorkspaceRefSchema>
export type ManualAutomationTrigger = z.infer<typeof manualAutomationTriggerSchema>
export type ScheduledAutomationTrigger = z.infer<typeof scheduledAutomationTriggerSchema>
export type AgentTriggeredAutomationTrigger = z.infer<typeof agentTriggeredAutomationTriggerSchema>
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>
export type AutomationWalletPolicyScope = z.infer<typeof automationWalletPolicyScopeSchema>
export type AutomationRunLogLevel = z.infer<typeof automationRunLogEntrySchema>["level"]
export type AutomationRunLogEntry = z.infer<typeof automationRunLogEntrySchema>
export type AutomationRunError = z.infer<typeof automationRunErrorSchema>
export type AutomationTaskRun = z.infer<typeof automationTaskRunSchema>
export type AutomationTask = z.infer<typeof automationTaskSchema>
export type CreateAutomationTaskInput = z.input<typeof createAutomationTaskInputSchema>

export const createAutomationAuditCorrelationId = (
  taskId: AutomationTaskId,
  runId?: AutomationRunId
): AutomationAuditCorrelationId => `automation_${taskId}${runId ? `_${runId}` : ""}`

export const isRunnableAutomationTask = (task: Pick<AutomationTask, "status">): boolean =>
  task.status === "enabled"

export const getLatestAutomationRun = (
  runs: readonly AutomationTaskRun[]
): AutomationTaskRun | undefined => runs.at(-1)

export const canTransitionAutomationTask = (
  from: AutomationTaskStatus,
  to: AutomationTaskStatus
): boolean =>
  (from === "draft" && (to === "enabled" || to === "archived")) ||
  (from === "enabled" && (to === "paused" || to === "archived")) ||
  (from === "paused" && (to === "enabled" || to === "archived"))

export const canTransitionAutomationRun = (
  from: AutomationRunStatus,
  to: AutomationRunStatus
): boolean =>
  (from === "queued" && (to === "running" || to === "cancelled")) ||
  (from === "running" && ["cancelled", "failed", "succeeded"].includes(to))

export const createQueuedAutomationRun = (
  task: Pick<AutomationTask, "id">,
  runId: AutomationRunId,
  queuedAt: string
): AutomationTaskRun =>
  automationTaskRunSchema.parse({
    auditCorrelationId: createAutomationAuditCorrelationId(task.id, runId),
    id: runId,
    logs: [{ at: queuedAt, level: "info", message: "Automation run queued." }],
    queuedAt,
    revision: 1,
    status: "queued",
    taskId: task.id,
  }) as AutomationTaskRun
