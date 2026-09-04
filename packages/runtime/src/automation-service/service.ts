import { randomUUID } from "node:crypto"

import {
  type AutomationRunId,
  type AutomationRunLogEntry,
  type AutomationTask,
  type AutomationTaskId,
  type AutomationTaskRun,
  type AutomationTaskStatus,
  automationRunIdSchema,
  automationTaskIdSchema,
  automationTaskRunSchema,
  automationTaskSchema,
  automationTaskStatusSchema,
  canTransitionAutomationTask,
  createAutomationAuditCorrelationId,
  createAutomationTaskInputSchema,
  createQueuedAutomationRun,
  isRunnableAutomationTask,
} from "@cypheria/automation-core"
import type {
  AuditLogService,
  AutomationPersistenceService,
  SigningIntentRecord,
} from "@cypheria/db"
import { chainKeySchema } from "@cypheria/network-core"
import { z } from "zod"

import type { RuntimeService } from "../index.js"
import type {
  CreateSigningIntentInput,
  SigningIntentRuntimeService,
} from "../signing-intent-service/index.js"

const listTasksInputSchema = z.object({ status: automationTaskStatusSchema.optional() }).strict()
const taskIdInputSchema = z.object({ taskId: automationTaskIdSchema }).strict()
const runIdInputSchema = z.object({ runId: automationRunIdSchema }).strict()
const transitionInputSchema = taskIdInputSchema
  .extend({ expectedRevision: z.number().int().positive().optional() })
  .strict()
const listRunsInputSchema = z.object({ taskId: automationTaskIdSchema.optional() }).strict()
const agentRequestSchema = z.object({ prompt: z.string().min(1).max(100_000) }).strict()

export type CreateAutomationTaskInput = z.input<typeof createAutomationTaskInputSchema>

export type AutomationTaskView = {
  readonly runs: readonly AutomationTaskRun[]
  readonly task: AutomationTask
}

export type AutomationAgentRequest = {
  readonly auditCorrelationId: string
  readonly prompt: string
  readonly signal: AbortSignal
  readonly workspace: AutomationTask["workspace"]
}

export type AutomationAgentRunner = (request: AutomationAgentRequest) => Promise<unknown>

export type AutomationExecutionCapabilities = {
  readonly createSigningIntent: (
    input: Omit<CreateSigningIntentInput, "mode" | "policyIds" | "source">
  ) => Promise<SigningIntentRecord>
  readonly runAgent: (input: { readonly prompt: string }) => Promise<unknown>
}

export type AutomationTaskExecutorInput = {
  readonly capabilities: AutomationExecutionCapabilities
  readonly runId: AutomationRunId
  readonly signal: AbortSignal
  readonly task: AutomationTask
}

export type AutomationTaskExecutorResult = {
  readonly logs?: readonly AutomationRunLogEntry[]
}

export type AutomationTaskExecutor = (
  input: AutomationTaskExecutorInput
) => Promise<AutomationTaskExecutorResult> | AutomationTaskExecutorResult

export type AutomationRuntimeIdFactory = {
  readonly runId: () => AutomationRunId
  readonly taskId: () => AutomationTaskId
}

export type AutomationRuntimeServiceOptions = {
  readonly agentRunner?: AutomationAgentRunner
  readonly audit: Pick<AuditLogService, "append">
  readonly executors?: Readonly<Record<string, AutomationTaskExecutor>>
  readonly idFactory?: AutomationRuntimeIdFactory
  readonly now?: () => string
  readonly persistence: AutomationPersistenceService
  readonly signingIntents?: Pick<SigningIntentRuntimeService, "create">
}

export type AutomationRuntimeService = RuntimeService & {
  readonly createTask: (input: CreateAutomationTaskInput) => Promise<AutomationTask>
  readonly getRun: (runId: string) => Promise<AutomationTaskRun | undefined>
  readonly getTask: (taskId: string) => Promise<AutomationTaskView | undefined>
  readonly listRuns: (taskId?: string) => Promise<AutomationTaskRun[]>
  readonly listTasks: (status?: AutomationTaskStatus) => Promise<AutomationTask[]>
  readonly pauseTask: (taskId: string, expectedRevision?: number) => Promise<AutomationTask>
  readonly resumeTask: (taskId: string, expectedRevision?: number) => Promise<AutomationTask>
  readonly runTask: (taskId: string) => Promise<AutomationTaskRun>
}

export type AutomationRuntimeErrorCode =
  | "ACTIVE_RUN_EXISTS"
  | "AGENT_UNAVAILABLE"
  | "CONFLICT"
  | "EXECUTOR_NOT_FOUND"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "SIGNING_FORBIDDEN"
  | "SIGNING_UNAVAILABLE"
  | "TASK_NOT_RUNNABLE"

export class AutomationRuntimeError extends Error {
  readonly code: AutomationRuntimeErrorCode

  constructor(code: AutomationRuntimeErrorCode, message: string) {
    super(message)
    this.name = "AutomationRuntimeError"
    this.code = code
  }
}

const defaultIdFactory: AutomationRuntimeIdFactory = {
  runId: () => `run_${randomUUID()}`,
  taskId: () => `task_${randomUUID()}`,
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value)
  } catch {
    throw new AutomationRuntimeError("INVALID_INPUT", "The automation input is invalid.")
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof AutomationRuntimeError ? error.message : "Automation execution failed."

export const createAutomationRuntimeService = (
  options: AutomationRuntimeServiceOptions
): AutomationRuntimeService => {
  const idFactory = options.idFactory ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())
  const activeRuns = new Map<AutomationRunId, AbortController>()
  const activeExecutions = new Set<Promise<AutomationTaskRun>>()
  const executors = new Map<string, AutomationTaskExecutor>([
    ["noop", () => ({ logs: [] })],
    [
      "codex",
      async ({ capabilities, task }) => {
        await capabilities.runAgent(parse(agentRequestSchema, task.definition.input))
        return { logs: [] }
      },
    ],
    ...Object.entries(options.executors ?? {}),
  ])

  const audit = async (eventType: string, task: AutomationTask, run?: AutomationTaskRun) => {
    await options.audit.append({
      actor: "automation",
      correlationId: run?.auditCorrelationId ?? task.auditCorrelationId,
      createdAt: now(),
      eventType,
      payloadSummary: run
        ? `${eventType} ${run.id} for ${task.id}: ${run.status}.`
        : `${eventType} ${task.id}: ${task.status}.`,
      source: "runtime.automation-service",
    })
  }

  const findTask = async (taskIdValue: string): Promise<AutomationTask> => {
    const taskId = parse(automationTaskIdSchema, taskIdValue)
    const task = await options.persistence.getTask(taskId)
    if (!task) throw new AutomationRuntimeError("NOT_FOUND", "The automation task does not exist.")
    return task
  }

  const transitionTask = async (
    taskIdValue: string,
    status: "enabled" | "paused",
    expectedRevision?: number
  ): Promise<AutomationTask> => {
    const task = await findTask(taskIdValue)
    if (!canTransitionAutomationTask(task.status, status)) {
      throw new AutomationRuntimeError(
        "CONFLICT",
        `The automation task cannot transition from ${task.status} to ${status}.`
      )
    }
    const updated = await options.persistence.updateTaskStatus(task.id, {
      expectedRevision: expectedRevision ?? task.revision,
      from: [task.status],
      status,
      updatedAt: now(),
    })
    if (!updated) {
      throw new AutomationRuntimeError("CONFLICT", "The automation task changed concurrently.")
    }
    await audit(`automation.task.${status === "enabled" ? "resumed" : "paused"}`, updated)
    return updated
  }

  const createCapabilities = (
    task: AutomationTask,
    run: AutomationTaskRun,
    signal: AbortSignal
  ): AutomationExecutionCapabilities => ({
    createSigningIntent: async (input) => {
      if (task.walletPolicyScope.mode === "read-only") {
        throw new AutomationRuntimeError(
          "SIGNING_FORBIDDEN",
          "A read-only automation task cannot create signing intents."
        )
      }
      if (!options.signingIntents) {
        throw new AutomationRuntimeError(
          "SIGNING_UNAVAILABLE",
          "The signing-intent service is unavailable."
        )
      }
      const account = input.intent.account
      const scope = task.walletPolicyScope
      if (
        (scope.walletId && scope.walletId !== account.walletId) ||
        (scope.accountIds.length > 0 &&
          !scope.accountIds.some((accountId) => accountId === account.walletAccountId)) ||
        (scope.chainKeys.length > 0 &&
          !scope.chainKeys.includes(chainKeySchema.parse(account.chainKey))) ||
        (input.intent.origin && !scope.origins?.includes(input.intent.origin))
      ) {
        throw new AutomationRuntimeError(
          "SIGNING_FORBIDDEN",
          "The signing intent exceeds the automation wallet policy scope."
        )
      }
      return options.signingIntents.create({
        ...input,
        intent: { ...input.intent, correlationId: run.auditCorrelationId },
        mode: scope.mode,
        ...(scope.policyIds ? { policyIds: scope.policyIds } : {}),
        source: "automation",
      })
    },
    runAgent: async (input) => {
      if (!options.agentRunner) {
        throw new AutomationRuntimeError(
          "AGENT_UNAVAILABLE",
          "The Codex agent runner is unavailable."
        )
      }
      const request = parse(agentRequestSchema, input)
      return options.agentRunner({
        auditCorrelationId: run.auditCorrelationId,
        prompt: request.prompt,
        signal,
        workspace: task.workspace,
      })
    },
  })

  const service: AutomationRuntimeService = {
    createTask: async (inputValue) => {
      const input = parse(createAutomationTaskInputSchema, inputValue)
      const taskId = idFactory.taskId()
      const createdAt = now()
      const task = parse(automationTaskSchema, {
        ...input,
        auditCorrelationId: createAutomationAuditCorrelationId(taskId),
        createdAt,
        id: taskId,
        revision: 1,
        status: input.status ?? "draft",
        updatedAt: createdAt,
      })
      const created = await options.persistence.createTask(task)
      await audit("automation.task.created", created)
      return created
    },
    getRun: (runId) => options.persistence.getRun(parse(automationRunIdSchema, runId)),
    getTask: async (taskId) => {
      const task = await options.persistence.getTask(parse(automationTaskIdSchema, taskId))
      return task ? { runs: await options.persistence.listRuns(task.id), task } : undefined
    },
    handlers: [
      {
        handler: (input) => service.createTask(parse(createAutomationTaskInputSchema, input)),
        method: "automation.task.create",
      },
      {
        handler: (input) => {
          const parsed = parse(listTasksInputSchema, input ?? {})
          return service.listTasks(parsed.status)
        },
        method: "automation.task.list",
      },
      {
        handler: (input) => service.getTask(parse(taskIdInputSchema, input).taskId),
        method: "automation.task.get",
      },
      {
        handler: (input) => {
          const parsed = parse(transitionInputSchema, input)
          return service.pauseTask(parsed.taskId, parsed.expectedRevision)
        },
        method: "automation.task.pause",
      },
      {
        handler: (input) => {
          const parsed = parse(transitionInputSchema, input)
          return service.resumeTask(parsed.taskId, parsed.expectedRevision)
        },
        method: "automation.task.resume",
      },
      {
        handler: (input) => service.runTask(parse(taskIdInputSchema, input).taskId),
        method: "automation.run.start",
      },
      {
        handler: (input) => service.getRun(parse(runIdInputSchema, input).runId),
        method: "automation.run.get",
      },
      {
        handler: (input) => {
          const parsed = parse(listRunsInputSchema, input ?? {})
          return service.listRuns(parsed.taskId)
        },
        method: "automation.run.list",
      },
    ],
    listRuns: (taskId) =>
      options.persistence.listRuns(taskId ? parse(automationTaskIdSchema, taskId) : undefined),
    listTasks: (status) =>
      options.persistence.listTasks({
        ...(status ? { status: parse(automationTaskStatusSchema, status) } : {}),
      }),
    name: "automation",
    namespace: "automation",
    pauseTask: (taskId, expectedRevision) => transitionTask(taskId, "paused", expectedRevision),
    resumeTask: (taskId, expectedRevision) => transitionTask(taskId, "enabled", expectedRevision),
    runTask: async (taskIdValue) => {
      const task = await findTask(taskIdValue)
      if (!isRunnableAutomationTask(task)) {
        throw new AutomationRuntimeError("TASK_NOT_RUNNABLE", "The automation task is not enabled.")
      }
      const previousRuns = await options.persistence.listRuns(task.id)
      if (previousRuns.some((run) => run.status === "queued" || run.status === "running")) {
        throw new AutomationRuntimeError(
          "ACTIVE_RUN_EXISTS",
          "The automation task already has an active run."
        )
      }
      const queued = createQueuedAutomationRun(task, idFactory.runId(), now())
      try {
        await options.persistence.createRun(queued)
      } catch {
        throw new AutomationRuntimeError(
          "ACTIVE_RUN_EXISTS",
          "The automation task already has an active run."
        )
      }
      await audit("automation.run.queued", task, queued)
      const startedAt = now()
      const running = parse(automationTaskRunSchema, {
        ...queued,
        logs: [
          ...queued.logs,
          { at: startedAt, level: "info", message: "Automation run started." },
        ],
        revision: queued.revision + 1,
        startedAt,
        status: "running",
      })
      const persistedRunning = await options.persistence.updateRun(
        running,
        "queued",
        queued.revision
      )
      if (!persistedRunning) {
        throw new AutomationRuntimeError("CONFLICT", "The automation run changed concurrently.")
      }
      const controller = new AbortController()
      activeRuns.set(running.id, controller)
      const execution = (async (): Promise<AutomationTaskRun> => {
        let finalRun: AutomationTaskRun
        try {
          const executor = executors.get(task.definition.handler)
          if (!executor) {
            throw new AutomationRuntimeError(
              "EXECUTOR_NOT_FOUND",
              `No automation executor is registered for ${task.definition.handler}.`
            )
          }
          const result = await executor({
            capabilities: createCapabilities(task, running, controller.signal),
            runId: running.id,
            signal: controller.signal,
            task,
          })
          const completedAt = now()
          finalRun = parse(automationTaskRunSchema, {
            ...running,
            completedAt,
            logs: [
              ...running.logs,
              ...(result.logs ?? []),
              {
                at: completedAt,
                level: controller.signal.aborted ? "warn" : "info",
                message: controller.signal.aborted
                  ? "Automation run cancelled during shutdown."
                  : "Automation run completed.",
              },
            ],
            revision: running.revision + 1,
            status: controller.signal.aborted ? "cancelled" : "succeeded",
          })
        } catch (error) {
          const completedAt = now()
          finalRun = controller.signal.aborted
            ? parse(automationTaskRunSchema, {
                ...running,
                completedAt,
                logs: [
                  ...running.logs,
                  {
                    at: completedAt,
                    level: "warn",
                    message: "Automation run cancelled during shutdown.",
                  },
                ],
                revision: running.revision + 1,
                status: "cancelled",
              })
            : parse(automationTaskRunSchema, {
                ...running,
                completedAt,
                error: {
                  code:
                    error instanceof AutomationRuntimeError
                      ? error.code
                      : "AUTOMATION_EXECUTION_FAILED",
                  message: errorMessage(error),
                  recoverable: true,
                },
                logs: [
                  ...running.logs,
                  { at: completedAt, level: "error", message: errorMessage(error) },
                ],
                revision: running.revision + 1,
                status: "failed",
              })
        }
        const saved = await options.persistence.updateRun(finalRun, "running", running.revision)
        if (!saved) {
          throw new AutomationRuntimeError("CONFLICT", "The automation run changed concurrently.")
        }
        await audit(`automation.run.${saved.status}`, task, saved)
        return saved
      })()
      activeExecutions.add(execution)
      try {
        return await execution
      } finally {
        activeRuns.delete(running.id)
        activeExecutions.delete(execution)
      }
    },
    stop: async () => {
      for (const controller of activeRuns.values()) controller.abort()
      await Promise.allSettled(activeExecutions)
    },
  }

  return service
}
