import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import type { AttachmentMetadata } from "./attachment.js"
import { createFileAttachmentStore } from "./files.js"
import { createValidatedJotaiStorage } from "./jotai.js"
import { createMemoryKeyValueStorage } from "./key-value.js"
import { createMemoryReplicaStore, type ReplicaStore } from "./replica.js"
import {
  createIndexedDbAttachmentStore,
  createIndexedDbReplicaStore,
  createWebKeyValueStorage,
} from "./web.js"

const rows = {
  first: { scopeId: "workspace-a", entityType: "thread", entityId: "1", payload: '{"v":1}' },
  second: { scopeId: "workspace-a", entityType: "thread", entityId: "2", payload: '{"v":2}' },
  other: { scopeId: "workspace-b", entityType: "project", entityId: "1", payload: '{"v":3}' },
} as const

const exerciseReplicaStore = async (store: ReplicaStore): Promise<void> => {
  await store.open()
  await store.apply({ deletes: [], upserts: [rows.first, rows.second, rows.other] })
  await expect(store.read("workspace-a", ["thread"])).resolves.toEqual([rows.first, rows.second])
  await expect(store.read("workspace-a", ["thread"], ["2"])).resolves.toEqual([rows.second])
  await store.apply({
    deletes: [rows.first],
    upserts: [{ ...rows.second, payload: '{"v":20}' }],
  })
  await store.renameScope("workspace-a", "workspace-c")
  await expect(store.read("workspace-c", ["thread"])).resolves.toEqual([
    { ...rows.second, scopeId: "workspace-c", payload: '{"v":20}' },
  ])
  await store.deleteScope("workspace-c")
  await expect(store.readAll()).resolves.toEqual([{ scopeId: "workspace-b", rows: [rows.other] }])
  await store.clear()
  await expect(store.readAll()).resolves.toEqual([])
  await store.close()
}

describe("client storage contracts", () => {
  it("adapts browser key/value storage and publishes local changes", async () => {
    const values = new Map<string, string>()
    const storage = createWebKeyValueStorage({
      getStorage: () => ({
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => {
          values.delete(key)
        },
        setItem: (key, value) => {
          values.set(key, value)
        },
      }),
    })
    const changes: Array<string | null> = []
    const unsubscribe = storage.subscribe?.("cypheria:layout", (value) => changes.push(value))

    await storage.setItem("cypheria:layout", "compact")
    await expect(storage.getItem("cypheria:layout")).resolves.toBe("compact")
    await storage.removeItem("cypheria:layout")
    unsubscribe?.()

    expect(changes).toEqual(["compact", null])
  })

  it("applies the replica contract in memory", async () => {
    await exerciseReplicaStore(createMemoryReplicaStore())
  })

  it("applies the replica contract in IndexedDB", async () => {
    const originalKeyRange = globalThis.IDBKeyRange
    Object.assign(globalThis, { IDBKeyRange })
    try {
      await exerciseReplicaStore(
        createIndexedDbReplicaStore({
          databaseName: `replica-${crypto.randomUUID()}`,
          indexedDb: indexedDB,
          schemaVersion: 1,
        })
      )
    } finally {
      Object.assign(globalThis, { IDBKeyRange: originalKeyRange })
    }
  })

  it("resets an IndexedDB replica when its semantic schema changes", async () => {
    const originalKeyRange = globalThis.IDBKeyRange
    Object.assign(globalThis, { IDBKeyRange })
    const databaseName = `replica-version-${crypto.randomUUID()}`
    try {
      const first = createIndexedDbReplicaStore({
        databaseName,
        indexedDb: indexedDB,
        schemaVersion: 1,
      })
      await first.open()
      await first.apply({ deletes: [], upserts: [rows.first] })
      await first.close()

      const second = createIndexedDbReplicaStore({
        databaseName,
        indexedDb: indexedDB,
        schemaVersion: 2,
      })
      await second.open()
      await expect(second.readAll()).resolves.toEqual([])
      await second.close()
    } finally {
      Object.assign(globalThis, { IDBKeyRange: originalKeyRange })
    }
  })

  it("validates and migrates Jotai persistence envelopes", async () => {
    const keyValue = createMemoryKeyValueStorage()
    const storage = createValidatedJotaiStorage(
      keyValue,
      z.object({ compact: z.boolean() }).strict(),
      {
        version: 2,
        migrate(value, storedVersion) {
          if (storedVersion !== 1 || typeof value !== "boolean") return null
          return { compact: value }
        },
      }
    )

    await keyValue.setItem("layout", JSON.stringify({ value: true, version: 1 }))
    await expect(storage.getItem("layout", { compact: false })).resolves.toEqual({
      compact: true,
    })
    await storage.setItem("layout", { compact: false })
    await expect(keyValue.getItem("layout")).resolves.toBe(
      JSON.stringify({ value: { compact: false }, version: 2 })
    )
    await keyValue.setItem("layout", JSON.stringify({ value: { compact: "yes" }, version: 2 }))
    await expect(storage.getItem("layout", { compact: false })).resolves.toEqual({
      compact: false,
    })
    await expect(keyValue.getItem("layout")).resolves.toBeNull()
  })

  it("stores attachment bytes separately from metadata", async () => {
    const bytesByKey = new Map<string, Uint8Array>()
    const attachments = createFileAttachmentStore("native-file", {
      async write(key, bytes) {
        bytesByKey.set(key, new Uint8Array(bytes))
      },
      async read(key) {
        const bytes = bytesByKey.get(key)
        if (!bytes) throw new Error("not found")
        return new Uint8Array(bytes)
      },
      async delete(key) {
        bytesByKey.delete(key)
      },
      async list() {
        return [...bytesByKey.keys()]
      },
    })
    const saved = await attachments.save({
      id: "att_kept",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "IMAGE/PNG",
      fileName: " image.png ",
    })
    await attachments.save({
      id: "att_orphan",
      bytes: new Uint8Array([4]),
      mediaType: "application/octet-stream",
    })

    expect(saved).toMatchObject({
      storageKey: "att_kept",
      storageType: "native-file",
      mediaType: "image/png",
      fileName: "image.png",
      byteSize: 3,
    })
    await expect(attachments.read(saved)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await attachments.garbageCollect(new Set([saved.storageKey]))
    expect([...bytesByKey.keys()]).toEqual(["att_kept"])
    await expect(
      attachments.read({ ...saved, storageType: "desktop-file" } as AttachmentMetadata)
    ).rejects.toThrow("cannot be read")
  })

  it("persists and garbage-collects attachment bytes in IndexedDB", async () => {
    const attachments = createIndexedDbAttachmentStore({
      databaseName: `attachments-${crypto.randomUUID()}`,
      indexedDb: indexedDB,
    })
    const kept = await attachments.save({
      id: "att_kept",
      bytes: new Uint8Array([8, 9]),
      mediaType: "application/octet-stream",
    })
    const orphan = await attachments.save({
      id: "att_orphan",
      bytes: new Uint8Array([10]),
      mediaType: "application/octet-stream",
    })

    await expect(attachments.read(kept)).resolves.toEqual(new Uint8Array([8, 9]))
    await attachments.garbageCollect(new Set([kept.storageKey]))
    await expect(attachments.read(orphan)).rejects.toThrow("was not found")
  })
})
