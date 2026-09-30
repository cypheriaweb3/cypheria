import { beforeEach, describe, expect, it } from "vitest"

import { createInMemoryDatabase, type OpenDatabaseResult } from "./client.js"
import { createPluginMarketplacePersistenceService } from "./plugin-marketplace.js"

describe("plugin marketplace persistence", () => {
  let database: OpenDatabaseResult

  beforeEach(async () => {
    database = createInMemoryDatabase()
    await database.client.execute(`
      CREATE TABLE plugin_marketplaces (
        name text PRIMARY KEY NOT NULL,
        source text NOT NULL,
        ref_name text,
        sparse_paths text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `)
  })

  it("keeps the source a marketplace was added from and replaces it on re-add", async () => {
    const service = createPluginMarketplacePersistenceService(database.db)
    await service.upsert(
      { name: "team", refName: "v1", source: "acme/team", sparsePaths: [".claude-plugin"] },
      "2026-10-01T00:00:00.000Z"
    )
    await service.upsert({ name: "team", source: "acme/team-next" }, "2026-10-02T00:00:00.000Z")
    expect(await service.get("team")).toEqual({
      createdAt: "2026-10-01T00:00:00.000Z",
      name: "team",
      refName: null,
      source: "acme/team-next",
      sparsePaths: null,
      updatedAt: "2026-10-02T00:00:00.000Z",
    })
    expect((await service.list()).map((record) => record.name)).toEqual(["team"])
  })

  it("removes a recorded marketplace once", async () => {
    const service = createPluginMarketplacePersistenceService(database.db)
    await service.upsert({ name: "team", source: "acme/team" })
    expect(await service.remove("team")).toBe(true)
    expect(await service.remove("team")).toBe(false)
    expect(await service.get("team")).toBeUndefined()
  })
})
