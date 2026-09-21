import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createInMemoryDatabase,
} from "@cypheria/db"
import type { AgentId } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import type { AgentInstallReceipt } from "./agent-installer.js"
import { AgentManager } from "./agent-manager.js"
import { NATIVE_AGENT_MANIFEST } from "./native-agent-manifest.js"

const homes: string[] = []

const receipt = (agentId: "claude" | "codex"): AgentInstallReceipt => ({
  agentId,
  args: [],
  command: `/managed/${agentId}`,
  installedAt: new Date().toISOString(),
  integrity: "not-applicable",
  kind: "npx",
  source: agentId,
  version: NATIVE_AGENT_MANIFEST[agentId].cliVersion,
})

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
    const installedReceipts = new Map<AgentId, AgentInstallReceipt>()
    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      installer: {
        cleanupInterrupted: async () => undefined,
        install: async (agentId) => {
          const installed: AgentInstallReceipt = {
            agentId,
            args: [],
            command: `/managed/${agentId}`,
            installedAt: new Date().toISOString(),
            integrity: "not-applicable",
            kind: "npx",
            source: agentId,
            version: "1.0.0",
          }
          installedReceipts.set(agentId, installed)
          return installed
        },
        readCurrent: async (agentId) => installedReceipts.get(agentId),
        uninstall: async (agentId) => {
          installedReceipts.delete(agentId)
        },
      },
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

      await manager.handleManagement(
        {
          payload: { agentId: available.id },
          requestId: `install-${available.id}`,
          type: "agent.install.request",
        },
        { send: () => undefined, sessionId: "session" }
      )
      await expect
        .poll(async () => await manager.get(available.id, "session"))
        .toMatchObject({
          enabled: true,
          installed: true,
        })
      await manager.handleManagement(
        {
          payload: { agentId: available.id },
          requestId: `uninstall-${available.id}`,
          type: "agent.uninstall.request",
        },
        { send: () => undefined, sessionId: "session" }
      )
      await expect
        .poll(async () => await manager.get(available.id, "session"))
        .toMatchObject({
          enabled: false,
          installed: false,
        })
      await expect(persistence.get(available.id)).resolves.toBeDefined()
      expect(manager.availableAgents().some(({ id }) => id === available.id)).toBe(false)

      await expect(manager.remove(available.id)).resolves.toEqual({ agentId: available.id })
      await expect(persistence.get(available.id)).resolves.toBeUndefined()
      expect(manager.availableAgents().some(({ id }) => id === available.id)).toBe(true)
    } finally {
      await manager.stop()
      database.close()
    }
  })

  it("runs installations for different agents independently", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-concurrent-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const releases = new Map<string, () => void>()
    const started: string[] = []
    const receipts = new Map<string, AgentInstallReceipt>()
    const installer = {
      cleanupInterrupted: async () => undefined,
      install: async (agentId: AgentId) => {
        if (agentId !== "claude" && agentId !== "codex") throw new Error("Unexpected agent")
        started.push(agentId)
        await new Promise<void>((resolvePromise) => releases.set(agentId, resolvePromise))
        const installed = receipt(agentId)
        receipts.set(agentId, installed)
        return installed
      },
      readCurrent: async (agentId: string) => receipts.get(agentId),
      uninstall: async () => undefined,
    }
    const manager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      installer,
      networkBootstrap: false,
      persistence: createAgentRegistryPersistenceService(database.db),
      publish: () => undefined,
    })
    await manager.start()
    try {
      for (const agentId of ["codex", "claude"] as const) {
        await manager.handleManagement(
          {
            payload: { agentId },
            requestId: `install-${agentId}`,
            type: "agent.install.request",
          },
          { send: () => undefined, sessionId: "session" }
        )
      }

      await expect.poll(() => started).toEqual(["codex", "claude"])
      const duplicateResponses: unknown[] = []
      await manager.handleManagement(
        {
          payload: { agentId: "codex" },
          requestId: "install-codex-again",
          type: "agent.install.request",
        },
        { send: (message) => duplicateResponses.push(message), sessionId: "session" }
      )
      expect(duplicateResponses.at(-1)).toMatchObject({
        payload: {
          error: { code: "AGENT_OPERATION_IN_PROGRESS" },
          ok: false,
        },
      })
      await expect(manager.remove("codex")).rejects.toMatchObject({
        name: "AGENT_OPERATION_IN_PROGRESS",
      })
      await expect(manager.setEnabled("codex", true, "session")).rejects.toMatchObject({
        name: "AGENT_OPERATION_IN_PROGRESS",
      })
      releases.get("codex")?.()
      releases.get("claude")?.()
      await expect.poll(async () => (await manager.get("codex", "session")).installed).toBe(true)
      await expect.poll(async () => (await manager.get("claude", "session")).installed).toBe(true)
      await expect.poll(async () => (await manager.get("codex", "session")).enabled).toBe(true)
      await expect.poll(async () => (await manager.get("claude", "session")).enabled).toBe(true)
    } finally {
      await manager.stop()
      database.close()
    }
  })

  it("waits for turns, stops old sessions, then resumes them after an update", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-manager-update-"))
    homes.push(home)
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const persistence = createAgentRegistryPersistenceService(database.db)
    let finishWaiting: () => void = () => undefined
    const turnsFinished = new Promise<void>((resolvePromise) => {
      finishWaiting = resolvePromise
    })
    const installCalls: string[] = []
    let current = receipt("codex")
    await persistence.reconcile([{ id: "codex", native: true }])
    await persistence.setVersion("codex", {
      description: "Codex",
      icon: null,
      name: "Codex",
      repository: null,
      version: "0.1.0",
      website: null,
    })

    const updatingManager = new AgentManager({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      installer: {
        cleanupInterrupted: async () => undefined,
        install: async (agentId) => {
          installCalls.push(agentId)
          current = receipt("codex")
          return current
        },
        readCurrent: async () => current,
        uninstall: async () => undefined,
      },
      networkBootstrap: false,
      persistence,
      publish: () => undefined,
    })
    await updatingManager.start()
    const resumed: string[][] = []
    updatingManager.setThreadCoordinator({
      closeAgentThreads: async () => undefined,
      hasActiveThreads: async () => true,
      resumeAgentThreads: async (threadIds) => {
        resumed.push([...threadIds])
      },
      suspendAgentThreads: async () => ["thread-1"],
      waitForAgentTurns: async () => turnsFinished,
    })
    try {
      await updatingManager.handleManagement(
        {
          payload: { agentId: "codex" },
          requestId: "update-codex",
          type: "agent.update.request",
        },
        { send: () => undefined, sessionId: "session" }
      )
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
      expect(installCalls).toEqual([])

      finishWaiting()
      await expect.poll(() => installCalls).toEqual(["codex"])
      await expect.poll(() => resumed).toEqual([["thread-1"]])
    } finally {
      await updatingManager.stop()
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

  it("only changes enablement while installed and keeps registration after uninstall", async () => {
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
      await expect(manager.remove("codex")).rejects.toMatchObject({ name: "AGENT_INSTALLED" })
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
      await expect
        .poll(async () => {
          try {
            await manager.setEnabled("codex", true, "session")
            return "enabled"
          } catch (error) {
            return error instanceof Error ? error.name : String(error)
          }
        })
        .toBe("AGENT_NOT_INSTALLED")
      await expect(manager.setEnabled("codex", false, "session")).rejects.toMatchObject({
        name: "AGENT_NOT_INSTALLED",
      })
      expect(manager.availableAgents().some(({ id }) => id === "codex")).toBe(false)
      await expect(manager.remove("codex")).resolves.toEqual({ agentId: "codex" })
      await expect(persistence.get("codex")).resolves.toBeUndefined()
      expect(manager.availableAgents().some(({ id }) => id === "codex")).toBe(true)
    } finally {
      await manager.stop()
      database.close()
    }
  })
})
