import type { CypheriaRuntimePaths } from "@cypheria/runtime"
import BetterSqliteDatabase from "better-sqlite3"
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3"

import { buildDatabasePaths, type DatabasePathOptions } from "./paths.js"
import * as schema from "./schema.js"

export type CypheriaDatabase = BetterSQLite3Database<typeof schema>

export type OpenDatabaseOptions = (DatabasePathOptions | CypheriaRuntimePaths) & {
  readonly readonly?: boolean
}

export type OpenDatabaseResult = {
  readonly close: () => void
  readonly databaseFile: string
  readonly db: CypheriaDatabase
  readonly sqlite: BetterSqliteDatabase.Database
}

export const openCypheriaDatabase = (options: OpenDatabaseOptions = {}): OpenDatabaseResult => {
  const paths = buildDatabasePaths(options)
  const sqlite = new BetterSqliteDatabase(paths.databaseFile, {
    readonly: options.readonly,
  })

  if (!options.readonly) {
    sqlite.pragma("journal_mode = WAL")
    sqlite.pragma("foreign_keys = ON")
  }

  return {
    close: () => sqlite.close(),
    databaseFile: paths.databaseFile,
    db: drizzle(sqlite, { schema }),
    sqlite,
  }
}

export const createInMemoryDatabase = (): OpenDatabaseResult => {
  const sqlite = new BetterSqliteDatabase(":memory:")
  sqlite.pragma("foreign_keys = ON")

  return {
    close: () => sqlite.close(),
    databaseFile: ":memory:",
    db: drizzle(sqlite, { schema }),
    sqlite,
  }
}
