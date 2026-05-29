import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { buildDatabasePaths } from "./paths.js"

describe("database paths", () => {
  it("uses an explicit database directory without depending on runtime paths", () => {
    const paths = buildDatabasePaths({
      databaseFilename: "test.sqlite",
      dbDir: "/tmp/cypheria-db",
      migrationsDirname: "db-migrations",
    })

    expect(paths).toEqual({
      databaseFile: join(resolve("/tmp/cypheria-db"), "test.sqlite"),
      dbDir: resolve("/tmp/cypheria-db"),
      migrationsDir: join(resolve("/tmp/cypheria-db"), "db-migrations"),
    })
  })

  it("falls back to CYPHERIA_HOME when no dbDir is provided", () => {
    const paths = buildDatabasePaths({
      env: { CYPHERIA_HOME: "/tmp/cypheria-home" },
    })

    expect(paths.dbDir).toBe(resolve("/tmp/cypheria-home", "db"))
  })
})
