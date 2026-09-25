import type { ClientStorage } from "@cypheria/storage"
import { createFileAttachmentStore } from "@cypheria/storage/files"
import {
  createSqliteReplicaStore,
  type ReplicaSqliteConnection,
  type ReplicaSqliteDriver,
  type ReplicaSqliteValue,
} from "@cypheria/storage/sqlite"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Directory, File, Paths } from "expo-file-system"
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
  },
  replica: createSqliteReplicaStore(sqliteDriver, 1),
  attachments: createFileAttachmentStore("native-file", {
    async write(storageKey, bytes) {
      ensureAttachmentDirectory()
      const file = new File(attachmentDirectory, storageKey)
      file.create({ intermediates: true, overwrite: true })
      file.write(bytes)
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
  }),
}

export const openClientStorage = async (): Promise<ClientStorage> => {
  await clientStorage.replica.open()
  return clientStorage
}
