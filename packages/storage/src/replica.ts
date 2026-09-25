import {
  createTextPreview,
  decodeStorageCursor,
  encodeStorageCursor,
  normalizeStoragePageRequest,
  type StoragePage,
  type StoragePageRequest,
} from "./inspection.js"

export interface ReplicaRowKey {
  readonly scopeId: string
  readonly entityType: string
  readonly entityId: string
}

export interface ReplicaRow extends ReplicaRowKey {
  readonly payload: string
}

export interface ReplicaRowChanges {
  readonly deletes: readonly ReplicaRowKey[]
  readonly upserts: readonly ReplicaRow[]
}

export interface ReplicaScopeRows {
  readonly scopeId: string
  readonly rows: readonly ReplicaRow[]
}

export interface ReplicaInspectionEntry extends ReplicaRowKey {
  readonly payloadLength: number
  readonly payloadPreview: string
  readonly payloadTruncated: boolean
}

/**
 * Durable, rebuildable client replica storage. Domain owners serialize and
 * validate payloads; the store owns keys, transactions, and schema reset.
 */
export interface ReplicaStore {
  open(): Promise<void>
  read(
    scopeId: string,
    entityTypes: readonly string[],
    entityIds?: readonly string[]
  ): Promise<ReplicaRow[]>
  readAll(): Promise<ReplicaScopeRows[]>
  listPage(request?: StoragePageRequest): Promise<StoragePage<ReplicaInspectionEntry>>
  apply(changes: ReplicaRowChanges): Promise<void>
  deleteScope(scopeId: string): Promise<void>
  renameScope(oldScopeId: string, newScopeId: string): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}

const compareRows = (left: ReplicaRow, right: ReplicaRow): number => {
  const scopeOrder = left.scopeId.localeCompare(right.scopeId)
  if (scopeOrder !== 0) return scopeOrder
  const typeOrder = left.entityType.localeCompare(right.entityType)
  return typeOrder !== 0 ? typeOrder : left.entityId.localeCompare(right.entityId)
}

const rowKey = ({ scopeId, entityType, entityId }: ReplicaRowKey): string =>
  JSON.stringify([scopeId, entityType, entityId])

export function createMemoryReplicaStore(): ReplicaStore {
  const rows = new Map<string, ReplicaRow>()
  let opened = false

  const assertOpen = () => {
    if (!opened) throw new Error("Replica store has not been opened.")
  }

  return {
    async open() {
      opened = true
    },
    async read(scopeId, entityTypes, entityIds) {
      assertOpen()
      if (entityTypes.length === 0 || entityIds?.length === 0) return []
      const acceptedTypes = new Set(entityTypes)
      const acceptedIds = entityIds ? new Set(entityIds) : null
      return [...rows.values()]
        .filter(
          (row) =>
            row.scopeId === scopeId &&
            acceptedTypes.has(row.entityType) &&
            (!acceptedIds || acceptedIds.has(row.entityId))
        )
        .sort(compareRows)
    },
    async readAll() {
      assertOpen()
      const scopes = new Map<string, ReplicaRow[]>()
      for (const row of [...rows.values()].sort(compareRows)) {
        const scopeRows = scopes.get(row.scopeId) ?? []
        scopeRows.push(row)
        scopes.set(row.scopeId, scopeRows)
      }
      return [...scopes].map(([scopeId, scopeRows]) => ({ scopeId, rows: scopeRows }))
    },
    async listPage(request = {}) {
      assertOpen()
      const { cursor, limit, query } = normalizeStoragePageRequest(request)
      const cursorParts = decodeStorageCursor(cursor, 3)
      const matching = [...rows.values()]
        .sort(compareRows)
        .filter((row) => {
          if (
            cursorParts &&
            compareRows(row, {
              scopeId: cursorParts[0] as string,
              entityType: cursorParts[1] as string,
              entityId: cursorParts[2] as string,
              payload: "",
            }) <= 0
          ) {
            return false
          }
          if (!query) return true
          return [row.scopeId, row.entityType, row.entityId, row.payload].some((value) =>
            value.toLocaleLowerCase().includes(query)
          )
        })
        .slice(0, limit + 1)
      const hasMore = matching.length > limit
      if (hasMore) matching.pop()
      return {
        items: matching.map((row) => {
          const payload = createTextPreview(row.payload)
          return {
            scopeId: row.scopeId,
            entityType: row.entityType,
            entityId: row.entityId,
            payloadLength: payload.length,
            payloadPreview: payload.preview,
            payloadTruncated: payload.truncated,
          }
        }),
        nextCursor:
          hasMore && matching.length
            ? encodeStorageCursor([
                (matching.at(-1) as ReplicaRow).scopeId,
                (matching.at(-1) as ReplicaRow).entityType,
                (matching.at(-1) as ReplicaRow).entityId,
              ])
            : null,
      }
    },
    async apply(changes) {
      assertOpen()
      for (const key of changes.deletes) rows.delete(rowKey(key))
      for (const row of changes.upserts) rows.set(rowKey(row), row)
    },
    async deleteScope(scopeId) {
      assertOpen()
      for (const [key, row] of rows) if (row.scopeId === scopeId) rows.delete(key)
    },
    async renameScope(oldScopeId, newScopeId) {
      assertOpen()
      if (oldScopeId === newScopeId) return
      const moved = [...rows.values()].filter((row) => row.scopeId === oldScopeId)
      for (const row of moved) {
        rows.set(rowKey({ ...row, scopeId: newScopeId }), { ...row, scopeId: newScopeId })
        rows.delete(rowKey(row))
      }
    },
    async clear() {
      assertOpen()
      rows.clear()
    },
    async close() {
      opened = false
    },
  }
}
