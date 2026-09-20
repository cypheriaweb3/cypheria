import { beforeEach, describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { createInMemoryDatabase, type OpenDatabaseResult } from "./client.js"
import { agentRegistry } from "./schema/index.js"

describe("agent registry persistence", () => {
  let database: OpenDatabaseResult

  beforeEach(async () => {
    database = createInMemoryDatabase()
    await database.client.execute(`
      CREATE TABLE agent_registry (
        id text PRIMARY KEY NOT NULL,
        name text,
        version text,
        description text,
        repository text,
        website text,
        icon text,
        native integer NOT NULL,
        installed integer DEFAULT false NOT NULL,
        enabled integer DEFAULT false NOT NULL,
        created_at text NOT NULL,
        removed_at text,
        updated_at text NOT NULL
      )
    `)
  })

  it("reconciles without overwriting user state", async () => {
    const service = createAgentRegistryPersistenceService(database.db)
    await service.reconcile([{ id: "codex", native: true }], "2026-09-17T00:00:00.000Z")
    await service.setVersion("codex", {
      description: "OpenAI Codex",
      icon: null,
      name: "Codex",
      repository: "https://github.com/openai/codex",
      version: "0.153.4",
      website: null,
    })
    await service.setEnabled("codex", true)
    await service.reconcile([{ id: "codex", native: false }], "2026-09-18T00:00:00.000Z")

    expect(await service.get("codex")).toMatchObject({
      enabled: true,
      createdAt: "2026-09-17T00:00:00.000Z",
      description: "OpenAI Codex",
      installed: true,
      name: "Codex",
      native: true,
      version: "0.153.4",
    })

    await service.setInstalled("codex", false)
    expect(await service.get("codex")).toMatchObject({
      enabled: false,
      installed: false,
      version: "0.153.4",
    })
  })

  it("uses disabled and uninstalled defaults", async () => {
    const service = createAgentRegistryPersistenceService(database.db)
    await service.reconcile([{ id: "qwen-code", native: false }])
    expect(await database.db.select().from(agentRegistry)).toEqual([
      expect.objectContaining({ enabled: false, installed: false, version: null }),
    ])
    await expect(service.setEnabled("qwen-code", true)).resolves.toBeUndefined()
    await expect(service.setEnabled("qwen-code", false)).resolves.toBeUndefined()
    database.close()
  })

  it("registers user-selected agents with metadata and removes them", async () => {
    const service = createAgentRegistryPersistenceService(database.db)
    const record = await service.register(
      "gemini",
      false,
      {
        description: "Gemini CLI",
        icon: "https://example.com/gemini.svg",
        name: "Gemini CLI",
        repository: "https://example.com/repository",
        website: "https://example.com",
      },
      "2026-09-20T00:00:00.000Z"
    )

    expect(record).toMatchObject({
      createdAt: "2026-09-20T00:00:00.000Z",
      description: "Gemini CLI",
      installed: false,
      native: false,
    })
    await expect(service.remove("gemini")).resolves.toBe(true)
    await expect(service.get("gemini")).resolves.toBeUndefined()
  })
})
