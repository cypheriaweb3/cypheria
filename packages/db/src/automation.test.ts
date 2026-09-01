import {
  type AutomationTask,
  automationTaskSchema,
  createQueuedAutomationRun,
} from "@cypheria/automation-core"
import { describe, expect, it } from "vitest"

import { createAutomationPersistenceService } from "./automation.js"
import { createInMemoryDatabase } from "./client.js"
import { ensureDatabaseSchema } from "./migrations.js"

const task = automationTaskSchema.parse({
  auditCorrelationId: "automation_task_test",
  createdAt: "2026-05-29T00:00:00.000Z",
  definition: { handler: "noop" },
  id: "task_test",
  revision: 1,
  status: "enabled",
  title: "No-op task",
  trigger: { kind: "manual", requestedBy: "user" },
  updatedAt: "2026-05-29T00:00:00.000Z",
  walletPolicyScope: { accountIds: [], chainIds: [1], mode: "read-only" },
  workspace: { id: "workspace_test", path: "/tmp/cypheria" },
}) as AutomationTask

describe("automation persistence service", () => {
  it("creates, lists, and atomically transitions tasks and runs", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
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
      revision: 2,
      startedAt: "2026-05-29T00:04:00.000Z",
      status: "running" as const,
    }
    await expect(service.updateRun(running, "queued", 1)).resolves.toEqual(running)
    await expect(service.listRuns(task.id)).resolves.toEqual([running])

    database.close()
  })

  it("allows only one queued or running run per task", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const service = createAutomationPersistenceService(database.db)
    await service.createTask(task)
    await service.createRun(createQueuedAutomationRun(task, "run_one", task.createdAt))

    await expect(
      service.createRun(createQueuedAutomationRun(task, "run_two", task.updatedAt))
    ).rejects.toThrow()
    database.close()
  })

  it("upgrades the legacy automation baseline in a local SQLite database", async () => {
    const database = createInMemoryDatabase()
    await database.client.execute(`CREATE TABLE automation_tasks (
      audit_correlation_id text NOT NULL,
      created_at text NOT NULL,
      description text,
      id text PRIMARY KEY NOT NULL,
      run_history text NOT NULL,
      status text NOT NULL,
      title text NOT NULL,
      trigger text NOT NULL,
      updated_at text NOT NULL,
      wallet_policy_scope text NOT NULL,
      workspace text NOT NULL
    )`)
    await database.client.execute({
      args: [
        task.auditCorrelationId,
        task.createdAt,
        task.id,
        JSON.stringify([]),
        task.status,
        task.title,
        JSON.stringify(task.trigger),
        task.updatedAt,
        JSON.stringify(task.walletPolicyScope),
        JSON.stringify(task.workspace),
      ],
      sql: `INSERT INTO automation_tasks (
        audit_correlation_id, created_at, id, run_history, status, title,
        trigger, updated_at, wallet_policy_scope, workspace
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    })

    await ensureDatabaseSchema(database.client)
    await expect(createAutomationPersistenceService(database.db).getTask(task.id)).resolves.toEqual(
      task
    )
    database.close()
  })
})
