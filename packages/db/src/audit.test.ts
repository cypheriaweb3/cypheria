import { describe, expect, it } from "vitest"

import { createAuditLogService } from "./audit.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

describe("audit log service", () => {
  it("appends and reads audit log records", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createAuditLogService(database.db)

    const record = await service.append({
      correlationId: "corr_1",
      actor: "user",
      eventType: "policy.decision",
      source: "test",
      payloadHash: "sha256:test",
      payloadSummary: "Policy allowed read-only action",
      createdAt: "2026-05-28T00:00:00.000Z",
    })

    await expect(service.getById(record.id)).resolves.toEqual(record)
    await expect(service.list()).resolves.toEqual([record])

    database.close()
  })
})
