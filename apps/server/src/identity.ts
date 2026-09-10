import { randomUUID } from "node:crypto"
import { mkdir, open, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { CYPHERIA_SERVER_ID_FILENAME } from "./version.js"

const createId = (): string => `srv_${randomUUID()}`

export async function loadOrCreateServerId(configDir: string): Promise<string> {
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const path = resolve(configDir, CYPHERIA_SERVER_ID_FILENAME)

  try {
    const existing = (await readFile(path, "utf8")).trim()
    if (existing) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const id = createId()
  try {
    const file = await open(path, "wx", 0o600)
    try {
      await file.writeFile(`${id}\n`)
    } finally {
      await file.close()
    }
    return id
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = (await readFile(path, "utf8")).trim()
    if (!existing) throw new Error(`Server identity file is empty: ${path}`)
    return existing
  }
}
