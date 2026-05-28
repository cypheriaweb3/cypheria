import { randomUUID } from "node:crypto"
import { Worker } from "node:worker_threads"

import {
  type AutomationRunId,
  type AutomationRunLogEntry,
  type AutomationTask,
  type AutomationTaskRun,
  createQueuedAutomationRun,
  isRunnableAutomationTask,
} from "@cypheria/automation-core"
import type { AuditLogService, AutomationPersistenceService } from "@cypheria/db"

export type AutomationWorkerInput = {
  readonly runId: AutomationRunId
  readonly startedAt: string
  readonly task: AutomationTask
}

export type AutomationWorkerResult = {
  readonly logs: readonly AutomationRunLogEntry[]
}

export type AutomationWorkerBoundary = {
  readonly runNoopTask: (input: AutomationWorkerInput) => Promise<AutomationWorkerResult>
}

export type AutomationCancellationResult = {
  readonly accepted: boolean
  readonly reason: string
  readonly runId: AutomationRunId
}

export type LocalAutomationRunnerOptions = {
  readonly auditLog?: Pick<AuditLogService, "append">
  readonly now?: () => string
  readonly persistence: AutomationPersistenceService
  readonly workerBoundary?: AutomationWorkerBoundary
}

export type LocalAutomationRunner = {
  readonly cancelRun: (runId: AutomationRunId) => AutomationCancellationResult
  readonly runManualNoopTask: (task: AutomationTask) => Promise<AutomationTaskRun>
}

const workerSource = `
const { parentPort, workerData } = require("node:worker_threads")

parentPort.postMessage({
  logs: [
    {
      at: workerData.startedAt,
      level: "info",
      message: "No-op automation worker completed."
    }
  ]
})
`

export const createWorkerThreadAutomationBoundary = (): AutomationWorkerBoundary => ({
  runNoopTask: (input) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: input,
      })

      worker.once("message", (result: AutomationWorkerResult) => {
        resolve(result)
      })
      worker.once("error", reject)
      worker.once("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Automation worker exited with code ${code}.`))
        }
      })
    }),
})

const createRunId = (): AutomationRunId => `run_${randomUUID()}`

const createErrorSummary = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown automation runner error."

export const createLocalAutomationRunner = (
  options: LocalAutomationRunnerOptions
): LocalAutomationRunner => {
  const now = options.now ?? (() => new Date().toISOString())
  const workerBoundary = options.workerBoundary ?? createWorkerThreadAutomationBoundary()

  return {
    cancelRun: (runId) => ({
      accepted: false,
      reason: "Automation cancellation is not implemented yet.",
      runId,
    }),
    runManualNoopTask: async (task) => {
      if (task.trigger.kind !== "manual") {
        throw new Error("Only manual automation tasks can run through this baseline runner.")
      }

      if (!isRunnableAutomationTask(task)) {
        throw new Error(`Automation task ${task.id} is not enabled.`)
      }

      const queuedAt = now()
      const queuedRun = createQueuedAutomationRun(task, createRunId(), queuedAt)
      options.persistence.saveTask({ ...task, runHistory: [...task.runHistory, queuedRun] })
      options.persistence.saveRun(queuedRun)
      options.auditLog?.append({
        actor: "automation",
        correlationId: queuedRun.auditCorrelationId,
        createdAt: queuedAt,
        eventType: "automation.run.queued",
        payloadSummary: `Queued automation task ${task.id}.`,
        source: "desktop.main.automation",
      })

      const startedAt = now()
      const runningRun: AutomationTaskRun = {
        ...queuedRun,
        logs: [
          ...queuedRun.logs,
          {
            at: startedAt,
            level: "info",
            message: "Automation run started.",
          },
        ],
        startedAt,
        status: "running",
      }
      options.persistence.saveRun(runningRun)

      try {
        const result = await workerBoundary.runNoopTask({
          runId: runningRun.id,
          startedAt,
          task,
        })
        const completedAt = now()
        const completedRun: AutomationTaskRun = {
          ...runningRun,
          completedAt,
          logs: [
            ...runningRun.logs,
            ...result.logs,
            {
              at: completedAt,
              level: "info",
              message: "Automation run completed.",
            },
          ],
          status: "succeeded",
        }

        options.persistence.saveRun(completedRun)
        options.persistence.saveTask({
          ...task,
          runHistory: [...task.runHistory, completedRun],
          updatedAt: completedAt,
        })
        options.auditLog?.append({
          actor: "automation",
          correlationId: completedRun.auditCorrelationId,
          createdAt: completedAt,
          eventType: "automation.run.succeeded",
          payloadSummary: `Completed automation task ${task.id}.`,
          source: "desktop.main.automation",
        })

        return completedRun
      } catch (error) {
        const completedAt = now()
        const failedRun: AutomationTaskRun = {
          ...runningRun,
          completedAt,
          error: {
            code: "AUTOMATION_WORKER_FAILED",
            message: createErrorSummary(error),
            recoverable: true,
          },
          logs: [
            ...runningRun.logs,
            {
              at: completedAt,
              level: "error",
              message: createErrorSummary(error),
            },
          ],
          status: "failed",
        }

        options.persistence.saveRun(failedRun)
        options.persistence.saveTask({
          ...task,
          runHistory: [...task.runHistory, failedRun],
          updatedAt: completedAt,
        })
        options.auditLog?.append({
          actor: "automation",
          correlationId: failedRun.auditCorrelationId,
          createdAt: completedAt,
          eventType: "automation.run.failed",
          payloadSummary: `Failed automation task ${task.id}: ${failedRun.error?.message}`,
          source: "desktop.main.automation",
        })

        return failedRun
      }
    },
  }
}
