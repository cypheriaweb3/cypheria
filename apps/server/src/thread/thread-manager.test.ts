import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createThreadLifecyclePersistenceService,
  createThreadTimelinePersistenceService,
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
  closeError: Error | undefined
  deleteError: Error | undefined
  interactionError: Error | undefined
  createSessionId: string | null | undefined
  readonly creates: ThreadProviderCreateInput[] = []
  readonly steers: Array<Parameters<ThreadProviderAdapter["steerTurn"]>[0]> = []

  async close(): Promise<void> {
    if (this.closeError) throw this.closeError
  }
  async create(input: ThreadProviderCreateInput) {
    this.creates.push(input)
    this.events.set(input.threadId, input.onEvent)
    return {
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text" as const],
        providerExtensions: false,
        steer: true,
      },
      sessionId:
        this.createSessionId === undefined ? `provider-${input.threadId}` : this.createSessionId,
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
        steer: true,
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
  async steerTurn(input: Parameters<ThreadProviderAdapter["steerTurn"]>[0]): Promise<void> {
    this.steers.push(input)
  }
  async cancelTurn(): Promise<void> {}
  async updateConfig(): Promise<void> {}
  async respondToInteraction(): Promise<void> {
    if (this.interactionError) throw this.interactionError
  }
}

const databases: Array<{ close: () => void; home: string }> = []
const migrationsFolder = [
  resolve(process.cwd(), "packages/db/drizzle"),
  resolve(process.cwd(), "../../packages/db/drizzle"),
].find(existsSync)

if (!migrationsFolder) throw new Error("Database migrations folder was not found")

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
  await applyDatabaseMigrations(database.client, {
    migrationsFolder,
  })
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
    timelinePersistence: createThreadTimelinePersistenceService(database.db),
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

  it("steers a supported active turn and records the user message in its timeline", async () => {
    const { adapter, manager, messages } = await setup()
    const created = await manager.create({ agentId: "codex" })
    await manager.startTurn({
      clientMessageId: "message-1",
      content: [{ text: "start", type: "text" }],
      threadId: created.thread.id,
    })

    const steered = await manager.steerTurn({
      clientMessageId: "message-2",
      content: [{ text: "adjust", type: "text" }],
      threadId: created.thread.id,
    })

    expect(steered.turnId).toBe("turn-1")
    expect(adapter.steers).toMatchObject([
      { clientMessageId: "message-2", content: [{ text: "adjust", type: "text" }] },
    ])
    expect(messages).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          row: expect.objectContaining({
            item: expect.objectContaining({ role: "user", text: "adjust" }),
          }),
        }),
        type: "thread.timeline.appended.notification",
      })
    )
  })

  it("records user attachments in the canonical timeline", async () => {
    const { manager, messages } = await setup()
    const created = await manager.create({ agentId: "codex" })
    await manager.startTurn({
      clientMessageId: "message-with-image",
      content: [
        { text: "inspect", type: "text" },
        { data: "AA==", mimeType: "image/png", type: "image" },
      ],
      threadId: created.thread.id,
    })

    expect(messages).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          row: expect.objectContaining({
            item: expect.objectContaining({
              attachments: [{ data: "AA==", mimeType: "image/png", type: "image" }],
              role: "user",
              text: "inspect",
            }),
          }),
        }),
        type: "thread.timeline.appended.notification",
      })
    )
  })

  it("persists a provider session id discovered while resuming", async () => {
    const { adapter, manager } = await setup()
    adapter.createSessionId = null
    const created = await manager.create({ agentId: "codex" })
    expect(created.thread.agentSessionId).toBeNull()

    const resumed = await manager.resume(created.thread.id)

    expect(resumed.thread.agentSessionId).toBe("missing")
    expect((await manager.get(created.thread.id)).agentSessionId).toBe("missing")
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

  it("keeps a pending interaction retryable when the provider response fails", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
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
    adapter.interactionError = new Error("provider unavailable")

    await expect(
      manager.respondToInteraction(created.thread.id, "permission-1", {
        outcome: "allow_once",
        type: "permission",
      })
    ).rejects.toThrow("provider unavailable")
    expect((await manager.get(created.thread.id)).pendingInteractions).toHaveLength(1)
  })

  it("moves a thread to errored when provider close fails", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    adapter.closeError = new Error("close failed")

    await expect(manager.close(created.thread.id)).rejects.toThrow("close failed")
    expect(await manager.get(created.thread.id)).toMatchObject({ state: "errored" })
  })

  it("archives a stopped thread and requires unarchive before resume", async () => {
    const { manager } = await setup()
    const created = await manager.create({ agentId: "codex" })

    const archived = await manager.archive(created.thread.id)
    expect(archived).toMatchObject({ archivedAt: expect.any(Number), state: "stopped" })
    expect((await manager.list({})).data).toHaveLength(0)
    expect((await manager.list({ archived: true })).data).toMatchObject([{ id: created.thread.id }])
    await expect(manager.resume(created.thread.id)).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    })

    expect(await manager.unarchive(created.thread.id)).toMatchObject({ archivedAt: null })
    await expect(manager.resume(created.thread.id)).resolves.toMatchObject({
      thread: { id: created.thread.id, state: "idle" },
    })
  })

  it("forks through the source agent session while keeping Cypheria identity", async () => {
    const { adapter, manager } = await setup()
    const source = await manager.create({ agentId: "codex", cwd: "/repo", title: "Source" })

    const fork = await manager.fork({ threadId: source.thread.id })

    expect(fork.thread).toMatchObject({
      agentId: "codex",
      cwd: "/repo",
      forkedFromId: source.thread.id,
      title: "Source",
    })
    expect(fork.thread.id).not.toBe(source.thread.id)
    expect(adapter.creates.at(-1)?.forkedFromAgentSessionId).toBe(source.thread.agentSessionId)
  })
})
