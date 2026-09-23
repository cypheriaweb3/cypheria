import type {
  CreateThreadInput,
  ProjectThreadPersistenceService,
  ThreadLifecycleOperationRecord,
  ThreadLifecyclePersistenceService,
  ThreadMessageRequestPersistenceService,
  ThreadMessageRequestResolution,
  ThreadRecord,
  ThreadTimelinePersistenceService,
} from "@cypheria/db"
import { createThreadId } from "@cypheria/db"
import {
  type AgentId,
  type ServerMessage,
  type ThreadClientMessage,
  type ThreadInputBlock,
  type ThreadInteraction,
  ThreadSchema,
  type ThreadServerMessage,
  type ThreadState,
  type ThreadView,
} from "@cypheria/protocol"

import type {
  ThreadHarnessAdapter,
  ThreadHarnessContext,
  ThreadHarnessEvent,
  ThreadInteractionResponse,
} from "./harness-adapter.js"
import { ThreadTimelineStore } from "./timeline-store.js"

type Publish = (message: ServerMessage) => void

type RuntimeState = {
  activeTurn: { id: string; startedAt: string } | null
  capabilities: ThreadView["capabilities"]
  pendingInteractions: Map<string, ThreadInteraction>
  state: ThreadState
}

export class ThreadManagerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

export type ThreadManagerOptions = {
  readonly adapterFor: (agentId: AgentId, threadId: string) => ThreadHarnessAdapter
  readonly assertAgentCallable: (agentId: AgentId) => Promise<void>
  readonly lifecycle: ThreadLifecyclePersistenceService
  readonly messageRequests: ThreadMessageRequestPersistenceService
  readonly persistence: ProjectThreadPersistenceService
  readonly publish: Publish
  readonly timelinePersistence: ThreadTimelinePersistenceService
}

const stoppedCapabilities: ThreadView["capabilities"] = {
  changeCwd: true,
  configure: false,
  fork: false,
  promptContent: ["text"],
  harnessExtensions: false,
  steer: false,
}

export class ThreadManager {
  readonly #adapterFor: ThreadManagerOptions["adapterFor"]
  readonly #assertAgentCallable: ThreadManagerOptions["assertAgentCallable"]
  readonly #lifecycle: ThreadLifecyclePersistenceService
  readonly #locks = new Map<string, Promise<unknown>>()
  readonly #messageRequests: ThreadMessageRequestPersistenceService
  readonly #persistence: ProjectThreadPersistenceService
  readonly #publish: Publish
  readonly #runtime = new Map<string, RuntimeState>()
  readonly #timeline: ThreadTimelineStore

  constructor(options: ThreadManagerOptions) {
    this.#adapterFor = options.adapterFor
    this.#assertAgentCallable = options.assertAgentCallable
    this.#lifecycle = options.lifecycle
    this.#messageRequests = options.messageRequests
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#timeline = new ThreadTimelineStore(options.timelinePersistence)
  }

  async initialize(): Promise<void> {
    for (const operation of await this.#lifecycle.listRecoverable()) {
      await this.#recover(operation)
    }
  }

  async handle(
    message: ThreadClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<void> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ThreadServerMessage)
    }
    try {
      switch (message.type) {
        case "thread.create.request":
          respond(await this.create(message.payload))
          break
        case "thread.get.request":
          respond(await this.get(message.payload.threadId))
          break
        case "thread.list.request":
          respond(await this.list(message.payload))
          break
        case "thread.update.request": {
          const { threadId, ...patch } = message.payload
          respond(await this.update(threadId, patch))
          break
        }
        case "thread.recency.touch.request":
          respond(
            await this.#updateAndPublish(
              await this.#persistence.touchThreadRecency(
                message.payload.threadId,
                message.payload.recencyAt
              )
            )
          )
          break
        case "thread.move.request":
          await this.#persistence.moveThread(message.payload)
          respond({})
          break
        case "thread.resume.request":
          respond(await this.resume(message.payload.threadId))
          break
        case "thread.fork.request":
          respond(await this.fork(message.payload))
          break
        case "thread.close.request":
          respond(await this.close(message.payload.threadId))
          break
        case "thread.archive.request":
          respond(await this.archive(message.payload.threadId))
          break
        case "thread.unarchive.request":
          respond(await this.unarchive(message.payload.threadId))
          break
        case "thread.delete.request":
          await this.delete(message.payload.threadId)
          respond({})
          break
        case "thread.turn.start.request":
          respond(await this.startTurn(message.payload))
          break
        case "thread.turn.steer.request":
          respond(await this.steerTurn(message.payload))
          break
        case "thread.turn.cancel.request":
          respond(await this.cancelTurn(message.payload.threadId, message.payload.turnId))
          break
        case "thread.timeline.get.request":
          await this.#required(message.payload.threadId)
          respond(await this.#timeline.page(message.payload.threadId, message.payload))
          break
        case "thread.config.update.request": {
          const { threadId, ...patch } = message.payload
          respond(await this.updateConfig(threadId, patch))
          break
        }
        case "thread.interaction.respond.request":
          respond(
            await this.respondToInteraction(
              message.payload.threadId,
              message.payload.interactionId,
              message.payload.response
            )
          )
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: {
            code: error instanceof ThreadManagerError ? error.code : failure.name || "THREAD_ERROR",
            message: failure.message,
          },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ThreadServerMessage)
    }
  }

  async create(input: CreateThreadInput): Promise<{
    thread: ThreadView
    timeline: Awaited<ReturnType<ThreadTimelineStore["head"]>>
  }> {
    const threadId = createThreadId()
    return this.#withLock(threadId, async () => {
      const agentId = input.agentId as AgentId
      await this.#assertAgentCallable(agentId)
      const source = input.forkedFromId ? await this.#required(input.forkedFromId) : undefined
      if (source && source.agentId !== agentId) {
        throw new ThreadManagerError("THREAD_AGENT_MISMATCH", "A fork must use the source agent")
      }
      if (source && !source.agentSessionId) {
        throw new ThreadManagerError("THREAD_FORK_UNAVAILABLE", "The source thread is not bound")
      }
      const operation = await this.#lifecycle.begin({
        agentId,
        input: input as Record<string, unknown>,
        kind: "create",
        threadId,
      })
      const adapter = this.#adapterFor(agentId, threadId)
      let databaseCommitted = false
      let harnessSessionId: string | null | undefined
      try {
        const session = await adapter.create({
          agentId,
          cwd: input.cwd ?? null,
          forkedFromAgentSessionId: source?.agentSessionId ?? null,
          onEvent: (event) => this.#acceptEvent(threadId, event),
          threadId,
        })
        harnessSessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "harness-created",
        })
        const thread = await this.#persistence.createThread({
          ...input,
          agentSessionId: session.sessionId,
          id: threadId,
        })
        databaseCommitted = true
        this.#runtime.set(threadId, {
          activeTurn: null,
          capabilities: session.capabilities,
          pendingInteractions: new Map(),
          state: "idle",
        })
        if (session.history) await this.#timeline.replace(threadId, session.history)
        const timeline = await this.#timeline.head(threadId)
        await this.#lifecycle.complete(operation.id)
        const view = this.#view(thread)
        this.#publish({ payload: view, type: "thread.created.notification" })
        return { thread: view, timeline }
      } catch (error) {
        if (databaseCommitted) {
          // Leave harness-created state for startup recovery to complete journal cleanup.
        } else if (harnessSessionId !== undefined) {
          try {
            await adapter.delete({
              agentId,
              agentSessionId: harnessSessionId,
              cwd: input.cwd ?? null,
              threadId,
            })
            await this.#lifecycle
              .fail(operation.id, `Harness create was compensated: ${this.#message(error)}`)
              .catch(() => undefined)
          } catch {
            // Keep harness-created durable state so startup recovery can finish the DB commit.
          }
        } else {
          await this.#lifecycle.fail(operation.id, this.#message(error)).catch(() => undefined)
        }
        throw error
      }
    })
  }

  async get(threadId: string): Promise<ThreadView> {
    return this.#view(await this.#required(threadId))
  }

  async list(options: Parameters<ProjectThreadPersistenceService["listThreads"]>[0]) {
    const page = await this.#persistence.listThreads(options)
    return { ...page, data: page.data.map((thread) => this.#view(thread)) }
  }

  async update(
    threadId: string,
    patch: { cwd?: string | null; title?: string | null }
  ): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      if (patch.cwd !== undefined && this.#state(threadId).state !== "stopped") {
        throw new ThreadManagerError(
          "THREAD_ACTIVE",
          "Thread cwd can only be changed while the thread is stopped"
        )
      }
      return this.#updateAndPublish(await this.#persistence.updateThread(threadId, patch))
    })
  }

  async moveWorkingDirectory(threadId: string, cwd: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      if (thread.agentId !== "codex" || !thread.agentSessionId || !thread.cwd) {
        throw new ThreadManagerError("THREAD_AGENT_MISMATCH", "A local Codex thread is required")
      }
      const runtime = this.#state(threadId)
      if (
        runtime.activeTurn ||
        runtime.pendingInteractions.size > 0 ||
        (runtime.state !== "idle" && runtime.state !== "stopped")
      ) {
        throw new ThreadManagerError(
          "THREAD_ACTIVE",
          "Finish the current turn before moving the thread"
        )
      }
      if (thread.cwd === cwd) return this.#view(thread)
      const wasIdle = runtime.state === "idle"
      const adapter = this.#adapterFor("codex", threadId)
      if (wasIdle) {
        runtime.state = "stopping"
        this.#updateAndPublishSync(thread)
        try {
          await adapter.close(this.#context(thread))
        } catch (error) {
          runtime.state = "errored"
          this.#updateAndPublishSync(thread)
          throw error
        }
        runtime.state = "stopped"
      }
      let moved: ThreadRecord | null = null
      try {
        moved = await this.#persistence.updateThread(threadId, { cwd })
        if (wasIdle) {
          const session = await adapter.resume({
            ...this.#context(moved),
            onEvent: (event) => this.#acceptEvent(threadId, event),
          })
          if (session.sessionId !== thread.agentSessionId) {
            throw new ThreadManagerError(
              "THREAD_BINDING_MISMATCH",
              "Harness resumed a different session"
            )
          }
          runtime.capabilities = session.capabilities
          runtime.state = "idle"
          if (session.history !== undefined) await this.#timeline.replace(threadId, session.history)
        }
        return this.#updateAndPublishSync(moved)
      } catch (error) {
        const rollbackFailures: unknown[] = []
        if (moved && wasIdle) {
          await adapter.close(this.#context(moved)).catch((cause) => rollbackFailures.push(cause))
        }
        let restored = true
        if (moved) {
          await this.#persistence.updateThread(threadId, { cwd: thread.cwd }).catch((cause) => {
            restored = false
            rollbackFailures.push(cause)
          })
        }
        if (wasIdle && restored) {
          try {
            const session = await adapter.resume({
              ...this.#context(thread),
              onEvent: (event) => this.#acceptEvent(threadId, event),
            })
            if (session.sessionId !== thread.agentSessionId) {
              throw new ThreadManagerError(
                "THREAD_BINDING_MISMATCH",
                "Harness resumed a different session"
              )
            }
            runtime.capabilities = session.capabilities
            runtime.state = "idle"
          } catch (cause) {
            rollbackFailures.push(cause)
            runtime.state = "errored"
          }
        } else if (wasIdle) {
          runtime.state = "errored"
        }
        this.#updateAndPublishSync(restored ? thread : (moved ?? thread))
        if (rollbackFailures.length) {
          throw new AggregateError([error, ...rollbackFailures], "Thread move and rollback failed")
        }
        throw error
      }
    })
  }

  async fork(input: {
    beforeThreadId?: string | null
    cwd?: string | null
    projectPlacement?: CreateThreadInput["projectPlacement"]
    sectionPlacement?: CreateThreadInput["sectionPlacement"]
    threadId: string
    title?: string | null
  }) {
    const source = await this.#required(input.threadId)
    return this.create({
      agentId: source.agentId,
      beforeThreadId: input.beforeThreadId,
      cwd: input.cwd === undefined ? source.cwd : input.cwd,
      forkedFromId: source.id,
      projectPlacement: input.projectPlacement,
      sectionPlacement: input.sectionPlacement,
      title: input.title === undefined ? source.title : input.title,
    })
  }

  async resume(threadId: string) {
    return this.#withLock(threadId, async () => {
      let thread = await this.#required(threadId)
      if (thread.archivedAt !== null) {
        throw new ThreadManagerError("THREAD_ARCHIVED", "Archived threads must be unarchived first")
      }
      const agentId = thread.agentId as AgentId
      await this.#assertAgentCallable(agentId)
      this.#setState(thread, "starting")
      try {
        const session = await this.#adapterFor(agentId, threadId).resume({
          ...this.#context(thread),
          onEvent: (event) => this.#acceptEvent(threadId, event),
        })
        if (thread.agentSessionId && session.sessionId !== thread.agentSessionId) {
          throw new ThreadManagerError(
            "THREAD_BINDING_MISMATCH",
            "Harness resumed a different session"
          )
        }
        if (!thread.agentSessionId && session.sessionId) {
          thread = await this.#persistence.bindThreadAgentSession(threadId, session.sessionId)
        }
        const runtime = this.#state(threadId)
        runtime.capabilities = session.capabilities
        runtime.state = "idle"
        runtime.activeTurn = null
        runtime.pendingInteractions.clear()
        if (session.history !== undefined) await this.#timeline.replace(threadId, session.history)
        const timeline = await this.#timeline.head(threadId)
        const view = this.#view(thread)
        this.#publish({
          payload: { epoch: timeline.epoch, reason: "hydrated", threadId },
          type: "thread.timeline.replaced.notification",
        })
        this.#publish({ payload: view, type: "thread.updated.notification" })
        return { thread: view, timeline }
      } catch (error) {
        this.#setState(thread, "errored")
        throw error
      }
    })
  }

  async close(threadId: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(threadId)
      if (runtime.state === "stopped") return this.#view(thread)
      runtime.state = "stopping"
      this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
      try {
        await this.#adapterFor(thread.agentId as AgentId, thread.id).close(this.#context(thread))
        runtime.state = "stopped"
        runtime.activeTurn = null
        runtime.pendingInteractions.clear()
        return this.#updateAndPublish(thread)
      } catch (error) {
        runtime.state = "errored"
        this.#updateAndPublishSync(thread)
        throw error
      }
    })
  }

  async archive(threadId: string): Promise<ThreadView> {
    const thread = await this.#required(threadId)
    if (thread.archivedAt !== null) return this.#view(thread)
    if (this.#state(threadId).state !== "stopped") await this.close(threadId)
    return this.#withLock(threadId, async () => {
      const current = await this.#required(threadId)
      if (current.archivedAt !== null) return this.#view(current)
      return this.#updateAndPublish(
        await this.#persistence.setThreadArchived(threadId, Math.floor(Date.now() / 1000))
      )
    })
  }

  async unarchive(threadId: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      if (thread.archivedAt === null) return this.#view(thread)
      return this.#updateAndPublish(await this.#persistence.setThreadArchived(threadId, null))
    })
  }

  async delete(threadId: string): Promise<void> {
    await this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(threadId)
      runtime.state = "deleting"
      this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
      const operation = await this.#lifecycle.begin({
        agentId: thread.agentId,
        agentSessionId: thread.agentSessionId,
        input: { thread },
        kind: "delete",
        threadId,
      })
      let harnessDeleted = false
      try {
        await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
        harnessDeleted = true
        await this.#lifecycle.transition(operation.id, { status: "harness-deleted" })
        await this.#persistence.deleteThread(threadId)
        await this.#lifecycle.complete(operation.id)
        this.#runtime.delete(threadId)
        await this.#timeline.delete(threadId)
        this.#publish({ payload: { threadId }, type: "thread.deleted.notification" })
      } catch (error) {
        runtime.state = "errored"
        if (!harnessDeleted) {
          await this.#lifecycle.fail(operation.id, this.#message(error)).catch(() => undefined)
        }
        this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
        throw error
      }
    })
  }

  async startTurn(input: {
    clientMessageId: string
    content: readonly ThreadInputBlock[]
    threadId: string
  }): Promise<{ thread: ThreadView; turnId: string }> {
    const stored = await this.#required(input.threadId)
    const request = { content: input.content, operation: "start" as const }
    const existing = await this.#messageRequests.inspect({
      clientMessageId: input.clientMessageId,
      request,
      threadId: input.threadId,
    })
    const previousTurnId = this.#resolveMessageRequest(existing)
    if (previousTurnId) return { thread: this.#view(stored), turnId: previousTurnId }
    await this.#assertAgentCallable(stored.agentId as AgentId)
    if (stored.archivedAt !== null) {
      throw new ThreadManagerError("THREAD_ARCHIVED", "Archived threads must be unarchived first")
    }
    if (this.#state(input.threadId).state === "stopped") await this.resume(input.threadId)
    return this.#withLock(input.threadId, async () => {
      const thread = await this.#required(input.threadId)
      const runtime = this.#state(thread.id)
      const current = await this.#messageRequests.inspect({
        clientMessageId: input.clientMessageId,
        request,
        threadId: thread.id,
      })
      const currentTurnId = this.#resolveMessageRequest(current)
      if (currentTurnId) return { thread: this.#view(thread), turnId: currentTurnId }
      if (runtime.activeTurn) {
        throw new ThreadManagerError("THREAD_BUSY", "Thread already has an active turn")
      }
      if (runtime.state !== "idle") {
        throw new ThreadManagerError("THREAD_NOT_READY", `Thread is ${runtime.state}`)
      }
      const claimed = await this.#messageRequests.claim({
        clientMessageId: input.clientMessageId,
        request,
        threadId: thread.id,
      })
      const claimedTurnId = this.#resolveMessageRequest(claimed)
      if (claimedTurnId) return { thread: this.#view(thread), turnId: claimedTurnId }
      const { agentMessageId, turnId } = await this.#adapterFor(
        thread.agentId as AgentId,
        thread.id
      ).startTurn({
        ...this.#context(thread),
        clientMessageId: input.clientMessageId,
        content: input.content,
      })
      runtime.activeTurn = { id: turnId, startedAt: new Date().toISOString() }
      runtime.state = "running"
      await this.#appendUserInput(
        thread.id,
        turnId,
        input.clientMessageId,
        input.content,
        agentMessageId
      )
      await this.#messageRequests.complete(thread.id, input.clientMessageId, turnId)
      return { thread: this.#updateAndPublishSync(thread), turnId }
    })
  }

  async steerTurn(input: {
    clientMessageId: string
    content: readonly ThreadInputBlock[]
    threadId: string
  }): Promise<{ thread: ThreadView; turnId: string }> {
    return this.#withLock(input.threadId, async () => {
      const thread = await this.#required(input.threadId)
      const runtime = this.#state(thread.id)
      const request = {
        content: input.content,
        operation: "steer" as const,
      }
      const existing = await this.#messageRequests.inspect({
        clientMessageId: input.clientMessageId,
        request,
        threadId: thread.id,
      })
      const previousTurnId = this.#resolveMessageRequest(existing)
      if (previousTurnId) return { thread: this.#view(thread), turnId: previousTurnId }
      if (!runtime.activeTurn || runtime.state !== "running") {
        throw new ThreadManagerError("TURN_NOT_ACTIVE", "Thread has no active turn to steer")
      }
      if (!runtime.capabilities.steer) {
        throw new ThreadManagerError(
          "THREAD_STEER_UNSUPPORTED",
          `${thread.agentId} does not support steering active turns`
        )
      }
      const turnId = runtime.activeTurn.id
      const claimed = await this.#messageRequests.claim({
        clientMessageId: input.clientMessageId,
        request,
        threadId: thread.id,
      })
      const claimedTurnId = this.#resolveMessageRequest(claimed)
      if (claimedTurnId) return { thread: this.#view(thread), turnId: claimedTurnId }
      const result = await this.#adapterFor(thread.agentId as AgentId, thread.id).steerTurn({
        ...this.#context(thread),
        clientMessageId: input.clientMessageId,
        content: input.content,
        turnId,
      })
      await this.#appendUserInput(
        thread.id,
        turnId,
        input.clientMessageId,
        input.content,
        result.agentMessageId
      )
      await this.#messageRequests.complete(thread.id, input.clientMessageId, turnId)
      return { thread: this.#updateAndPublishSync(thread), turnId }
    })
  }

  async cancelTurn(threadId: string, turnId?: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(threadId)
      const target = turnId ?? runtime.activeTurn?.id
      if (!target) return this.#view(thread)
      if (runtime.activeTurn && runtime.activeTurn.id !== target) {
        throw new ThreadManagerError("TURN_NOT_ACTIVE", "The requested turn is not active")
      }
      await this.#adapterFor(thread.agentId as AgentId, thread.id).cancelTurn({
        ...this.#context(thread),
        turnId: target,
      })
      runtime.activeTurn = null
      runtime.state = "idle"
      return this.#updateAndPublishSync(thread)
    })
  }

  async updateConfig(
    threadId: string,
    patch: {
      mode?: string | null
      model?: string | null
      thinking?: string | null
    }
  ): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      await this.#adapterFor(thread.agentId as AgentId, thread.id).updateConfig(
        this.#context(thread),
        patch
      )
      return this.#updateAndPublishSync(thread)
    })
  }

  async respondToInteraction(
    threadId: string,
    interactionId: string,
    response: ThreadInteractionResponse
  ): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(threadId)
      if (!runtime.pendingInteractions.has(interactionId)) {
        throw new ThreadManagerError(
          "INTERACTION_ALREADY_RESOLVED",
          "Interaction was already resolved or does not exist"
        )
      }
      await this.#adapterFor(thread.agentId as AgentId, thread.id).respondToInteraction(
        this.#context(thread),
        interactionId,
        response
      )
      runtime.pendingInteractions.delete(interactionId)
      this.#publish({
        payload: { interactionId, threadId },
        type: "thread.interaction.resolved.notification",
      })
      return this.#updateAndPublishSync(thread)
    })
  }

  async closeAgentThreads(agentId: AgentId): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listThreads({ agentId, cursor, limit: 200 })
      for (const thread of page.data) {
        if (this.#state(thread.id).state !== "stopped") await this.close(thread.id)
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  async hasActiveThreads(agentId: AgentId): Promise<boolean> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listThreads({ agentId, cursor, limit: 200 })
      if (page.data.some((thread) => this.#state(thread.id).state !== "stopped")) return true
      cursor = page.nextCursor
    } while (cursor)
    return false
  }

  async resumeAgentThreads(threadIds: readonly string[]): Promise<void> {
    for (const threadId of threadIds) await this.resume(threadId)
  }

  async suspendAgentThreads(agentId: AgentId): Promise<string[]> {
    const threadIds: string[] = []
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listThreads({ agentId, cursor, limit: 200 })
      for (const thread of page.data) {
        if (this.#state(thread.id).state === "stopped") continue
        threadIds.push(thread.id)
        await this.close(thread.id)
      }
      cursor = page.nextCursor
    } while (cursor)
    return threadIds
  }

  async waitForAgentTurns(agentId: AgentId, signal: AbortSignal): Promise<void> {
    while (await this.#hasActiveTurn(agentId)) {
      await new Promise<void>((resolvePromise, reject) => {
        let timeout: NodeJS.Timeout | undefined
        const cleanup = () => {
          if (timeout) clearTimeout(timeout)
          signal.removeEventListener("abort", onAbort)
        }
        const onAbort = () => {
          cleanup()
          reject(new Error("Agent update was interrupted"))
        }
        if (signal.aborted) onAbort()
        else {
          signal.addEventListener("abort", onAbort, { once: true })
          timeout = setTimeout(() => {
            cleanup()
            resolvePromise()
          }, 100)
          timeout.unref()
        }
      })
    }
  }

  #acceptEvent(threadId: string, event: ThreadHarnessEvent): void {
    void this.#withLock(threadId, async () => {
      const thread = await this.#persistence.getThread(threadId)
      if (!thread) return
      const runtime = this.#state(threadId)
      switch (event.type) {
        case "timeline":
          if (
            event.item.item.type === "message" &&
            event.item.item.role === "user" &&
            event.item.item.clientMessageId &&
            (await this.#timeline.reconcileUserMessage(
              threadId,
              event.item.item.clientMessageId,
              event.item.agentMessageId
            ))
          ) {
            break
          }
          await this.#appendTimeline(threadId, event.item)
          break
        case "interaction-requested":
          runtime.pendingInteractions.set(event.interaction.id, event.interaction)
          this.#publish({
            payload: { interaction: event.interaction, threadId },
            type: "thread.interaction.requested.notification",
          })
          this.#updateAndPublishSync(thread)
          break
        case "interaction-resolved":
          runtime.pendingInteractions.delete(event.interactionId)
          this.#publish({
            payload: { interactionId: event.interactionId, threadId },
            type: "thread.interaction.resolved.notification",
          })
          this.#updateAndPublishSync(thread)
          break
        case "turn-completed":
          if (
            !runtime.activeTurn ||
            event.turnId === "active" ||
            runtime.activeTurn.id === event.turnId
          ) {
            runtime.activeTurn = null
            runtime.state = "idle"
            this.#updateAndPublishSync(thread)
          }
          break
        case "session-bound":
          if (thread.agentSessionId !== event.sessionId) {
            const bound = await this.#persistence.bindThreadAgentSession(threadId, event.sessionId)
            this.#updateAndPublishSync(bound)
          }
          break
        case "error":
          runtime.activeTurn = null
          runtime.state = "errored"
          await this.#appendTimeline(threadId, {
            item: {
              code: "HARNESS_ERROR",
              itemId: `error:${globalThis.crypto.randomUUID()}`,
              message: event.error,
              type: "error",
            },
            turnId: event.turnId,
          })
          this.#updateAndPublishSync(thread)
          break
        case "progress":
          this.#publish({
            payload: { event: { message: event.message, type: "progress" }, threadId },
            type: "thread.event.notification",
          })
          break
        case "warning":
          this.#publish({
            payload: {
              event: { code: event.code, message: event.message, type: "warning" },
              threadId,
            },
            type: "thread.event.notification",
          })
          break
        case "harness":
          this.#publish({ payload: { event, threadId }, type: "thread.event.notification" })
          break
      }
    })
  }

  async #hasActiveTurn(agentId: AgentId): Promise<boolean> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listThreads({ agentId, cursor, limit: 200 })
      if (page.data.some((thread) => this.#state(thread.id).activeTurn !== null)) return true
      cursor = page.nextCursor
    } while (cursor)
    return false
  }

  async #appendTimeline(
    threadId: string,
    item: Parameters<ThreadTimelineStore["append"]>[1]
  ): Promise<void> {
    const appended = await this.#timeline.append(threadId, item)
    this.#publish({
      payload: { ...appended, threadId },
      type: "thread.timeline.appended.notification",
    })
  }

  async #appendUserInput(
    threadId: string,
    turnId: string,
    clientMessageId: string,
    content: readonly ThreadInputBlock[],
    agentMessageId?: string
  ): Promise<void> {
    const text = content
      .filter(
        (block): block is Extract<ThreadInputBlock, { type: "text" }> => block.type === "text"
      )
      .map((block) => block.text)
      .join("\n")
    const attachments = content.filter(
      (block): block is Exclude<ThreadInputBlock, { type: "text" }> => block.type !== "text"
    )
    await this.#appendTimeline(threadId, {
      agentMessageId,
      item: {
        ...(attachments.length > 0 ? { attachments } : {}),
        clientMessageId,
        itemId: `user:${clientMessageId}`,
        operation: "replace",
        role: "user",
        text,
        type: "message",
      },
      turnId,
    })
  }

  #resolveMessageRequest(resolution: ThreadMessageRequestResolution): string | undefined {
    switch (resolution.status) {
      case "new":
        return undefined
      case "completed":
        return resolution.turnId
      case "conflict":
        throw new ThreadManagerError(
          "CLIENT_MESSAGE_ID_CONFLICT",
          "clientMessageId was already used for a different Thread message"
        )
      case "pending":
        throw new ThreadManagerError(
          "THREAD_MESSAGE_OUTCOME_UNKNOWN",
          "The Agent may have accepted this message before the previous request was interrupted"
        )
    }
  }

  #context(thread: ThreadRecord): ThreadHarnessContext {
    return {
      agentId: thread.agentId as AgentId,
      agentSessionId: thread.agentSessionId,
      cwd: thread.cwd,
      threadId: thread.id,
    }
  }

  #message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async #recover(operation: ThreadLifecycleOperationRecord): Promise<void> {
    try {
      if (operation.kind === "create") {
        if (operation.status === "harness-created") {
          const existing = await this.#persistence.getThread(operation.threadId)
          if (!existing) {
            await this.#persistence.createThread({
              ...(operation.input as CreateThreadInput),
              agentId: operation.agentId,
              agentSessionId: operation.agentSessionId,
              id: operation.threadId,
            })
          }
          await this.#lifecycle.complete(operation.id)
          return
        }
        await this.#lifecycle.fail(
          operation.id,
          "Interrupted before the harness session identity was committed"
        )
        return
      }
      const thread = await this.#persistence.getThread(operation.threadId)
      if (operation.status === "harness-deleted") {
        if (thread) await this.#persistence.deleteThread(thread.id)
        await this.#lifecycle.complete(operation.id)
        return
      }
      if (!thread) {
        await this.#lifecycle.complete(operation.id)
        return
      }
      await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
      await this.#lifecycle.transition(operation.id, { status: "harness-deleted" })
      await this.#persistence.deleteThread(thread.id)
      await this.#lifecycle.complete(operation.id)
    } catch (error) {
      await this.#lifecycle.fail(operation.id, this.#message(error))
    }
  }

  async #required(threadId: string): Promise<ThreadRecord> {
    const thread = await this.#persistence.getThread(threadId)
    if (!thread) throw new ThreadManagerError("THREAD_NOT_FOUND", "Thread was not found")
    return thread
  }

  #setState(thread: ThreadRecord, state: ThreadState): void {
    this.#state(thread.id).state = state
    this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
  }

  #state(threadId: string): RuntimeState {
    let state = this.#runtime.get(threadId)
    if (!state) {
      state = {
        activeTurn: null,
        capabilities: stoppedCapabilities,
        pendingInteractions: new Map(),
        state: "stopped",
      }
      this.#runtime.set(threadId, state)
    }
    return state
  }

  async #updateAndPublish(thread: ThreadRecord): Promise<ThreadView> {
    return this.#updateAndPublishSync(thread)
  }

  #updateAndPublishSync(thread: ThreadRecord): ThreadView {
    const view = this.#view(thread)
    this.#publish({ payload: view, type: "thread.updated.notification" })
    return view
  }

  #view(value: ThreadRecord): ThreadView {
    const thread = ThreadSchema.parse(value)
    const runtime = this.#state(thread.id)
    return {
      ...thread,
      activeTurn: runtime.activeTurn,
      attention: runtime.pendingInteractions.size > 0 || runtime.state === "errored",
      capabilities: runtime.capabilities,
      pendingInteractions: [...runtime.pendingInteractions.values()],
      state: runtime.state,
    }
  }

  async #withLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(threadId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.#locks.set(threadId, current)
    try {
      return await current
    } finally {
      if (this.#locks.get(threadId) === current) this.#locks.delete(threadId)
    }
  }
}
