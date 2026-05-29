import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const DEFAULT_DATABASE_FILENAME = "cypheria.sqlite"
export const DEFAULT_MIGRATIONS_DIRNAME = "migrations"
export const DEFAULT_CYPHERIA_HOME_BASENAME = ".cypheria"
export const CYPHERIA_HOME_ENV = "CYPHERIA_HOME"

export type DatabasePathEnv = Record<string, string | undefined>

export type DatabasePathOptions = {
  readonly cypheriaHome?: string
  readonly databaseFilename?: string
  readonly dbDir?: string
  readonly env?: DatabasePathEnv
  readonly homeDir?: string
  readonly migrationsDirname?: string
}

export type DatabasePaths = {
  readonly databaseFile: string
  readonly dbDir: string
  readonly migrationsDir: string
}

const getConfiguredHome = (env: DatabasePathEnv): string | undefined => {
  const value = env[CYPHERIA_HOME_ENV]?.trim()
  return value ? value : undefined
}

const resolveDatabaseHome = (options: DatabasePathOptions): string => {
  if (options.cypheriaHome?.trim()) {
    return resolve(options.cypheriaHome)
  }

  const configuredHome = getConfiguredHome(options.env ?? process.env)
  if (configuredHome) {
    return resolve(configuredHome)
  }

  return resolve(options.homeDir ?? homedir(), DEFAULT_CYPHERIA_HOME_BASENAME)
}

export const buildDatabasePaths = (options: DatabasePathOptions = {}): DatabasePaths => {
  const dbDir = options.dbDir ? resolve(options.dbDir) : resolve(resolveDatabaseHome(options), "db")
  const databaseFilename = options.databaseFilename ?? DEFAULT_DATABASE_FILENAME
  const migrationsDirname = options.migrationsDirname ?? DEFAULT_MIGRATIONS_DIRNAME

  return {
    databaseFile: join(dbDir, databaseFilename),
    dbDir,
    migrationsDir: join(dbDir, migrationsDirname),
  }
}
