import { type Client, createClient } from "@libsql/client/sqlite3"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"

import { buildDatabasePaths, type DatabasePathOptions } from "./paths.js"
import * as schema from "./schema/index.js"

export type CypheriaDatabase = LibSQLDatabase<typeof schema>

export type OpenDatabaseOptions = DatabasePathOptions

export type OpenDatabaseResult = {
  readonly client: Client
  readonly close: () => void
  readonly databaseFile: string
  readonly db: CypheriaDatabase
}

export const openCypheriaDatabase = (options: OpenDatabaseOptions = {}): OpenDatabaseResult => {
  const paths = buildDatabasePaths(options)
  const client = createClient({ url: `file:${paths.databaseFile}` })

  return {
    client,
    close: () => client.close(),
    databaseFile: paths.databaseFile,
    db: drizzle(client, { schema }),
  }
}

export const createInMemoryDatabase = (): OpenDatabaseResult => {
  const client = createClient({ url: ":memory:" })

  return {
    client,
    close: () => client.close(),
    databaseFile: ":memory:",
    db: drizzle(client, { schema }),
  }
}
