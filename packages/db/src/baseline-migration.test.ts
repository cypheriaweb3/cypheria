import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

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
    expect(tables.rows.map(({ name }) => name)).toContain("thread_attachments")
    expect(tables.rows.map(({ name }) => name)).toContain("thread_message_requests")
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

  it("moves Code Review runs recorded before 0011 into code_review_runs", async () => {
    const source = fileURLToPath(new URL("../drizzle", import.meta.url))
    const folder = mkdtempSync(join(tmpdir(), "cypheria-migrations-"))
    const database = createInMemoryDatabase()
    try {
      cpSync(source, folder, { recursive: true })
      const journalPath = join(folder, "meta", "_journal.json")
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { idx: number }[]
      }
      writeFileSync(
        journalPath,
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 10) })
      )
      await applyDatabaseMigrations(database.client, { migrationsFolder: folder })
      await database.client.execute(
        `INSERT INTO code_reviews (account_key, pull_request_key, run_id, status, review)
         VALUES ('account', 'github:github.com:o/r#1', 'run-1', 'completed', '{"runId":"run-1"}')`
      )

      await applyDatabaseMigrations(database.client)

      const rows = await database.client.execute(
        "SELECT account_key, pr_key, run_id, status FROM code_review_runs"
      )
      expect(rows.rows.map((row) => ({ ...row }))).toEqual([
        {
          account_key: "account",
          pr_key: "github:github.com:o/r#1",
          run_id: "run-1",
          status: "completed",
        },
      ])
      const tables = await database.client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'code_review%'"
      )
      expect(tables.rows.map(({ name }) => name).sort()).toEqual([
        "code_review_prs",
        "code_review_runs",
      ])
    } finally {
      database.close()
      rmSync(folder, { force: true, recursive: true })
    }
  })
})
