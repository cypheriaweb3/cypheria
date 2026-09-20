import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createInMemoryDatabase,
} from "@cypheria/db"
import { afterEach, describe, expect, it } from "vitest"

import { AgentManager } from "./agent-manager.js"
import { NATIVE_AGENT_MANIFEST } from "./native-agent-manifest.js"

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("AgentManager enable gate", () => {
  it("seeds only native records and persists a catalog agent when the user adds it", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-registry-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await mkdir(join(home, "agents"), { recursive: true })
    await writeFile(
      join(home, "agents", "registry.json"),
      JSON.stringify({
        agents: [
          {
            description: "Gemini CLI",
            distribution: { npx: { package: "@google/gemini-cli@1.0.0" } },
            id: "gemini",
            license_url: "https://github.com/google-gemini/gemini-cli/blob/main/LICENSE",
            name: "Gemini CLI",
            version: "1.0.0",
          },
        ],
        extensions: [],
        version: "1.0.0",
      })
    )
    const persistence = createAgentRegistryPersistenceService(database.db)
    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      networkBootstrap: false,
      persistence,
      publish: () => undefined,
    })
    await manager.start()
    try {
      expect((await persistence.list()).map(({ id }) => id)).toEqual([
        "claude",
        "codex",
        "opencode",
        "pi",
      ])
      const available = manager.availableAgents().find(({ native }) => !native)
      expect(available?.description).toBeTruthy()
      if (!available) throw new Error("Expected a registry catalog entry")

      const added = await manager.add(available.id, "session")
      expect(added).toMatchObject({ id: available.id, installed: false, native: false })
      expect(await persistence.get(available.id)).toMatchObject({
        createdAt: expect.any(String),
        description: available.description,
        name: available.name,
      })
      expect(manager.availableAgents().some(({ id }) => id === available.id)).toBe(false)
    } finally {
      await manager.stop()
      database.close()
    }
  })

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
        availableVersion: "0.155.1",
        installed: false,
        name: "Codex",
        repository: "https://github.com/openai/codex",
        version: "0.155.1",
        website: "https://developers.openai.com/codex/",
      })
    } finally {
      await manager.stop()
      database.close()
    }
  })

  it("uses the integrated OpenCode v2 release instead of an ACP registry entry", async () => {
    expect(NATIVE_AGENT_MANIFEST.opencode).toMatchObject({
      cliPackage: "@opencode/cli",
      cliVersion: "2.0.11",
      launcher: "executable",
    })
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-opencode-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await mkdir(join(home, "agents"), { recursive: true })
    await writeFile(
      join(home, "agents", "registry.json"),
      JSON.stringify({
        agents: [
          {
            description: "Registry OpenCode entry",
            distribution: { npx: { package: "@registry/opencode@9.9.9" } },
            id: "opencode",
            license_url: "https://github.com/anomalyco/opencode/blob/dev/LICENSE",
            name: "Registry OpenCode",
            version: "9.9.9",
          },
        ],
        extensions: [],
        version: "1.0.0",
      })
    )
    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      networkBootstrap: false,
      persistence: createAgentRegistryPersistenceService(database.db),
      publish: () => undefined,
    })
    await manager.start()
    try {
      expect(await manager.get("opencode", "session")).toMatchObject({
        availableVersion: "2.0.11",
        description: expect.not.stringContaining("Registry"),
        name: "OpenCode",
        native: true,
        version: "2.0.11",
        website: "https://opencode.ai/v2/docs/",
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
        availableVersion: "0.155.1",
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
