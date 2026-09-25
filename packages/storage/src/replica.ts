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
