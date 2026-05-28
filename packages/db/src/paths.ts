import { join } from "node:path"

import {
  buildRuntimePaths,
  type CypheriaRuntimePaths,
  type RuntimeHomeOptions,
} from "@cypheria/runtime"

export const DEFAULT_DATABASE_FILENAME = "cypheria.sqlite"
export const DEFAULT_MIGRATIONS_DIRNAME = "migrations"

export type DatabasePathOptions = RuntimeHomeOptions & {
  readonly databaseFilename?: string
  readonly migrationsDirname?: string
}

export type DatabasePaths = {
  readonly databaseFile: string
  readonly dbDir: string
  readonly migrationsDir: string
}

const isRuntimePaths = (value: unknown): value is CypheriaRuntimePaths =>
  typeof value === "object" &&
  value !== null &&
  "cypheriaHome" in value &&
  "dbDir" in value &&
  "codexHome" in value

export const buildDatabasePaths = (
  options: DatabasePathOptions | CypheriaRuntimePaths = {}
): DatabasePaths => {
  const runtimePaths = isRuntimePaths(options) ? options : buildRuntimePaths(options)
  const databaseFilename = isRuntimePaths(options)
    ? DEFAULT_DATABASE_FILENAME
    : (options.databaseFilename ?? DEFAULT_DATABASE_FILENAME)
  const migrationsDirname = isRuntimePaths(options)
    ? DEFAULT_MIGRATIONS_DIRNAME
    : (options.migrationsDirname ?? DEFAULT_MIGRATIONS_DIRNAME)

  return {
    databaseFile: join(runtimePaths.dbDir, databaseFilename),
    dbDir: runtimePaths.dbDir,
    migrationsDir: join(runtimePaths.dbDir, migrationsDirname),
  }
}
