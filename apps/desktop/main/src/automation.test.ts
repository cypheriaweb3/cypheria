import type { AutomationTask } from "@cypheria/automation-core"
import {
  createAuditLogService,
  createAutomationPersistenceService,
  createInMemoryDatabase,
  ensureDatabaseSchema,
} from "@cypheria/db"
import { describe, expect, it } from "vitest"

import { createLocalAutomationRunner } from "./automation.js"

const task = {
  auditCorrelationId: "automation_task_noop" as const,
  createdAt: "2026-05-29T00:00:00.000Z",
  id: "task_noop" as const,
  runHistory: [],
  status: "enabled",
  title: "Manual no-op",
  trigger: {
    kind: "manual",
    requestedBy: "user",
  },
  updatedAt: "2026-05-29T00:00:00.000Z",
  walletPolicyScope: {
    accountIds: [],
    chainIds: [1],
    mode: "read-only",
  },
  workspace: {
    id: "workspace_noop",
    path: "/tmp/cypheria",
  },
} satisfies AutomationTask

describe("local automation runner", () => {
  it("runs a manual no-op task through a worker boundary and persists status", async () => {
    const database = createInMemoryDatabase()
    ensureDatabaseSchema(database.sqlite)
    const persistence = createAutomationPersistenceService(database.db)
    const auditLog = createAuditLogService(database.db)
    const times = [
      "2026-05-29T00:01:00.000Z",
      "2026-05-29T00:01:01.000Z",
      "2026-05-29T00:01:02.000Z",
    ]
    const workerCalls: string[] = []
    const runner = createLocalAutomationRunner({
      auditLog,
      now: () => times.shift() ?? "2026-05-29T00:01:03.000Z",
      persistence,
      workerBoundary: {
        runNoopTask: async (input) => {
          workerCalls.push(input.runId)
          return {
            logs: [
              {
                at: input.startedAt,
                level: "info",
                message: "No-op worker observed task.",
              },
            ],
          }
        },
      },
    })

    const run = await runner.runManualNoopTask(task)

    expect(workerCalls).toEqual([run.id])
    expect(run).toMatchObject({
      completedAt: "2026-05-29T00:01:02.000Z",
      startedAt: "2026-05-29T00:01:01.000Z",
      status: "succeeded",
      taskId: "task_noop",
    })
    expect(persistence.getRun(run.id)).toEqual(run)
    expect(persistence.getTask(task.id)?.runHistory).toEqual([run])
    expect(auditLog.list({ limit: 2 }).map((record) => record.eventType)).toEqual([
      "automation.run.succeeded",
      "automation.run.queued",
    ])

    database.close()
  })

  it("exposes an explicit cancellation placeholder", () => {
    const database = createInMemoryDatabase()
    ensureDatabaseSchema(database.sqlite)
    const runner = createLocalAutomationRunner({
      persistence: createAutomationPersistenceService(database.db),
    })

    expect(runner.cancelRun("run_cancel")).toEqual({
      accepted: false,
      reason: "Automation cancellation is not implemented yet.",
      runId: "run_cancel",
    })

    database.close()
  })
})
