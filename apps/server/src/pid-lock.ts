import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"

import type { CypheriaServerAddress } from "./server.js"
import { CYPHERIA_SERVER_PID_FILENAME, CYPHERIA_SERVER_VERSION } from "./version.js"

export const ServerPidRecordSchema = z.object({
  address: z
    .object({ host: z.string(), port: z.number().int().positive(), url: z.string().url() })
    .optional(),
  startedAt: z.string().datetime(),
  supervisorPid: z.number().int().positive(),
  version: z.string(),
  workerPid: z.number().int().positive().optional(),
})
export type ServerPidRecord = z.infer<typeof ServerPidRecordSchema>

export const resolvePidFile = (configDir: string): string =>
  resolve(configDir, CYPHERIA_SERVER_PID_FILENAME)

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export async function readPidRecord(configDir: string): Promise<ServerPidRecord | undefined> {
  try {
    return ServerPidRecordSchema.parse(
      JSON.parse(await readFile(resolvePidFile(configDir), "utf8"))
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
}

export class ServerPidLock {
  readonly path: string
  readonly supervisorPid = process.pid

  #record: ServerPidRecord

  private constructor(path: string, record: ServerPidRecord) {
    this.path = path
    this.#record = record
  }

  static async acquire(configDir: string): Promise<ServerPidLock> {
    await mkdir(configDir, { mode: 0o700, recursive: true })
    const path = resolvePidFile(configDir)
    const record: ServerPidRecord = {
      startedAt: new Date().toISOString(),
      supervisorPid: process.pid,
      version: CYPHERIA_SERVER_VERSION,
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const file = await open(path, "wx", 0o600)
        try {
          await file.writeFile(`${JSON.stringify(record)}\n`)
        } finally {
          await file.close()
        }
        return new ServerPidLock(path, record)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const existing = await readPidRecord(configDir)
        if (existing && isProcessAlive(existing.supervisorPid)) {
          throw new Error(`Cypheria server is already running (pid ${existing.supervisorPid})`)
        }
        await unlink(path).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError
        })
      }
    }
    throw new Error(`Unable to acquire server PID lock: ${path}`)
  }

  async updateWorker(workerPid: number, address: CypheriaServerAddress): Promise<void> {
    this.#record = { ...this.#record, address, workerPid }
    const temporaryPath = `${this.path}.${this.supervisorPid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.#record)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.path)
  }

  async release(): Promise<void> {
    const current = await readPidRecord(dirname(this.path))
    if (current?.supervisorPid !== this.supervisorPid) return
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
}
