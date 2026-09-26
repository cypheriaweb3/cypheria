import { chmodSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { KeyValueStorage, ReplicaStore } from "@cypheria/storage"
import {
  createSqliteKeyValueStorage,
  createSqliteReplicaStore,
  type SqliteConnection,
  type SqliteDriver,
  type SqliteKeyValueStorage,
  type SqliteValue,
} from "@cypheria/storage/sqlite"

export interface DesktopClientStorageDatabase {
  readonly keyValue: KeyValueStorage
  readonly replica: ReplicaStore
  close(): Promise<void>
}

const toSqliteParameters = (params: readonly SqliteValue[]): SQLInputValue[] => [...params]

const createNodeSqliteConnection = (filePath: string): SqliteConnection => {
  mkdirSync(dirname(filePath), { mode: 0o700, recursive: true })
  const database = new DatabaseSync(filePath, {
    allowExtension: false,
    timeout: 5_000,
  })
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Windows does not implement POSIX file modes.
  }
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA synchronous = NORMAL")
  database.exec("PRAGMA foreign_keys = ON")

  let operationQueue: Promise<void> = Promise.resolve()
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error("Desktop client storage database is closed.")
  }

  const enqueue = <Result>(operation: () => Result | Promise<Result>): Promise<Result> => {
    const pending = operationQueue.then(operation, operation)
    operationQueue = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  const directConnection: SqliteConnection = {
    async exec(sql) {
      assertOpen()
      database.exec(sql)
    },
    async run(sql, params = []) {
      assertOpen()
      database.prepare(sql).run(...toSqliteParameters(params))
    },
    async all<Row>(sql: string, params: readonly SqliteValue[] = []) {
      assertOpen()
      return database.prepare(sql).all(...toSqliteParameters(params)) as Row[]
    },
    async transaction() {
      throw new Error("Nested desktop client storage transactions are not supported.")
    },
    async close() {
      // The queued public connection owns the database lifecycle.
    },
  }

  return {
    exec: (sql) => enqueue(() => directConnection.exec(sql)),
    run: (sql, params) => enqueue(() => directConnection.run(sql, params)),
    all: <Row>(sql: string, params?: readonly SqliteValue[]) =>
      enqueue(() => directConnection.all<Row>(sql, params)),
    transaction: (operation) =>
      enqueue(async () => {
        assertOpen()
        database.exec("BEGIN IMMEDIATE")
        try {
          await operation(directConnection)
          database.exec("COMMIT")
        } catch (error) {
          database.exec("ROLLBACK")
          throw error
        }
      }),
    close: () =>
      enqueue(() => {
        if (closed) return
        database.close()
        closed = true
      }),
  }
}

const createNodeSqliteDriver = (filePath: string): SqliteDriver => ({
  async open() {
    return createNodeSqliteConnection(filePath)
  },
})

export const createDesktopClientStorageDatabase = ({
  keyValueFilePath,
  replicaFilePath,
  replicaSchemaVersion = 1,
}: {
  readonly keyValueFilePath: string
  readonly replicaFilePath: string
  readonly replicaSchemaVersion?: number
}): DesktopClientStorageDatabase => {
  const keyValue: SqliteKeyValueStorage = createSqliteKeyValueStorage(
    createNodeSqliteDriver(keyValueFilePath)
  )
  const replica = createSqliteReplicaStore(
    createNodeSqliteDriver(replicaFilePath),
    replicaSchemaVersion
  )

  return {
    keyValue,
    replica,
    async close() {
      await Promise.all([keyValue.close(), replica.close()])
    },
  }
}
