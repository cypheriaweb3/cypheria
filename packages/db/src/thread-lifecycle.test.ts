import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createThreadLifecyclePersistenceService } from "./thread-lifecycle.js"

describe("thread lifecycle persistence", () => {
  it("tracks recoverable harness/SQLite boundary operations", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await database.client.execute({
      args: ["codex", "Codex", "0.153.4", 1, 1, 1, "2026-01-01T00:00:00.000Z"],
      sql: `INSERT INTO agent_registry
        (id, name, version, native, installed, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    })
    const service = createThreadLifecyclePersistenceService(database.db)
    const operation = await service.begin(
      {
        agentId: "codex",
        input: { cwd: "/repo" },
        kind: "create",
        threadId: "01984de2-8f74-7c91-a3b2-5c5e937cf399",
      },
      10
    )

    expect(await service.listRecoverable()).toEqual([operation])
    const transitioned = await service.transition(
      operation.id,
      { agentSessionId: "harness-1", status: "harness-created" },
      11
    )
    expect(transitioned).toMatchObject({
      agentSessionId: "harness-1",
      status: "harness-created",
      updatedAt: 11,
    })
    await service.complete(operation.id)
    expect(await service.get(operation.id)).toBeUndefined()
    database.close()
  })

  it("retains failed deletes for diagnosis and automated recovery", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await database.client.execute({
      args: ["codex", "Codex", "0.153.4", 1, 1, 1, "2026-01-01T00:00:00.000Z"],
      sql: `INSERT INTO agent_registry
        (id, name, version, native, installed, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    })
    const service = createThreadLifecyclePersistenceService(database.db)
    const operation = await service.begin({
      agentId: "codex",
      input: {},
      kind: "delete",
      threadId: "01984de2-8f74-7c91-a3b2-5c5e937cf399",
    })

    expect(await service.fail(operation.id, "harness unavailable")).toMatchObject({
      error: "harness unavailable",
      status: "failed",
    })
    expect(await service.listRecoverable()).toEqual([
      expect.objectContaining({ id: operation.id, kind: "delete", status: "failed" }),
    ])
    database.close()
  })
})
