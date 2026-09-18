import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createSchedulePersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import type { ThreadManager } from "../thread/thread-manager.js"
import { ScheduleService } from "./schedule-service.js"

describe("ScheduleService recovery", () => {
  it("does not replay an interrupted Web3 operation after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cypheria-schedule-service-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: directory })
    try {
      await applyDatabaseMigrations(database.client)
      const persistence = createSchedulePersistenceService(database.db)
      const firstRuntime = vi.fn(() => new Promise<unknown>(() => undefined))
      const first = new ScheduleService({
        logger: pino({ enabled: false }),
        persistence,
        publish: vi.fn(),
        requestRuntime: firstRuntime,
        threadManager: {} as ThreadManager,
      })
      const schedule = await first.create({
        cadence: { at: new Date(Date.now() - 1_000).toISOString(), type: "once" },
        target: { method: "wallet.send", params: { value: "1" }, type: "web3" },
      })

      await first.start()
      expect(firstRuntime).toHaveBeenCalledTimes(1)
      first.stop()

      const secondRuntime = vi.fn(async () => ({ submitted: true }))
      const second = new ScheduleService({
        logger: pino({ enabled: false }),
        persistence,
        publish: vi.fn(),
        requestRuntime: secondRuntime,
        threadManager: {} as ThreadManager,
      })
      await second.start()
      second.stop()

      expect(secondRuntime).not.toHaveBeenCalled()
      await expect(second.listRuns(schedule.id, 10)).resolves.toMatchObject([
        { status: "interrupted", targetType: "web3" },
      ])
    } finally {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
