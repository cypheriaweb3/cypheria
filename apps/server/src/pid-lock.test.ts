import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { readPidRecord, ServerPidLock } from "./pid-lock.js"

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("ServerPidLock", () => {
  it("prevents a second supervisor and persists worker readiness", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-pid-test-"))
    temporaryDirectories.push(configDir)
    const lock = await ServerPidLock.acquire(configDir)
    await expect(ServerPidLock.acquire(configDir)).rejects.toThrow("already running")

    await lock.updateWorker(1234, {
      host: "127.0.0.1",
      port: 6768,
      url: "http://127.0.0.1:6768",
    })
    await expect(readPidRecord(configDir)).resolves.toMatchObject({
      supervisorPid: process.pid,
      workerPid: 1234,
    })
    await lock.release()
    await expect(readPidRecord(configDir)).resolves.toBeUndefined()
  })
})
