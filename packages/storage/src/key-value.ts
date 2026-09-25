import {
  createTextPreview,
  decodeStorageCursor,
  encodeStorageCursor,
  normalizeStoragePageRequest,
  type StoragePage,
  type StoragePageRequest,
} from "./inspection.js"

export type KeyValueStorageListener = (value: string | null) => void

export interface KeyValueInspectionEntry {
  readonly key: string
  readonly valueLength: number
  readonly valuePreview: string
  readonly valueTruncated: boolean
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  listPage(request?: StoragePageRequest): Promise<StoragePage<KeyValueInspectionEntry>>
  subscribe?(key: string, listener: KeyValueStorageListener): () => void
}

export class StorageUnavailableError extends Error {
  constructor(message = "Client key-value storage is unavailable in this runtime.") {
    super(message)
    this.name = "StorageUnavailableError"
  }
}

export function createMemoryKeyValueStorage(
  initialValues: Readonly<Record<string, string>> = {}
): KeyValueStorage & { snapshot(): ReadonlyMap<string, string> } {
  const values = new Map(Object.entries(initialValues))
  const listeners = new Map<string, Set<KeyValueStorageListener>>()

  const emit = (key: string, value: string | null) => {
    for (const listener of listeners.get(key) ?? []) listener(value)
  }

  return {
    async getItem(key) {
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      values.set(key, value)
      emit(key, value)
    },
    async removeItem(key) {
      values.delete(key)
      emit(key, null)
    },
    async listPage(request = {}) {
      const { cursor, limit, query } = normalizeStoragePageRequest(request)
      const cursorKey = decodeStorageCursor(cursor, 1)?.[0] ?? null
      const matchingKeys = [...values.keys()]
        .filter(
          (key) =>
            (cursorKey === null || key > cursorKey) &&
            (!query || key.toLocaleLowerCase().includes(query))
        )
        .sort()
      const pageKeys = matchingKeys.slice(0, limit + 1)
      const hasMore = pageKeys.length > limit
      if (hasMore) pageKeys.pop()
      const items = pageKeys.map((key) => {
        const value = values.get(key) ?? ""
        const preview = createTextPreview(value)
        return {
          key,
          valueLength: preview.length,
          valuePreview: preview.preview,
          valueTruncated: preview.truncated,
        }
      })
      return {
        items,
        nextCursor:
          hasMore && pageKeys.length ? encodeStorageCursor([pageKeys.at(-1) as string]) : null,
      }
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
    snapshot() {
      return new Map(values)
    },
  }
}
