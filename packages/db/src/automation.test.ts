import { type AutomationTask, createQueuedAutomationRun } from "@cypheria/automation-core"
import { describe, expect, it } from "vitest"

import { createAutomationPersistenceService } from "./automation.js"
import { createInMemoryDatabase } from "./client.js"
import { ensureDatabaseSchema } from "./migrations.js"

const task = {
  auditCorrelationId: "automation_task_test" as const,
  createdAt: "2026-05-29T00:00:00.000Z",
  id: "task_test" as const,
  runHistory: [],
  status: "enabled",
  title: "No-op task",
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
    id: "workspace_test",
    path: "/tmp/cypheria",
  },
} satisfies AutomationTask

describe("automation persistence service", () => {
  it("saves tasks and run status", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const service = createAutomationPersistenceService(database.db)

    const queuedRun = createQueuedAutomationRun(task, "run_test", "2026-05-29T00:01:00.000Z")
    const succeededRun = {
      ...queuedRun,
      completedAt: "2026-05-29T00:02:00.000Z",
      logs: [
        ...queuedRun.logs,
        {
          at: "2026-05-29T00:02:00.000Z",
          level: "info",
          message: "Automation run completed.",
        },
      ],
      startedAt: "2026-05-29T00:01:30.000Z",
      status: "succeeded",
    } satisfies typeof queuedRun

    await service.saveTask({ ...task, runHistory: [succeededRun] })
    await service.saveRun(succeededRun)

    expect((await service.getTask(task.id))?.runHistory).toEqual([succeededRun])
    await expect(service.getRun(succeededRun.id)).resolves.toEqual(succeededRun)
    await expect(service.listRunsForTask(task.id)).resolves.toEqual([succeededRun])

    database.close()
  })
})
