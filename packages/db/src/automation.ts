import type { AutomationTask, AutomationTaskRun } from "@cypheria/automation-core"
import { desc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { automationRuns, automationTasks } from "./schema.js"

export type AutomationTaskRecord = typeof automationTasks.$inferSelect
export type AutomationRunRecord = typeof automationRuns.$inferSelect

export type AutomationPersistenceService = {
  readonly getRun: (id: string) => Promise<AutomationTaskRun | undefined>
  readonly getTask: (id: string) => Promise<AutomationTask | undefined>
  readonly listRunsForTask: (taskId: string) => Promise<AutomationTaskRun[]>
  readonly saveRun: (run: AutomationTaskRun) => Promise<AutomationTaskRun>
  readonly saveTask: (task: AutomationTask) => Promise<AutomationTask>
}

const stringifyJson = (value: unknown): string => JSON.stringify(value)

const parseJson = <T>(value: string): T => JSON.parse(value) as T

const toTaskRecord = (task: AutomationTask): AutomationTaskRecord => ({
  auditCorrelationId: task.auditCorrelationId,
  createdAt: task.createdAt,
  description: task.description ?? null,
  id: task.id,
  runHistory: stringifyJson(task.runHistory),
  status: task.status,
  title: task.title,
  trigger: stringifyJson(task.trigger),
  updatedAt: task.updatedAt,
  walletPolicyScope: stringifyJson(task.walletPolicyScope),
  workspace: stringifyJson(task.workspace),
})

const fromTaskRecord = (record: AutomationTaskRecord): AutomationTask => ({
  auditCorrelationId: record.auditCorrelationId as AutomationTask["auditCorrelationId"],
  createdAt: record.createdAt,
  description: record.description ?? undefined,
  id: record.id as AutomationTask["id"],
  runHistory: parseJson<AutomationTaskRun[]>(record.runHistory),
  status: record.status as AutomationTask["status"],
  title: record.title,
  trigger: parseJson<AutomationTask["trigger"]>(record.trigger),
  updatedAt: record.updatedAt,
  walletPolicyScope: parseJson<AutomationTask["walletPolicyScope"]>(record.walletPolicyScope),
  workspace: parseJson<AutomationTask["workspace"]>(record.workspace),
})

const toRunRecord = (run: AutomationTaskRun): AutomationRunRecord => ({
  auditCorrelationId: run.auditCorrelationId,
  completedAt: run.completedAt ?? null,
  error: run.error ? stringifyJson(run.error) : null,
  id: run.id,
  logs: stringifyJson(run.logs),
  startedAt: run.startedAt ?? null,
  status: run.status,
  taskId: run.taskId,
})

const fromRunRecord = (record: AutomationRunRecord): AutomationTaskRun => ({
  auditCorrelationId: record.auditCorrelationId as AutomationTaskRun["auditCorrelationId"],
  completedAt: record.completedAt ?? undefined,
  error: record.error ? parseJson<AutomationTaskRun["error"]>(record.error) : undefined,
  id: record.id as AutomationTaskRun["id"],
  logs: parseJson<AutomationTaskRun["logs"]>(record.logs),
  startedAt: record.startedAt ?? undefined,
  status: record.status as AutomationTaskRun["status"],
  taskId: record.taskId as AutomationTaskRun["taskId"],
})

export const createAutomationPersistenceService = (
  db: CypheriaDatabase
): AutomationPersistenceService => ({
  getRun: async (id) => {
    const [record] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .limit(1)
    return record ? fromRunRecord(record) : undefined
  },
  getTask: async (id) => {
    const [record] = await db
      .select()
      .from(automationTasks)
      .where(eq(automationTasks.id, id))
      .limit(1)
    return record ? fromTaskRecord(record) : undefined
  },
  listRunsForTask: async (taskId) => {
    const records = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.taskId, taskId))
      .orderBy(desc(automationRuns.startedAt))
    return records.map(fromRunRecord)
  },
  saveRun: async (run) => {
    await db
      .insert(automationRuns)
      .values(toRunRecord(run))
      .onConflictDoUpdate({
        set: toRunRecord(run),
        target: automationRuns.id,
      })

    return run
  },
  saveTask: async (task) => {
    await db
      .insert(automationTasks)
      .values(toTaskRecord(task))
      .onConflictDoUpdate({
        set: toTaskRecord(task),
        target: automationTasks.id,
      })

    return task
  },
})
