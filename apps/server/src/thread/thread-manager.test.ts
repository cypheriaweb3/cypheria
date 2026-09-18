import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createThreadLifecyclePersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { AgentId, ServerMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ThreadProviderAdapter,
  ThreadProviderCreateInput,
  ThreadProviderEvent,
} from "./provider-adapter.js"
import { ThreadManager } from "./thread-manager.js"

class FakeAdapter implements ThreadProviderAdapter {
  readonly agentId: AgentId = "codex"
  readonly events = new Map<string, (event: ThreadProviderEvent) => void>()
  deleteError: Error | undefined

  async close(): Promise<void> {}
  async create(input: ThreadProviderCreateInput) {
    this.events.set(input.threadId, input.onEvent)
    return {
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text" as const],
        providerExtensions: false,
      },
      sessionId: `provider-${input.threadId}`,
    }
  }
  async delete(): Promise<void> {
    if (this.deleteError) throw this.deleteError
  }
  async resume(input: Parameters<ThreadProviderAdapter["resume"]>[0]) {
    this.events.set(input.threadId, input.onEvent)
    return {
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text" as const],
        providerExtensions: false,
      },
      history: [
        {
          item: {
            itemId: "history-1",
            operation: "replace" as const,
            role: "assistant" as const,
            text: "restored",
            type: "message" as const,
          },
        },
      ],
      sessionId: input.agentSessionId ?? "missing",
    }
  }
  async startTurn() {
    return { turnId: "turn-1" }
  }
  async cancelTurn(): Promise<void> {}
  async updateConfig(): Promise<void> {}
  async respondToInteraction(): Promise<void> {}
}

const databases: Array<{ close: () => void; home: string }> = []
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
    rmSync(database.home, { force: true, recursive: true })
  }
})

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), "cypheria-thread-manager-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: home })
  databases.push({ close: database.close, home })
  await applyDatabaseMigrations(database.client)
  const agents = createAgentRegistryPersistenceService(database.db)
  await agents.reconcile([{ id: "codex", native: true }])
  await agents.setVersion("codex", {
    description: "Codex",
    icon: null,
    name: "Codex",
    repository: null,
    version: "1.0.0",
    website: null,
  })
  await agents.setEnabled("codex", true)
  const adapter = new FakeAdapter()
  const messages: ServerMessage[] = []
  const manager = new ThreadManager({
    adapterFor: () => adapter,
    assertAgentCallable: async () => undefined,
    lifecycle: createThreadLifecyclePersistenceService(database.db),
    persistence: createProjectThreadPersistenceService(database.db),
    publish: (message) => messages.push(message),
  })
  await manager.initialize()
  return { adapter, database, manager, messages }
}

describe("ThreadManager", () => {
  it("creates a provider session first and binds it to the public thread", async () => {
    const { manager, messages } = await setup()
    const created = await manager.create({ agentId: "codex", cwd: "/repo" })

    expect(created.thread).toMatchObject({
      agentId: "codex",
      agentSessionId: `provider-${created.thread.id}`,
      cwd: "/repo",
      state: "idle",
    })
    expect(messages.at(-1)?.type).toBe("thread.created.notification")
  })

  it("rehydrates provider history into a new timeline epoch", async () => {
    const { manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    const previousEpoch = created.timeline.epoch
    const resumed = await manager.resume(created.thread.id)

    expect(resumed.timeline.epoch).not.toBe(previousEpoch)
    expect(await manager.get(created.thread.id)).toMatchObject({ state: "idle" })
  })

  it("keeps the Cypheria thread when provider deletion fails", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    adapter.deleteError = new Error("provider refused")

    await expect(manager.delete(created.thread.id)).rejects.toThrow("provider refused")
    expect(await manager.get(created.thread.id)).toMatchObject({ state: "errored" })
  })

  it("accepts only the first response to a pending interaction", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    const respond = vi.spyOn(adapter, "respondToInteraction")
    adapter.events.get(created.thread.id)?.({
      interaction: {
        createdAt: new Date().toISOString(),
        expiresAt: null,
        id: "permission-1",
        kind: "permission",
        message: "Run command?",
        options: [],
        title: null,
      },
      type: "interaction-requested",
    })
    await expect.poll(async () => (await manager.get(created.thread.id)).attention).toBe(true)

    await manager.respondToInteraction(created.thread.id, "permission-1", {
      outcome: "allow_once",
      type: "permission",
    })
    await expect(
      manager.respondToInteraction(created.thread.id, "permission-1", {
        outcome: "deny",
        type: "permission",
      })
    ).rejects.toMatchObject({ code: "INTERACTION_ALREADY_RESOLVED" })
    expect(respond).toHaveBeenCalledTimes(1)
  })
})
