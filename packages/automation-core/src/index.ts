import type { ChainId, WalletMode } from "@cypheria/wallet-core"

export type AutomationTaskId = `task_${string}`
export type AutomationRunId = `run_${string}`
export type AutomationAuditCorrelationId = `automation_${string}`

export const automationTaskStatuses = ["archived", "draft", "enabled", "paused"] as const

export type AutomationTaskStatus = (typeof automationTaskStatuses)[number]

export const automationRunStatuses = [
  "cancelled",
  "failed",
  "queued",
  "running",
  "succeeded",
] as const

export type AutomationRunStatus = (typeof automationRunStatuses)[number]

export type AutomationWorkspaceRef = {
  readonly id: string
  readonly label?: string
  readonly path: string
}

export type ManualAutomationTrigger = {
  readonly kind: "manual"
  readonly requestedBy: "agent" | "system" | "user"
}

export type ScheduledAutomationTrigger = {
  readonly kind: "scheduled"
  readonly nextRunAt?: string
  readonly rrule: string
  readonly timezone: string
}

export type AgentTriggeredAutomationTrigger = {
  readonly kind: "agent-triggered"
  readonly codexThreadId?: string
  readonly reason?: string
  readonly sourceEventId?: string
}

export type AutomationTrigger =
  | AgentTriggeredAutomationTrigger
  | ManualAutomationTrigger
  | ScheduledAutomationTrigger

export type AutomationWalletPolicyScope = {
  readonly accountIds: readonly string[]
  readonly chainIds: readonly ChainId[]
  readonly mode: WalletMode
  readonly origins?: readonly string[]
  readonly policyIds?: readonly string[]
  readonly walletId?: string
}

export type AutomationRunLogLevel = "debug" | "error" | "info" | "warn"

export type AutomationRunLogEntry = {
  readonly at: string
  readonly level: AutomationRunLogLevel
  readonly message: string
}

export type AutomationRunError = {
  readonly code: string
  readonly message: string
  readonly recoverable?: boolean
}

export type AutomationTaskRun = {
  readonly auditCorrelationId: AutomationAuditCorrelationId
  readonly completedAt?: string
  readonly error?: AutomationRunError
  readonly id: AutomationRunId
  readonly logs: readonly AutomationRunLogEntry[]
  readonly startedAt?: string
  readonly status: AutomationRunStatus
  readonly taskId: AutomationTaskId
}

export type AutomationTask = {
  readonly auditCorrelationId: AutomationAuditCorrelationId
  readonly createdAt: string
  readonly description?: string
  readonly id: AutomationTaskId
  readonly runHistory: readonly AutomationTaskRun[]
  readonly status: AutomationTaskStatus
  readonly title: string
  readonly trigger: AutomationTrigger
  readonly updatedAt: string
  readonly walletPolicyScope: AutomationWalletPolicyScope
  readonly workspace: AutomationWorkspaceRef
}

export const createAutomationAuditCorrelationId = (
  taskId: AutomationTaskId,
  runId?: AutomationRunId
): AutomationAuditCorrelationId => `automation_${taskId}${runId ? `_${runId}` : ""}`

export const isRunnableAutomationTask = (task: Pick<AutomationTask, "status">): boolean =>
  task.status === "enabled"

export const getLatestAutomationRun = (
  task: Pick<AutomationTask, "runHistory">
): AutomationTaskRun | undefined => task.runHistory.at(-1)

export const createQueuedAutomationRun = (
  task: Pick<AutomationTask, "id">,
  runId: AutomationRunId,
  queuedAt: string
): AutomationTaskRun => ({
  auditCorrelationId: createAutomationAuditCorrelationId(task.id, runId),
  id: runId,
  logs: [{ at: queuedAt, level: "info", message: "Automation run queued." }],
  status: "queued",
  taskId: task.id,
})
