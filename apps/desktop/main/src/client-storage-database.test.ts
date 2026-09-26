import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createDesktopClientStorageDatabase } from "./client-storage-database.js"

const firstRow = {
  scopeId: "workspace-a",
  entityType: "thread",
  entityId: "thread-1",
  payload: JSON.stringify({ title: "First" }),
}

describe("desktop client storage database", () => {
  it("stores key/value and replica data in SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-client-storage-"))
    const keyValueFilePath = join(directory, "kv.sqlite")
    const replicaFilePath = join(directory, "replica.sqlite")
    const storage = createDesktopClientStorageDatabase({ keyValueFilePath, replicaFilePath })
    const changes: Array<string | null> = []
    const unsubscribe = storage.keyValue.subscribe?.("panelLayout:thread-1", (value) =>
      changes.push(value)
    )

    try {
      await storage.keyValue.setItem("panelLayout:thread-1", "compact".repeat(50))
      await storage.keyValue.setItem("literal%_key", "literal")
      await expect(storage.keyValue.getItem("panelLayout:thread-1")).resolves.toBe(
        "compact".repeat(50)
      )
      await expect(storage.keyValue.listPage({ query: "%_" })).resolves.toMatchObject({
        items: [{ key: "literal%_key" }],
      })
      await expect(storage.keyValue.listPage({ query: "layout" })).resolves.toMatchObject({
        items: [{ valueLength: 350, valueTruncated: true }],
      })

      await storage.replica.open()
      await storage.replica.apply({ deletes: [], upserts: [firstRow] })
      await expect(storage.replica.read("workspace-a", ["thread"])).resolves.toEqual([firstRow])
      await expect(storage.replica.listPage({ query: "first" })).resolves.toMatchObject({
        items: [{ entityId: "thread-1", payloadTruncated: false }],
      })

      await storage.keyValue.removeItem("panelLayout:thread-1")
      expect(changes).toEqual(["compact".repeat(50), null])
      if (process.platform !== "win32") {
        expect((await stat(keyValueFilePath)).mode & 0o777).toBe(0o600)
        expect((await stat(replicaFilePath)).mode & 0o777).toBe(0o600)
      }
    } finally {
      unsubscribe?.()
      await storage.close()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("resets only replica rows when the semantic schema version changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-client-storage-version-"))
    const keyValueFilePath = join(directory, "kv.sqlite")
    const replicaFilePath = join(directory, "replica.sqlite")

    try {
      const first = createDesktopClientStorageDatabase({
        keyValueFilePath,
        replicaFilePath,
        replicaSchemaVersion: 1,
      })
      await first.keyValue.setItem("appearance", "dark")
      await first.replica.open()
      await first.replica.apply({ deletes: [], upserts: [firstRow] })
      await first.close()

      const second = createDesktopClientStorageDatabase({
        keyValueFilePath,
        replicaFilePath,
        replicaSchemaVersion: 2,
      })
      await second.replica.open()
      await expect(second.replica.readAll()).resolves.toEqual([])
      await expect(second.keyValue.getItem("appearance")).resolves.toBe("dark")
      await second.close()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
