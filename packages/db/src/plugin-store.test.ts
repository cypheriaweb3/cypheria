import { beforeEach, describe, expect, it } from "vitest"

import { createInMemoryDatabase, type OpenDatabaseResult } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createPluginPersistenceService } from "./plugin-store.js"

const marketplace = {
  displayName: "Team",
  id: "team",
  isBuiltin: false,
  localPath: "/home/.cypheria/marketplaces/team",
  ownerAgentId: null,
  refName: "v1",
  source: "acme/team",
  sparsePaths: [".claude-plugin"],
}

const plugin = {
  description: null,
  detectedFormats: ["agent_plugin" as const, "claude" as const],
  displayName: "Review",
  id: "review@team",
  installPath: "/home/.cypheria/marketplaces/team/review",
  installSourceType: "local" as const,
  installSourceUrl: "./review",
  marketplaceId: "team",
  pluginName: "review",
  version: "1.0.0",
}

describe("plugin persistence", () => {
  let database: OpenDatabaseResult

  beforeEach(async () => {
    database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
  })

  it("replaces a marketplace on re-add and keeps its creation time", async () => {
    const service = createPluginPersistenceService(database.db)
    await service.marketplaces.upsert(marketplace, "2026-10-01T00:00:00.000Z")
    await service.marketplaces.upsert(
      { ...marketplace, refName: null, source: "acme/team-next", sparsePaths: null },
      "2026-10-02T00:00:00.000Z"
    )
    expect(await service.marketplaces.get("team")).toEqual({
      ...marketplace,
      createdAt: "2026-10-01T00:00:00.000Z",
      refName: null,
      source: "acme/team-next",
      sparsePaths: null,
      updatedAt: "2026-10-02T00:00:00.000Z",
    })
    expect(await service.marketplaces.remove("team")).toBe(true)
    expect(await service.marketplaces.remove("team")).toBe(false)
  })

  it("keeps one binding per plugin and Agent and cascades removals", async () => {
    const service = createPluginPersistenceService(database.db)
    await service.marketplaces.upsert(marketplace)
    await service.plugins.upsert(plugin)
    await service.bindings.upsert({
      agentId: "codex",
      enabled: true,
      installedSha256: null,
      nativeInstallReceipt: { nativeId: "review@team" },
      pluginId: plugin.id,
      statusMessage: null,
    })
    await service.bindings.upsert({
      agentId: "goose",
      enabled: false,
      installedSha256: null,
      nativeInstallReceipt: null,
      pluginId: plugin.id,
      statusMessage: null,
    })
    await service.bindings.upsert({
      agentId: "goose",
      enabled: true,
      installedSha256: null,
      nativeInstallReceipt: { nativeId: "review" },
      pluginId: plugin.id,
      statusMessage: null,
    })
    expect(await service.bindings.list({ pluginId: plugin.id })).toHaveLength(2)
    expect(await service.bindings.get(plugin.id, "goose")).toMatchObject({
      enabled: true,
      installedSha256: null,
      nativeInstallReceipt: { nativeId: "review" },
    })
    expect((await service.plugins.get(plugin.id))?.detectedFormats).toEqual([
      "agent_plugin",
      "claude",
    ])

    await database.client.execute("PRAGMA foreign_keys = ON")
    await service.marketplaces.remove("team")
    expect(await service.plugins.list()).toEqual([])
    expect(await service.bindings.list()).toEqual([])
  })
})
