import { describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

describe("database baseline migration", () => {
  it("creates the complete current schema including agent registry", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)

    const tables = await database.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    expect(tables.rows.map(({ name }) => name)).toContain("agent_registry")
    expect(tables.rows.map(({ name }) => name)).toContain("networks")
    expect(tables.rows.map(({ name }) => name)).toContain("projects")
    expect(tables.rows.map(({ name }) => name)).toContain("threads")
    expect(tables.rows.map(({ name }) => name)).toContain("thread_lifecycle_operations")
    expect(tables.rows.map(({ name }) => name)).toContain("thread_timeline_epochs")
    expect(tables.rows.map(({ name }) => name)).toContain("thread_timeline_rows")
    expect(tables.rows.map(({ name }) => name)).toContain("sections")
    expect(tables.rows.map(({ name }) => name)).toContain("schedules")
    expect(tables.rows.map(({ name }) => name)).toContain("schedule_runs")
    expect(tables.rows.map(({ name }) => name)).toContain("wallets")

    const agents = createAgentRegistryPersistenceService(database.db)
    await agents.reconcile([
      { id: "codex", native: true },
      { id: "gemini", native: false },
    ])
    expect(await agents.get("codex")).toMatchObject({
      enabled: false,
      createdAt: expect.any(String),
      id: "codex",
      installed: false,
      native: true,
      version: null,
    })

    await expect(database.client.execute("PRAGMA foreign_key_check")).resolves.toMatchObject({
      rows: [],
    })
    database.close()
  })
})
