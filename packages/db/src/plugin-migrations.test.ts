import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

/** A copy of the migrations folder that stops before the migration tagged `tag`. */
const migrationsBefore = async (tag: string): Promise<string> => {
  const folder = await mkdtemp(join(tmpdir(), "cypheria-migrations-"))
  await cp(migrationsFolder, folder, { recursive: true })
  const journalPath = join(folder, "meta", "_journal.json")
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] }
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((entry) => entry.tag === tag)
  )
  await writeFile(journalPath, JSON.stringify(journal))
  return folder
}

describe("plugin migrations", () => {
  it("start the plugin tables over a database that already holds an earlier shape of them", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client, {
      migrationsFolder: await migrationsBefore("0012_polyglot-plugins"),
    })
    await database.client.execute(
      "CREATE TABLE installed_plugins (id text PRIMARY KEY NOT NULL, install_path text NOT NULL)"
    )
    await database.client.execute(
      "CREATE TABLE plugin_agent_bindings (plugin_id text NOT NULL, execution_mode text NOT NULL)"
    )

    await applyDatabaseMigrations(database.client)
    const columns = await database.client.execute("PRAGMA table_info(installed_plugins)")
    const installPath = columns.rows.find((row) => row.name === "install_path")
    expect(installPath?.notnull).toBe(0)
    const bindings = await database.client.execute("PRAGMA table_info(plugin_agent_bindings)")
    expect(bindings.rows.map((row) => row.name)).toContain("installed_sha256")
    expect(bindings.rows.map((row) => row.name)).not.toContain("execution_mode")
  })
})
