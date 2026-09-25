import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createThreadLifecyclePersistenceService,
  createThreadMessageRequestPersistenceService,
  createThreadTimelinePersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { AgentId, ServerMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ThreadHarnessAdapter,
  ThreadHarnessCreateInput,
  ThreadHarnessEvent,
} from "./harness-adapter.js"
import { ThreadManager } from "./thread-manager.js"

class FakeAdapter implements ThreadHarnessAdapter {
  readonly agentId: AgentId = "codex"
  readonly events = new Map<string, (event: ThreadHarnessEvent) => void>()
  closeError: Error | undefined
  deleteError: Error | undefined
  interactionError: Error | undefined
  createSessionId: string | null | undefined
  readonly creates: ThreadHarnessCreateInput[] = []
  readonly steers: Array<Parameters<ThreadHarnessAdapter["steerTurn"]>[0]> = []
  readonly starts: Array<Parameters<ThreadHarnessAdapter["startTurn"]>[0]> = []
  readonly resumes: Array<Parameters<ThreadHarnessAdapter["resume"]>[0]> = []
  resumeErrorForCwd: string | undefined
  startError: Error | undefined

  async close(): Promise<void> {
    if (this.closeError) throw this.closeError
  }
  async create(input: ThreadHarnessCreateInput) {
    this.creates.push(input)
    this.events.set(input.threadId, input.onEvent)
    return {
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text" as const],
        harnessExtensions: false,
        steer: true,
      },
      sessionId:
        this.createSessionId === undefined ? `harness-${input.threadId}` : this.createSessionId,
    }
  }
  async delete(): Promise<void> {
    if (this.deleteError) throw this.deleteError
  }
  async resume(input: Parameters<ThreadHarnessAdapter["resume"]>[0]) {
    this.resumes.push(input)
    if (input.cwd === this.resumeErrorForCwd) throw new Error("resume failed")
    this.events.set(input.threadId, input.onEvent)
    return {
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text" as const],
        harnessExtensions: false,
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
  async startTurn(input: Parameters<ThreadHarnessAdapter["startTurn"]>[0]) {
    this.starts.push(input)
    if (this.startError) throw this.startError
    return { agentMessageId: "agent-message-1", turnId: "turn-1" }
  }
  async steerTurn(
    input: Parameters<ThreadHarnessAdapter["steerTurn"]>[0]
  ): Promise<{ agentMessageId?: string }> {
    this.steers.push(input)
    return {}
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

const setup = async (
  turnCapture?: ConstructorParameters<typeof ThreadManager>[0]["turnCapture"]
) => {
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
  const lifecycle = createThreadLifecyclePersistenceService(database.db)
  const persistence = createProjectThreadPersistenceService(database.db)
  const messageRequests = createThreadMessageRequestPersistenceService(database.db)
  const timelinePersistence = createThreadTimelinePersistenceService(database.db)
  const manager = new ThreadManager({
    adapterFor: () => adapter,
    assertAgentCallable: async () => undefined,
    lifecycle,
    messageRequests,
    persistence,
    publish: (message) => messages.push(message),
    timelinePersistence,
    turnCapture,
  })
  await manager.initialize()
  return {
    adapter,
    database,
    lifecycle,
    manager,
    messageRequests,
    messages,
    persistence,
    timelinePersistence,
  }
}

describe("ThreadManager", () => {
  it("passes a project's default cwd and workspace roots without exposing project identity", async () => {
    const { adapter, manager, persistence } = await setup()
    const project = await persistence.createProject({
      name: "Workspace",
      roots: ["/repo", "/shared"],
    })

    const created = await manager.create({
      agentId: "codex",
      projectPlacement: { projectId: project.id },
    })

    expect(adapter.creates[0]).toMatchObject({
      cwd: "/repo",
      workspaceRoots: ["/repo", "/shared"],
    })
    expect(adapter.creates[0]).not.toHaveProperty("project")
    await manager.startTurn({
      clientMessageId: "project-turn",
      content: [{ text: "work", type: "text" }],
      threadId: created.thread.id,
    })
    expect(adapter.starts[0]?.workspaceRoots).toEqual(["/repo", "/shared"])
  })

  it("requires a project thread cwd to exactly match a saved workspace root", async () => {
    const { adapter, manager, persistence } = await setup()
    const project = await persistence.createProject({ name: "Workspace", roots: ["/repo"] })

    await expect(
      manager.create({
        agentId: "codex",
        cwd: "/elsewhere",
        projectPlacement: { projectId: project.id },
      })
    ).rejects.toMatchObject({ code: "THREAD_CWD_OUTSIDE_PROJECT" })
    await expect(
      manager.create({
        agentId: "codex",
        cwd: "/repo/packages/app",
        projectPlacement: { projectId: project.id },
      })
    ).rejects.toMatchObject({ code: "THREAD_CWD_OUTSIDE_PROJECT" })
    expect(adapter.creates).toEqual([])
  })

  it("captures a local Codex turn and discards a capture when starting fails", async () => {
    const captures: string[] = []
    const { adapter, manager } = await setup({
      start: async (threadId, cwd) => {
        captures.push(`start:${threadId}:${cwd}`)
        return "capture-1"
      },
      complete: async (id, turnId) => {
        captures.push(`complete:${id}:${turnId}`)
      },
      discard: async (id) => {
        captures.push(`discard:${id}`)
      },
    })
    const created = await manager.create({ agentId: "codex", cwd: "/repo" })
    await manager.startTurn({
      clientMessageId: "capture-start",
      content: [{ text: "work", type: "text" }],
      threadId: created.thread.id,
    })
    adapter.events.get(created.thread.id)?.({ turnId: "turn-1", type: "turn-completed" })
    await vi.waitFor(() => expect(captures).toContain("complete:capture-1:turn-1"))
    adapter.startError = new Error("start failed")
    await expect(
      manager.startTurn({
        clientMessageId: "capture-fail",
        content: [{ text: "again", type: "text" }],
        threadId: created.thread.id,
      })
    ).rejects.toThrow("start failed")
    expect(captures).toContain("discard:capture-1")
  })

  it("creates a harness session first and binds it to the public thread", async () => {
    const { manager, messages } = await setup()
    const created = await manager.create({ agentId: "codex", cwd: "/repo" })

    expect(created.thread).toMatchObject({
      agentId: "codex",
      agentSessionId: `harness-${created.thread.id}`,
      cwd: "/repo",
      state: "idle",
    })
    expect(messages.at(-1)?.type).toBe("thread.created.notification")
  })

  it("moves an idle Codex thread's working directory and restores it when resume fails", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex", cwd: "/repo" })
    expect(await manager.moveWorkingDirectory(created.thread.id, "/repo/worktree")).toMatchObject({
      cwd: "/repo/worktree",
      state: "idle",
    })
    expect(adapter.resumes.at(-1)?.cwd).toBe("/repo/worktree")
    adapter.resumeErrorForCwd = "/repo/broken"
    await expect(manager.moveWorkingDirectory(created.thread.id, "/repo/broken")).rejects.toThrow(
      "resume failed"
    )
    expect(await manager.get(created.thread.id)).toMatchObject({
      cwd: "/repo/worktree",
      state: "idle",
    })
    expect(adapter.resumes.at(-1)?.cwd).toBe("/repo/worktree")
    await manager.startTurn({
      clientMessageId: "move-active",
      content: [{ text: "work", type: "text" }],
      threadId: created.thread.id,
    })
    await expect(
      manager.moveWorkingDirectory(created.thread.id, "/repo/other")
    ).rejects.toMatchObject({ code: "THREAD_ACTIVE" })
  })

  it("rehydrates harness history into a new timeline epoch", async () => {
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

  it("durably deduplicates matching client message IDs", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    const request = {
      clientMessageId: "message-deduplicated",
      content: [{ text: "start", type: "text" as const }],
      threadId: created.thread.id,
    }

    const first = await manager.startTurn(request)
    const repeated = await manager.startTurn(request)

    expect(repeated.turnId).toBe(first.turnId)
    expect(adapter.starts).toHaveLength(1)
  })

  it("rejects reuse of a client message ID for different content", async () => {
    const { manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    await manager.startTurn({
      clientMessageId: "message-conflict",
      content: [{ text: "first", type: "text" }],
      threadId: created.thread.id,
    })

    await expect(
      manager.startTurn({
        clientMessageId: "message-conflict",
        content: [{ text: "different", type: "text" }],
        threadId: created.thread.id,
      })
    ).rejects.toMatchObject({ code: "CLIENT_MESSAGE_ID_CONFLICT" })
  })

  it("does not replay an Agent call with an ambiguous pending receipt", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    adapter.startError = new Error("connection lost")
    const request = {
      clientMessageId: "message-ambiguous",
      content: [{ text: "start", type: "text" as const }],
      threadId: created.thread.id,
    }

    await expect(manager.startTurn(request)).rejects.toThrow("connection lost")
    adapter.startError = undefined
    await expect(manager.startTurn(request)).rejects.toMatchObject({
      code: "THREAD_MESSAGE_OUTCOME_UNKNOWN",
    })
    expect(adapter.starts).toHaveLength(1)
  })

  it("reconciles an Agent user-message echo without appending a duplicate row", async () => {
    const { adapter, manager, timelinePersistence } = await setup()
    const created = await manager.create({ agentId: "codex" })
    await manager.startTurn({
      clientMessageId: "message-echo",
      content: [{ text: "start", type: "text" }],
      threadId: created.thread.id,
    })

    adapter.events.get(created.thread.id)?.({
      item: {
        agentMessageId: "agent-message-confirmed",
        harnessItemId: "agent-message-confirmed",
        item: {
          clientMessageId: "message-echo",
          itemId: "agent-message-confirmed",
          operation: "replace",
          role: "user",
          text: "start",
          type: "message",
        },
      },
      type: "timeline",
    })

    await expect
      .poll(async () => (await timelinePersistence.get(created.thread.id)).rows)
      .toMatchObject([
        {
          agentMessageId: "agent-message-confirmed",
          item: { clientMessageId: "message-echo", role: "user" },
        },
      ])
  })

  it("waits for active turns before suspending and resuming an agent's sessions", async () => {
    const { adapter, manager } = await setup()
    const created = await manager.create({ agentId: "codex" })
    await manager.startTurn({
      clientMessageId: "message-1",
      content: [{ text: "start", type: "text" }],
      threadId: created.thread.id,
    })

    let finished = false
    const waiting = manager.waitForAgentTurns("codex", new AbortController().signal).then(() => {
      finished = true
    })
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    expect(finished).toBe(false)

    adapter.events.get(created.thread.id)?.({ turnId: "turn-1", type: "turn-completed" })
    await waiting
    expect(await manager.suspendAgentThreads("codex")).toEqual([created.thread.id])
    expect(await manager.get(created.thread.id)).toMatchObject({ state: "stopped" })

    await manager.resumeAgentThreads([created.thread.id])
    expect(await manager.get(created.thread.id)).toMatchObject({ state: "idle" })
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

  it("persists a harness session id discovered while resuming", async () => {
    const { adapter, manager } = await setup()
    adapter.createSessionId = null
    const created = await manager.create({ agentId: "codex" })
    expect(created.thread.agentSessionId).toBeNull()

    const resumed = await manager.resume(created.thread.id)

    expect(resumed.thread.agentSessionId).toBe("missing")
    expect((await manager.get(created.thread.id)).agentSessionId).toBe("missing")
  })

  it("tombstones a Cypheria thread for retry when harness deletion fails", async () => {
    const { adapter, lifecycle, manager, persistence } = await setup()
    const created = await manager.create({ agentId: "codex" })
    adapter.deleteError = new Error("harness refused")

    await expect(manager.delete(created.thread.id)).rejects.toThrow("harness refused")
    await expect(manager.get(created.thread.id)).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" })
    expect(await persistence.listDeletedResources()).toContainEqual(
      expect.objectContaining({
        type: "thread",
        value: expect.objectContaining({ id: created.thread.id }),
      })
    )
    expect(await lifecycle.listRecoverable()).toContainEqual(
      expect.objectContaining({ kind: "delete", threadId: created.thread.id })
    )
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

  it("keeps a pending interaction retryable when the harness response fails", async () => {
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
    adapter.interactionError = new Error("harness unavailable")

    await expect(
      manager.respondToInteraction(created.thread.id, "permission-1", {
        outcome: "allow_once",
        type: "permission",
      })
    ).rejects.toThrow("harness unavailable")
    expect((await manager.get(created.thread.id)).pendingInteractions).toHaveLength(1)
  })

  it("moves a thread to errored when harness close fails", async () => {
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
