import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createInMemoryDatabase,
} from "@cypheria/db"
import { afterEach, describe, expect, it } from "vitest"

import { AgentManager } from "./agent-manager.js"

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("AgentManager enable gate", () => {
  it("returns a non-null native version before installation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-version-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      networkBootstrap: false,
      persistence: createAgentRegistryPersistenceService(database.db),
      publish: () => undefined,
    })
    await manager.start()
    try {
      expect(await manager.get("codex", "session")).toMatchObject({
        availableVersion: "0.153.4",
        installed: false,
        name: "Codex",
        repository: "https://github.com/openai/codex",
        version: "0.153.4",
        website: "https://developers.openai.com/codex/",
      })
    } finally {
      await manager.stop()
      database.close()
    }
  })

  it("requires the separate enable operation before an installed agent can start", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const persistence = createAgentRegistryPersistenceService(database.db)
    await persistence.reconcile([{ id: "codex", native: true }])
    await persistence.setVersion("codex", {
      description: "OpenAI Codex",
      icon: null,
      name: "Codex",
      repository: "https://github.com/openai/codex",
      version: "0.153.4",
      website: null,
    })

    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      networkBootstrap: false,
      persistence,
      publish: () => undefined,
    })
    await manager.start()
    try {
      await expect(manager.startAgent("codex", "session")).rejects.toMatchObject({
        name: "AGENT_DISABLED",
      })

      const enabled = await manager.setEnabled("codex", true, "session")
      expect(enabled.enabled).toBe(true)
      await expect(manager.startAgent("codex", "session")).rejects.toMatchObject({
        name: "AGENT_NOT_INSTALLED",
      })

      await manager.handleManagement(
        {
          payload: { agentId: "codex" },
          requestId: "uninstall-codex",
          type: "agent.uninstall.request",
        },
        { send: () => undefined, sessionId: "session" }
      )
      await expect.poll(async () => (await persistence.get("codex"))?.installed).toBe(false)
      expect(await persistence.get("codex")).toMatchObject({
        enabled: false,
        installed: false,
        version: "0.153.4",
      })
      expect(await manager.get("codex", "session")).toMatchObject({
        enabled: false,
        installed: false,
        version: "0.153.4",
      })
    } finally {
      await manager.stop()
      database.close()
    }
  })
})
