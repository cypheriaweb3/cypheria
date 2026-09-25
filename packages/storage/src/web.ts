import {
  type AttachmentMetadata,
  type AttachmentStore,
  assertAttachmentStorageType,
  normalizeAttachmentInput,
} from "./attachment.js"
import {
  type KeyValueStorage,
  type KeyValueStorageListener,
  StorageUnavailableError,
} from "./key-value.js"
import type { ReplicaRow, ReplicaRowChanges, ReplicaScopeRows, ReplicaStore } from "./replica.js"

interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface WebKeyValueStorageOptions {
  readonly getStorage?: () => WebStorageLike | undefined
  readonly eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">
}

const defaultWebStorage = (): WebStorageLike | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function createWebKeyValueStorage(options: WebKeyValueStorageOptions = {}): KeyValueStorage {
  const getStorage = options.getStorage ?? defaultWebStorage
  const eventTarget = options.eventTarget ?? (typeof window === "undefined" ? undefined : window)
  const listeners = new Map<string, Set<KeyValueStorageListener>>()

  const emit = (key: string, value: string | null) => {
    for (const listener of listeners.get(key) ?? []) listener(value)
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null) emit(event.key, event.newValue)
  }
  eventTarget?.addEventListener("storage", handleStorage)

  const requireStorage = (): WebStorageLike => {
    const storage = getStorage()
    if (!storage) throw new StorageUnavailableError()
    return storage
  }

  return {
    async getItem(key) {
      return getStorage()?.getItem(key) ?? null
    },
    async setItem(key, value) {
      requireStorage().setItem(key, value)
      emit(key, value)
    },
    async removeItem(key) {
      requireStorage().removeItem(key)
      emit(key, null)
    },
    subscribe(key, listener) {
      const keyListeners = listeners.get(key) ?? new Set<KeyValueStorageListener>()
      keyListeners.add(listener)
      listeners.set(key, keyListeners)
      return () => {
        keyListeners.delete(listener)
        if (keyListeners.size === 0) listeners.delete(key)
      }
    },
  }
}

const replicaRowsStore = "rows"
const replicaMetaStore = "meta"
const replicaSchemaVersionKey = "schema_version"

export interface IndexedDbReplicaStoreOptions {
  readonly databaseName?: string
  readonly schemaVersion: number
  readonly indexedDb?: IDBFactory
}

const requestResult = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed."))
    )
  })

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve())
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."))
    )
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."))
    )
  })

const runTransaction = async (
  database: IDBDatabase,
  stores: string | string[],
  operation: (transaction: IDBTransaction) => Promise<void>
): Promise<void> => {
  const transaction = database.transaction(stores, "readwrite")
  const completion = transactionComplete(transaction)
  try {
    await operation(transaction)
    await completion
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already have aborted because a request failed.
    }
    await completion.catch(() => undefined)
    throw error
  }
}

const resolveIndexedDb = (provided?: IDBFactory): IDBFactory => {
  const factory = provided ?? globalThis.indexedDB
  if (!factory) throw new StorageUnavailableError("IndexedDB is unavailable in this runtime.")
  return factory
}

const openReplicaDatabase = (indexedDb: IDBFactory, databaseName: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, 1)
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(replicaRowsStore)) {
        request.result.createObjectStore(replicaRowsStore, {
          keyPath: ["scopeId", "entityType", "entityId"],
        })
      }
      if (!request.result.objectStoreNames.contains(replicaMetaStore)) {
        request.result.createObjectStore(replicaMetaStore)
      }
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Failed to open the client replica database."))
    )
    request.addEventListener("blocked", () =>
      reject(new Error("Opening the client replica database was blocked."))
    )
  })

export function createIndexedDbReplicaStore(options: IndexedDbReplicaStoreOptions): ReplicaStore {
  if (!Number.isInteger(options.schemaVersion) || options.schemaVersion < 1) {
    throw new Error("Replica schema version must be a positive integer.")
  }
  const databaseName = options.databaseName ?? "cypheria-client-replica"
  let database: IDBDatabase | null = null
  let opening: Promise<void> | null = null

  const current = (): IDBDatabase => {
    if (!database) throw new Error("Replica store has not been opened.")
    return database
  }

  const open = async (): Promise<void> => {
    opening ??= (async () => {
      const opened = await openReplicaDatabase(resolveIndexedDb(options.indexedDb), databaseName)
      await runTransaction(opened, [replicaRowsStore, replicaMetaStore], async (transaction) => {
        const storedVersion = await requestResult(
          transaction.objectStore(replicaMetaStore).get(replicaSchemaVersionKey)
        )
        if (storedVersion !== options.schemaVersion) {
          await requestResult(transaction.objectStore(replicaRowsStore).clear())
          await requestResult(
            transaction
              .objectStore(replicaMetaStore)
              .put(options.schemaVersion, replicaSchemaVersionKey)
          )
        }
      })
      opened.addEventListener("versionchange", () => opened.close())
      database = opened
    })()
    try {
      await opening
    } catch (error) {
      opening = null
      throw error
    }
  }

  const readRows = async (
    transaction: IDBTransaction,
    scopeId: string,
    entityTypes: readonly string[],
    entityIds?: readonly string[]
  ): Promise<ReplicaRow[]> => {
    const store = transaction.objectStore(replicaRowsStore)
    if (entityIds) {
      return (
        await Promise.all(
          entityTypes.flatMap((entityType) =>
            entityIds.map(async (entityId) => {
              const row = await requestResult<ReplicaRow | undefined>(
                store.get([scopeId, entityType, entityId])
              )
              return row ? [row] : []
            })
          )
        )
      ).flat()
    }
    return (
      await Promise.all(
        entityTypes.map((entityType) =>
          requestResult<ReplicaRow[]>(
            store.getAll(IDBKeyRange.bound([scopeId, entityType], [scopeId, entityType, []]))
          )
        )
      )
    ).flat()
  }

  return {
    open,
    async read(scopeId, entityTypes, entityIds) {
      if (entityTypes.length === 0 || entityIds?.length === 0) return []
      const transaction = current().transaction(replicaRowsStore, "readonly")
      const completion = transactionComplete(transaction)
      const rows = await readRows(transaction, scopeId, entityTypes, entityIds)
      await completion
      return rows.sort((left, right) => {
        const typeOrder = left.entityType.localeCompare(right.entityType)
        return typeOrder !== 0 ? typeOrder : left.entityId.localeCompare(right.entityId)
      })
    },
    async readAll() {
      const transaction = current().transaction(replicaRowsStore, "readonly")
      const completion = transactionComplete(transaction)
      const rows = await requestResult<ReplicaRow[]>(
        transaction.objectStore(replicaRowsStore).getAll()
      )
      await completion
      const scopes = new Map<string, ReplicaRow[]>()
      for (const row of rows) {
        const scopeRows = scopes.get(row.scopeId) ?? []
        scopeRows.push(row)
        scopes.set(row.scopeId, scopeRows)
      }
      return [...scopes]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([scopeId, scopeRows]): ReplicaScopeRows => ({ scopeId, rows: scopeRows }))
    },
    async apply(changes: ReplicaRowChanges) {
      await runTransaction(current(), replicaRowsStore, async (transaction) => {
        const rows = transaction.objectStore(replicaRowsStore)
        for (const key of changes.deletes) {
          await requestResult(rows.delete([key.scopeId, key.entityType, key.entityId]))
        }
        for (const row of changes.upserts) await requestResult(rows.put(row))
      })
    },
    async deleteScope(scopeId) {
      await runTransaction(current(), replicaRowsStore, async (transaction) => {
        await requestResult(
          transaction
            .objectStore(replicaRowsStore)
            .delete(IDBKeyRange.bound([scopeId], [scopeId, []]))
        )
      })
    },
    async renameScope(oldScopeId, newScopeId) {
      if (oldScopeId === newScopeId) return
      await runTransaction(current(), replicaRowsStore, async (transaction) => {
        const rows = transaction.objectStore(replicaRowsStore)
        const oldRows = await requestResult<ReplicaRow[]>(
          rows.getAll(IDBKeyRange.bound([oldScopeId], [oldScopeId, []]))
        )
        for (const row of oldRows) {
          await requestResult(rows.put({ ...row, scopeId: newScopeId }))
          await requestResult(rows.delete([row.scopeId, row.entityType, row.entityId]))
        }
      })
    },
    async clear() {
      await runTransaction(current(), replicaRowsStore, async (transaction) => {
        await requestResult(transaction.objectStore(replicaRowsStore).clear())
      })
    },
    async close() {
      database?.close()
      database = null
      opening = null
    },
  }
}

interface StoredAttachmentRecord extends AttachmentMetadata {
  readonly bytes: ArrayBuffer
}

export interface IndexedDbAttachmentStoreOptions {
  readonly databaseName?: string
  readonly indexedDb?: IDBFactory
}

const attachmentObjectStore = "attachments"

const openAttachmentDatabase = (
  indexedDb: IDBFactory,
  databaseName: string
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, 1)
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(attachmentObjectStore)) {
        request.result.createObjectStore(attachmentObjectStore, { keyPath: "storageKey" })
      }
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Failed to open the attachment database."))
    )
    request.addEventListener("blocked", () =>
      reject(new Error("Opening the attachment database was blocked."))
    )
  })

export function createIndexedDbAttachmentStore(
  options: IndexedDbAttachmentStoreOptions = {}
): AttachmentStore {
  const databaseName = options.databaseName ?? "cypheria-attachment-bytes"
  let databasePromise: Promise<IDBDatabase> | null = null
  const database = () => {
    databasePromise ??= openAttachmentDatabase(resolveIndexedDb(options.indexedDb), databaseName)
    return databasePromise
  }

  const attachmentRequest = async <Result>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>
  ): Promise<Result> => {
    const opened = await database()
    const transaction = opened.transaction(attachmentObjectStore, mode)
    const completion = transactionComplete(transaction)
    const result = await requestResult(operation(transaction.objectStore(attachmentObjectStore)))
    await completion
    return result
  }

  return {
    storageType: "web-indexeddb",
    async save(input) {
      const normalized = normalizeAttachmentInput(input)
      const metadata: AttachmentMetadata = {
        id: normalized.id,
        storageKey: normalized.id,
        storageType: "web-indexeddb",
        mediaType: normalized.mediaType,
        fileName: normalized.fileName,
        byteSize: normalized.bytes.byteLength,
        createdAt: normalized.createdAt,
      }
      const bytes = Uint8Array.from(normalized.bytes).buffer
      await attachmentRequest("readwrite", (store) =>
        store.put({ ...metadata, bytes } satisfies StoredAttachmentRecord)
      )
      return metadata
    },
    async read(attachment) {
      assertAttachmentStorageType(attachment, "web-indexeddb")
      const record = await attachmentRequest<StoredAttachmentRecord | undefined>(
        "readonly",
        (store) => store.get(attachment.storageKey)
      )
      if (!record) throw new Error(`Attachment '${attachment.id}' was not found.`)
      return new Uint8Array(record.bytes)
    },
    async delete(attachment) {
      assertAttachmentStorageType(attachment, "web-indexeddb")
      await attachmentRequest("readwrite", (store) => store.delete(attachment.storageKey))
    },
    async garbageCollect(referencedStorageKeys) {
      const opened = await database()
      await runTransaction(opened, attachmentObjectStore, async (transaction) => {
        const store = transaction.objectStore(attachmentObjectStore)
        const keys = await requestResult<IDBValidKey[]>(store.getAllKeys())
        for (const key of keys) {
          if (!referencedStorageKeys.has(String(key))) await requestResult(store.delete(key))
        }
      })
    },
  }
}
