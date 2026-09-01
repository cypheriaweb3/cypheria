import {
  type AutomationRunStatus,
  type AutomationTask,
  type AutomationTaskRun,
  type AutomationTaskStatus,
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

const stringifyJson = (value: unknown): string => JSON.stringify(value)
const parseJson = (value: string): unknown => JSON.parse(value) as unknown

const toTaskRecord = (task: AutomationTask): AutomationTaskRecord => ({
  auditCorrelationId: task.auditCorrelationId,
  createdAt: task.createdAt,
  definition: stringifyJson(task.definition),
  description: task.description ?? null,
  id: task.id,
  legacyRunHistory: "[]",
  revision: task.revision,
  status: task.status,
  title: task.title,
  trigger: stringifyJson(task.trigger),
  updatedAt: task.updatedAt,
  walletPolicyScope: stringifyJson(task.walletPolicyScope),
  workspace: stringifyJson(task.workspace),
})

const fromTaskRecord = (record: AutomationTaskRecord): AutomationTask =>
  automationTaskSchema.parse({
    auditCorrelationId: record.auditCorrelationId,
    createdAt: record.createdAt,
    definition: parseJson(record.definition),
    ...(record.description ? { description: record.description } : {}),
    id: record.id,
    revision: record.revision,
    status: record.status,
    title: record.title,
    trigger: parseJson(record.trigger),
    updatedAt: record.updatedAt,
    walletPolicyScope: parseJson(record.walletPolicyScope),
    workspace: parseJson(record.workspace),
  }) as AutomationTask

const toRunRecord = (run: AutomationTaskRun): AutomationRunRecord => ({
  auditCorrelationId: run.auditCorrelationId,
  completedAt: run.completedAt ?? null,
  error: run.error ? stringifyJson(run.error) : null,
  id: run.id,
  logs: stringifyJson(run.logs),
  queuedAt: run.queuedAt,
  revision: run.revision,
  startedAt: run.startedAt ?? null,
  status: run.status,
  taskId: run.taskId,
})

const fromRunRecord = (record: AutomationRunRecord): AutomationTaskRun =>
  automationTaskRunSchema.parse({
    auditCorrelationId: record.auditCorrelationId,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.error ? { error: parseJson(record.error) } : {}),
    id: record.id,
    logs: parseJson(record.logs),
    queuedAt: record.queuedAt,
    revision: record.revision,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    status: record.status,
    taskId: record.taskId,
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
  listRuns: async (taskId) => {
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
  updateTaskStatus: async (id, input) => {
    const [updated] = await db
      .update(automationTasks)
      .set({
        revision: input.expectedRevision + 1,
        status: input.status,
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
