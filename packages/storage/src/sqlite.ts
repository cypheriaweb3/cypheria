import type { ReplicaRow, ReplicaRowChanges, ReplicaScopeRows, ReplicaStore } from "./replica.js"

export type ReplicaSqliteValue = string | number | null

export interface ReplicaSqliteConnection {
  exec(sql: string): Promise<void>
  run(sql: string, params?: readonly ReplicaSqliteValue[]): Promise<void>
  all<Row>(sql: string, params?: readonly ReplicaSqliteValue[]): Promise<Row[]>
  transaction(operation: (connection: ReplicaSqliteConnection) => Promise<void>): Promise<void>
  close(): Promise<void>
}

export interface ReplicaSqliteDriver {
  open(): Promise<ReplicaSqliteConnection>
}

interface StoredMeta {
  readonly value: string
}

interface StoredRow {
  readonly scope_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly payload: string
}

const createRowsSql = `
  CREATE TABLE IF NOT EXISTS client_replica_rows (
    scope_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (scope_id, entity_type, entity_id)
  )
`

const createMetaSql = `
  CREATE TABLE IF NOT EXISTS client_replica_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )
`

const toReplicaRow = (row: StoredRow): ReplicaRow => ({
  scopeId: row.scope_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  payload: row.payload,
})

export function createSqliteReplicaStore(
  driver: ReplicaSqliteDriver,
  schemaVersion: number
): ReplicaStore {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("Replica schema version must be a positive integer.")
  }
  let connection: ReplicaSqliteConnection | null = null
  let opening: Promise<void> | null = null

  const current = (): ReplicaSqliteConnection => {
    if (!connection) throw new Error("Replica store has not been opened.")
    return connection
  }

  const open = async (): Promise<void> => {
    opening ??= (async () => {
      const opened = await driver.open()
      try {
        await opened.exec(createMetaSql)
        const storedVersion = await opened.all<StoredMeta>(
          "SELECT value FROM client_replica_meta WHERE key = ?",
          ["schema_version"]
        )
        if (storedVersion[0]?.value !== String(schemaVersion)) {
          await opened.transaction(async (transaction) => {
            await transaction.exec("DROP TABLE IF EXISTS client_replica_rows")
            await transaction.exec(createRowsSql)
            await transaction.run("DELETE FROM client_replica_meta")
            await transaction.run("INSERT INTO client_replica_meta (key, value) VALUES (?, ?)", [
              "schema_version",
              String(schemaVersion),
            ])
          })
        } else {
          await opened.exec(createRowsSql)
        }
        connection = opened
      } catch (error) {
        await opened.close().catch(() => undefined)
        throw error
      }
    })()
    try {
      await opening
    } catch (error) {
      opening = null
      throw error
    }
  }

  const apply = async (changes: ReplicaRowChanges): Promise<void> => {
    await current().transaction(async (transaction) => {
      for (const key of changes.deletes) {
        await transaction.run(
          "DELETE FROM client_replica_rows WHERE scope_id = ? AND entity_type = ? AND entity_id = ?",
          [key.scopeId, key.entityType, key.entityId]
        )
      }
      for (const row of changes.upserts) {
        await transaction.run(
          `INSERT INTO client_replica_rows (scope_id, entity_type, entity_id, payload)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (scope_id, entity_type, entity_id)
           DO UPDATE SET payload = excluded.payload`,
          [row.scopeId, row.entityType, row.entityId, row.payload]
        )
      }
    })
  }

  return {
    open,
    async read(scopeId, entityTypes, entityIds) {
      if (entityTypes.length === 0 || entityIds?.length === 0) return []
      const typePlaceholders = entityTypes.map(() => "?").join(", ")
      const idClause = entityIds ? ` AND entity_id IN (${entityIds.map(() => "?").join(", ")})` : ""
      const rows = await current().all<StoredRow>(
        `SELECT scope_id, entity_type, entity_id, payload FROM client_replica_rows
         WHERE scope_id = ? AND entity_type IN (${typePlaceholders})${idClause}
         ORDER BY entity_type, entity_id`,
        [scopeId, ...entityTypes, ...(entityIds ?? [])]
      )
      return rows.map(toReplicaRow)
    },
    async readAll() {
      const rows = await current().all<StoredRow>(
        `SELECT scope_id, entity_type, entity_id, payload FROM client_replica_rows
         ORDER BY scope_id, entity_type, entity_id`
      )
      const scopes = new Map<string, ReplicaRow[]>()
      for (const storedRow of rows) {
        const row = toReplicaRow(storedRow)
        const scopeRows = scopes.get(row.scopeId) ?? []
        scopeRows.push(row)
        scopes.set(row.scopeId, scopeRows)
      }
      return [...scopes].map(
        ([scopeId, scopeRows]): ReplicaScopeRows => ({ scopeId, rows: scopeRows })
      )
    },
    apply,
    async deleteScope(scopeId) {
      await current().run("DELETE FROM client_replica_rows WHERE scope_id = ?", [scopeId])
    },
    async renameScope(oldScopeId, newScopeId) {
      if (oldScopeId === newScopeId) return
      await current().transaction(async (transaction) => {
        await transaction.run(
          `INSERT INTO client_replica_rows (scope_id, entity_type, entity_id, payload)
           SELECT ?, entity_type, entity_id, payload FROM client_replica_rows WHERE scope_id = ?
           ON CONFLICT (scope_id, entity_type, entity_id)
           DO UPDATE SET payload = excluded.payload`,
          [newScopeId, oldScopeId]
        )
        await transaction.run("DELETE FROM client_replica_rows WHERE scope_id = ?", [oldScopeId])
      })
    },
    async clear() {
      await current().run("DELETE FROM client_replica_rows")
    },
    async close() {
      const opened = connection
      connection = null
      opening = null
      if (opened) await opened.close()
    },
  }
}
