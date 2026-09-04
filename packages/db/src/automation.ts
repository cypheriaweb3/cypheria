import {
  type AutomationRunStatus,
  type AutomationTask,
  type AutomationTaskRun,
  type AutomationTaskStatus,
  automationRunIdSchema,
  automationTaskIdSchema,
  automationTaskRunSchema,
  automationTaskSchema,
} from "@cypheria/automation-core"
import { and, desc, eq, inArray } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { automationRuns, automationTasks } from "./schema/index.js"

export type AutomationTaskRecord = typeof automationTasks.$inferSelect
export type AutomationRunRecord = typeof automationRuns.$inferSelect

export type ListAutomationTaskOptions = {
  readonly status?: AutomationTaskStatus
}

export type UpdateAutomationTaskStatusInput = {
  readonly expectedRevision: number
  readonly from: readonly AutomationTaskStatus[]
  readonly status: AutomationTaskStatus
  readonly updatedAt: string
}

export type AutomationPersistenceService = {
  readonly createRun: (run: AutomationTaskRun) => Promise<AutomationTaskRun>
  readonly createTask: (task: AutomationTask) => Promise<AutomationTask>
  readonly getRun: (id: string) => Promise<AutomationTaskRun | undefined>
  readonly getTask: (id: string) => Promise<AutomationTask | undefined>
  readonly listRuns: (taskId?: string) => Promise<AutomationTaskRun[]>
  readonly listTasks: (options?: ListAutomationTaskOptions) => Promise<AutomationTask[]>
  readonly updateRun: (
    run: AutomationTaskRun,
    expectedStatus: AutomationRunStatus,
    expectedRevision: number
  ) => Promise<AutomationTaskRun | undefined>
  readonly updateTaskStatus: (
    id: string,
    input: UpdateAutomationTaskStatusInput
  ) => Promise<AutomationTask | undefined>
}

const toTaskRecord = (task: AutomationTask): AutomationTaskRecord => ({
  id: task.id,
  workspace: task.workspace,
  title: task.title,
  description: task.description ?? null,
  trigger: task.trigger,
  definition: task.definition,
  walletPolicyScope: task.walletPolicyScope,
  legacyRunHistory: [],
  status: task.status,
  revision: task.revision,
  auditCorrelationId: task.auditCorrelationId,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
})

const fromTaskRecord = (record: AutomationTaskRecord): AutomationTask =>
  automationTaskSchema.parse({
    id: record.id,
    workspace: record.workspace,
    title: record.title,
    ...(record.description ? { description: record.description } : {}),
    trigger: record.trigger,
    definition: record.definition,
    walletPolicyScope: (() => {
      const legacy = record.walletPolicyScope as typeof record.walletPolicyScope & {
        readonly chainIds?: readonly (number | string)[]
      }
      if (legacy.chainKeys) return legacy
      const { chainIds = [], ...scope } = legacy
      return {
        ...scope,
        chainKeys: chainIds.map((chain) => (typeof chain === "number" ? `eip155:${chain}` : chain)),
      }
    })(),
    status: record.status,
    revision: record.revision,
    auditCorrelationId: record.auditCorrelationId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }) as AutomationTask

const toRunRecord = (run: AutomationTaskRun): AutomationRunRecord => ({
  id: run.id,
  taskId: run.taskId,
  logs: run.logs,
  error: run.error ?? null,
  status: run.status,
  revision: run.revision,
  auditCorrelationId: run.auditCorrelationId,
  queuedAt: run.queuedAt,
  startedAt: run.startedAt ?? null,
  completedAt: run.completedAt ?? null,
})

const fromRunRecord = (record: AutomationRunRecord): AutomationTaskRun =>
  automationTaskRunSchema.parse({
    id: record.id,
    taskId: record.taskId,
    logs: record.logs,
    ...(record.error ? { error: record.error } : {}),
    status: record.status,
    revision: record.revision,
    auditCorrelationId: record.auditCorrelationId,
    queuedAt: record.queuedAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
  }) as AutomationTaskRun

export const createAutomationPersistenceService = (
  db: CypheriaDatabase
): AutomationPersistenceService => ({
  createRun: async (runValue) => {
    const run = automationTaskRunSchema.parse(runValue) as AutomationTaskRun
    await db.insert(automationRuns).values(toRunRecord(run))
    return run
  },
  createTask: async (taskValue) => {
    const task = automationTaskSchema.parse(taskValue) as AutomationTask
    await db.insert(automationTasks).values(toTaskRecord(task))
    return task
  },
  getRun: async (idValue) => {
    const id = automationRunIdSchema.parse(idValue)
    const [record] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .limit(1)
    return record ? fromRunRecord(record) : undefined
  },
  getTask: async (idValue) => {
    const id = automationTaskIdSchema.parse(idValue)
    const [record] = await db
      .select()
      .from(automationTasks)
      .where(eq(automationTasks.id, id))
      .limit(1)
    return record ? fromTaskRecord(record) : undefined
  },
  listRuns: async (taskIdValue) => {
    const taskId = taskIdValue ? automationTaskIdSchema.parse(taskIdValue) : undefined
    const records = taskId
      ? await db
          .select()
          .from(automationRuns)
          .where(eq(automationRuns.taskId, taskId))
          .orderBy(desc(automationRuns.queuedAt), desc(automationRuns.id))
      : await db
          .select()
          .from(automationRuns)
          .orderBy(desc(automationRuns.queuedAt), desc(automationRuns.id))
    return records.map(fromRunRecord)
  },
  listTasks: async (options = {}) => {
    const records = options.status
      ? await db
          .select()
          .from(automationTasks)
          .where(eq(automationTasks.status, options.status))
          .orderBy(desc(automationTasks.updatedAt), desc(automationTasks.id))
      : await db
          .select()
          .from(automationTasks)
          .orderBy(desc(automationTasks.updatedAt), desc(automationTasks.id))
    return records.map(fromTaskRecord)
  },
  updateRun: async (runValue, expectedStatus, expectedRevision) => {
    const run = automationTaskRunSchema.parse(runValue) as AutomationTaskRun
    const [updated] = await db
      .update(automationRuns)
      .set(toRunRecord(run))
      .where(
        and(
          eq(automationRuns.id, run.id),
          eq(automationRuns.status, expectedStatus),
          eq(automationRuns.revision, expectedRevision)
        )
      )
      .returning()
    return updated ? fromRunRecord(updated) : undefined
  },
  updateTaskStatus: async (idValue, input) => {
    const id = automationTaskIdSchema.parse(idValue)
    const [updated] = await db
      .update(automationTasks)
      .set({
        status: input.status,
        revision: input.expectedRevision + 1,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(automationTasks.id, id),
          eq(automationTasks.revision, input.expectedRevision),
          inArray(automationTasks.status, [...input.from])
        )
      )
      .returning()
    return updated ? fromTaskRecord(updated) : undefined
  },
})
