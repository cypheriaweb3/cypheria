import type { ClientStorage } from "@cypheria/storage"
import {
  createTextPreview,
  decodeStorageCursor,
  encodeStorageCursor,
  normalizeStoragePageRequest,
} from "@cypheria/storage"
import { createFileAttachmentStore } from "@cypheria/storage/files"
import {
  createSqliteReplicaStore,
  type ReplicaSqliteConnection,
  type ReplicaSqliteDriver,
  type ReplicaSqliteValue,
} from "@cypheria/storage/sqlite"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Directory, File, FileMode, Paths } from "expo-file-system"
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite"

const toSqliteConnection = (
  database: SQLiteDatabase,
  closeable: boolean
): ReplicaSqliteConnection => ({
  exec: (sql) => database.execAsync(sql),
  async run(sql, params = []) {
    await database.runAsync(sql, [...params])
  },
  all: <Row>(sql: string, params: readonly ReplicaSqliteValue[] = []) =>
    database.getAllAsync<Row>(sql, [...params]),
  transaction: (operation) =>
    database.withExclusiveTransactionAsync((transaction) =>
      operation(toSqliteConnection(transaction, false))
    ),
  async close() {
    if (closeable) await database.closeAsync()
  },
})

const sqliteDriver: ReplicaSqliteDriver = {
  async open() {
    return toSqliteConnection(await openDatabaseAsync("cypheria-client-replica.db"), true)
  },
}

const attachmentDirectory = new Directory(Paths.document, "cypheria-client-attachments")
const validStorageKey = /^[A-Za-z0-9_-]{1,128}$/u

const ensureAttachmentDirectory = (): void => {
  attachmentDirectory.create({ idempotent: true, intermediates: true })
}

export const clientStorage: ClientStorage = {
  keyValue: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
    async listPage(request = {}) {
      const { cursor, limit, query } = normalizeStoragePageRequest(request)
      const cursorKey = decodeStorageCursor(cursor, 1)?.[0] ?? null
      const matchingKeys = (await AsyncStorage.getAllKeys())
        .filter(
          (key) =>
            (cursorKey === null || key > cursorKey) &&
            (!query || key.toLocaleLowerCase().includes(query))
        )
        .sort()
      const pageKeys = matchingKeys.slice(0, limit + 1)
      const hasMore = pageKeys.length > limit
      if (hasMore) pageKeys.pop()
      const values = new Map(await AsyncStorage.multiGet(pageKeys))
      return {
        items: pageKeys.map((key) => {
          const preview = createTextPreview(values.get(key) ?? "")
          return {
            key,
            valueLength: preview.length,
            valuePreview: preview.preview,
            valueTruncated: preview.truncated,
          }
        }),
        nextCursor:
          hasMore && pageKeys.length ? encodeStorageCursor([pageKeys.at(-1) as string]) : null,
      }
    },
  },
  replica: createSqliteReplicaStore(sqliteDriver, 1),
  attachments: createFileAttachmentStore("native-file", {
    async write(storageKey, bytes) {
      ensureAttachmentDirectory()
      const file = new File(attachmentDirectory, storageKey)
      file.create({ intermediates: true, overwrite: true })
      file.write(bytes)
    },
    async copyFileUri(storageKey, uri) {
      ensureAttachmentDirectory()
      const destination = new File(attachmentDirectory, storageKey)
      await new File(uri).copy(destination, { overwrite: true })
      return destination.size
    },
    async read(storageKey) {
      const file = new File(attachmentDirectory, storageKey)
      if (!file.exists) throw new Error(`Attachment '${storageKey}' was not found.`)
      return file.bytes()
    },
    async delete(storageKey) {
      const file = new File(attachmentDirectory, storageKey)
      if (file.exists) file.delete()
    },
    async list() {
      if (!attachmentDirectory.exists) return []
      return attachmentDirectory
        .list()
        .filter((entry): entry is File => entry instanceof File && validStorageKey.test(entry.name))
        .map((file) => file.name)
        .sort()
    },
    async listPage(request = {}) {
      const { cursor, limit, query } = normalizeStoragePageRequest(request)
      const cursorKey = decodeStorageCursor(cursor, 1)?.[0] ?? null
      if (!attachmentDirectory.exists) return { items: [], nextCursor: null }
      const matchingKeys = attachmentDirectory
        .list()
        .filter((entry): entry is File => entry instanceof File && validStorageKey.test(entry.name))
        .map((file) => file.name)
        .filter(
          (storageKey) =>
            storageKey > (cursorKey ?? "") &&
            (!query || storageKey.toLocaleLowerCase().includes(query))
        )
        .sort()
      const pageKeys = matchingKeys.slice(0, limit + 1)
      const hasMore = pageKeys.length > limit
      if (hasMore) pageKeys.pop()
      const items = pageKeys.map((storageKey) => {
        const file = new File(attachmentDirectory, storageKey)
        const handle = file.open(FileMode.ReadOnly)
        try {
          return {
            storageKey,
            byteSize: file.size,
            bytePreview: handle.readBytes(Math.min(file.size, 32)),
          }
        } finally {
          handle.close()
        }
      })
      return {
        items,
        nextCursor:
          hasMore && pageKeys.length ? encodeStorageCursor([pageKeys.at(-1) as string]) : null,
      }
    },
  }),
}

export const openClientStorage = async (): Promise<ClientStorage> => {
  await clientStorage.replica.open()
  return clientStorage
}
