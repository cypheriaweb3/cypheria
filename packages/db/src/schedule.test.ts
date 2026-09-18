import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { type OpenDatabaseResult, openCypheriaDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createSchedulePersistenceService } from "./schedule.js"

const opened: Array<{ database: OpenDatabaseResult; directory: string }> = []

afterEach(() => {
  for (const { database, directory } of opened.splice(0)) {
    database.close()
    rmSync(directory, { force: true, recursive: true })
  }
})

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-schedule-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: directory })
  opened.push({ database, directory })
  await applyDatabaseMigrations(database.client)
  return createSchedulePersistenceService(database.db)
}

describe("schedule persistence", () => {
  it("atomically claims one run and advances the schedule before execution", async () => {
    const persistence = await setup()
    const schedule = await persistence.create(
      {
        cadence: { everyMs: 60_000, type: "interval" },
        nextRunAt: 1_000,
        target: { method: "wallet.list", type: "web3" },
      },
      0
    )

    const claims = [
      await persistence.claim(schedule.id, {
        lockMs: 60_000,
        nextRunAt: 61_000,
        now: 1_000,
        scheduledFor: 1_000,
        status: "active",
      }),
      await persistence.claim(schedule.id, {
        lockMs: 60_000,
        nextRunAt: 61_000,
        now: 1_000,
        scheduledFor: 1_000,
        status: "active",
      }),
    ]

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(await persistence.get(schedule.id)).toMatchObject({
      lastRunAt: 1_000,
      nextRunAt: 61_000,
      revision: 1,
    })
    expect(await persistence.listRuns(schedule.id)).toHaveLength(1)
  })

  it("marks unfinished work interrupted without making the claimed slot due again", async () => {
    const persistence = await setup()
    const schedule = await persistence.create(
      {
        cadence: { at: new Date(1_000).toISOString(), type: "once" },
        nextRunAt: 1_000,
        target: { method: "wallet.send", type: "web3" },
      },
      0
    )
    await persistence.claim(schedule.id, {
      lockMs: 60_000,
      nextRunAt: null,
      now: 1_000,
      scheduledFor: 1_000,
      status: "completed",
    })

    await expect(persistence.recoverInterrupted(2_000)).resolves.toMatchObject([
      { finishedAt: 2_000, status: "interrupted" },
    ])
    await expect(persistence.listDue(2_000)).resolves.toEqual([])
    await expect(persistence.listRuns(schedule.id)).resolves.toMatchObject([
      { status: "interrupted" },
    ])
  })
})
