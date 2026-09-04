import {
  type AutomationTask,
  automationTaskSchema,
  createQueuedAutomationRun,
} from "@cypheria/automation-core"
import { describe, expect, it } from "vitest"

import { createAutomationPersistenceService } from "./automation.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

const task = automationTaskSchema.parse({
  id: "task_test",
  workspace: { id: "workspace_test", path: "/tmp/cypheria" },
  title: "No-op task",
  trigger: { kind: "manual", requestedBy: "user" },
  definition: { handler: "noop" },
  walletPolicyScope: { accountIds: [], chainKeys: ["eip155:1"], mode: "read-only" },
  status: "enabled",
  revision: 1,
  auditCorrelationId: "automation_task_test",
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
}) as AutomationTask

describe("automation persistence service", () => {
  it("creates, lists, and atomically transitions tasks and runs", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createAutomationPersistenceService(database.db)

    await service.createTask(task)
    await expect(service.listTasks({ status: "enabled" })).resolves.toEqual([task])
    const paused = await service.updateTaskStatus(task.id, {
      expectedRevision: 1,
      from: ["enabled"],
      status: "paused",
      updatedAt: "2026-05-29T00:01:00.000Z",
    })
    expect(paused).toMatchObject({ revision: 2, status: "paused" })
    await expect(
      service.updateTaskStatus(task.id, {
        expectedRevision: 1,
        from: ["enabled"],
        status: "paused",
        updatedAt: "2026-05-29T00:02:00.000Z",
      })
    ).resolves.toBeUndefined()

    const queued = createQueuedAutomationRun(task, "run_test", "2026-05-29T00:03:00.000Z")
    await service.createRun(queued)
    const running = {
      ...queued,
      status: "running" as const,
      revision: 2,
      startedAt: "2026-05-29T00:04:00.000Z",
    }
    await expect(service.updateRun(running, "queued", 1)).resolves.toEqual(running)
    await expect(service.listRuns(task.id)).resolves.toEqual([running])

    database.close()
  })

  it("allows only one queued or running run per task", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createAutomationPersistenceService(database.db)
    await service.createTask(task)
    await service.createRun(createQueuedAutomationRun(task, "run_one", task.createdAt))

    await expect(
      service.createRun(createQueuedAutomationRun(task, "run_two", task.updatedAt))
    ).rejects.toThrow()
    database.close()
  })
})
