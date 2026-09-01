import { fileURLToPath } from "node:url"

import type { Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"

import * as schema from "./schema/index.js"

const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export type ApplyDatabaseMigrationsOptions = {
  readonly migrationsFolder?: string
}

/** Apply the SQL migrations generated from `src/schema/index.ts` by Drizzle Kit. */
export const applyDatabaseMigrations = async (
  client: Client,
  options: ApplyDatabaseMigrationsOptions = {}
): Promise<void> => {
  await client.execute("PRAGMA foreign_keys = ON")
  await migrate(drizzle(client, { schema }), {
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
  })
}
