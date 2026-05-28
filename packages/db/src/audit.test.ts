import { describe, expect, it } from "vitest"

import { createAuditLogService } from "./audit.js"
import { createInMemoryDatabase } from "./client.js"
import { ensureDatabaseSchema } from "./migrations.js"

describe("audit log service", () => {
  it("appends and reads audit log records", () => {
    const database = createInMemoryDatabase()
    ensureDatabaseSchema(database.sqlite)
    const service = createAuditLogService(database.db)

    const record = service.append({
      actor: "user",
      correlationId: "corr_1",
      createdAt: "2026-05-28T00:00:00.000Z",
      eventType: "policy.decision",
      payloadHash: "sha256:test",
      payloadSummary: "Policy allowed read-only action",
      source: "test",
    })

    expect(service.getById(record.id)).toEqual(record)
    expect(service.list()).toEqual([record])

    database.close()
  })
})
