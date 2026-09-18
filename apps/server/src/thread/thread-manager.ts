import type {
  CreateThreadInput,
  ProjectThreadPersistenceService,
  ThreadLifecycleOperationRecord,
  ThreadLifecyclePersistenceService,
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
  ThreadInteractionResponse,
  ThreadProviderAdapter,
  ThreadProviderContext,
  ThreadProviderEvent,
} from "./provider-adapter.js"
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
  readonly adapterFor: (agentId: AgentId, threadId: string) => ThreadProviderAdapter
  readonly assertAgentCallable: (agentId: AgentId) => Promise<void>
  readonly lifecycle: ThreadLifecyclePersistenceService
  readonly persistence: ProjectThreadPersistenceService
  readonly publish: Publish
  readonly timelinePersistence: ThreadTimelinePersistenceService
}

const stoppedCapabilities: ThreadView["capabilities"] = {
  changeCwd: true,
  configure: false,
  fork: false,
  promptContent: ["text"],
  providerExtensions: false,
  steer: false,
}

export class ThreadManager {
  readonly #adapterFor: ThreadManagerOptions["adapterFor"]
  readonly #assertAgentCallable: ThreadManagerOptions["assertAgentCallable"]
  readonly #lifecycle: ThreadLifecyclePersistenceService
  readonly #locks = new Map<string, Promise<unknown>>()
  readonly #persistence: ProjectThreadPersistenceService
  readonly #publish: Publish
  readonly #runtime = new Map<string, RuntimeState>()
  readonly #timeline: ThreadTimelineStore
  readonly #turnRequests = new Map<string, Map<string, string>>()

  constructor(options: ThreadManagerOptions) {
    this.#adapterFor = options.adapterFor
    this.#assertAgentCallable = options.assertAgentCallable
    this.#lifecycle = options.lifecycle
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
      let providerSessionId: string | null | undefined
      try {
        const session = await adapter.create({
          agentId,
          cwd: input.cwd ?? null,
          forkedFromAgentSessionId: source?.agentSessionId ?? null,
          onEvent: (event) => this.#acceptEvent(threadId, event),
          threadId,
        })
        providerSessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "provider-created",
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
          // Leave provider-created state for startup recovery to complete journal cleanup.
        } else if (providerSessionId !== undefined) {
          try {
            await adapter.delete({
              agentId,
              agentSessionId: providerSessionId,
              cwd: input.cwd ?? null,
              threadId,
            })
            await this.#lifecycle
              .fail(operation.id, `Provider create was compensated: ${this.#message(error)}`)
              .catch(() => undefined)
          } catch {
            // Keep provider-created durable state so startup recovery can finish the DB commit.
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
            "Provider resumed a different session"
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
        await this.#timeline.replace(threadId, session.history ?? [])
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
      let providerDeleted = false
      try {
        await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
        providerDeleted = true
        await this.#lifecycle.transition(operation.id, { status: "provider-deleted" })
        await this.#persistence.deleteThread(threadId)
        await this.#lifecycle.complete(operation.id)
        this.#runtime.delete(threadId)
        await this.#timeline.delete(threadId)
        this.#turnRequests.delete(threadId)
        this.#publish({ payload: { threadId }, type: "thread.deleted.notification" })
      } catch (error) {
        runtime.state = "errored"
        if (!providerDeleted) {
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
    if (stored.archivedAt !== null) {
      throw new ThreadManagerError("THREAD_ARCHIVED", "Archived threads must be unarchived first")
    }
    if (this.#state(input.threadId).state === "stopped") await this.resume(input.threadId)
    return this.#withLock(input.threadId, async () => {
      const thread = await this.#required(input.threadId)
      const runtime = this.#state(thread.id)
      const previous = this.#turnRequests.get(thread.id)?.get(input.clientMessageId)
      if (previous) return { thread: this.#view(thread), turnId: previous }
      if (runtime.activeTurn) {
        throw new ThreadManagerError("THREAD_BUSY", "Thread already has an active turn")
      }
      if (runtime.state !== "idle") {
        throw new ThreadManagerError("THREAD_NOT_READY", `Thread is ${runtime.state}`)
      }
      const { turnId } = await this.#adapterFor(thread.agentId as AgentId, thread.id).startTurn({
        ...this.#context(thread),
        clientMessageId: input.clientMessageId,
        content: input.content,
      })
      let requests = this.#turnRequests.get(thread.id)
      if (!requests) {
        requests = new Map()
        this.#turnRequests.set(thread.id, requests)
      }
      requests.set(input.clientMessageId, turnId)
      runtime.activeTurn = { id: turnId, startedAt: new Date().toISOString() }
      runtime.state = "running"
      await this.#appendUserInput(thread.id, turnId, input.clientMessageId, input.content)
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
      const previous = this.#turnRequests.get(thread.id)?.get(input.clientMessageId)
      if (previous) return { thread: this.#view(thread), turnId: previous }
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
      await this.#adapterFor(thread.agentId as AgentId, thread.id).steerTurn({
        ...this.#context(thread),
        clientMessageId: input.clientMessageId,
        content: input.content,
        turnId,
      })
      let requests = this.#turnRequests.get(thread.id)
      if (!requests) {
        requests = new Map()
        this.#turnRequests.set(thread.id, requests)
      }
      requests.set(input.clientMessageId, turnId)
      await this.#appendUserInput(thread.id, turnId, input.clientMessageId, input.content)
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

  #acceptEvent(threadId: string, event: ThreadProviderEvent): void {
    void this.#withLock(threadId, async () => {
      const thread = await this.#persistence.getThread(threadId)
      if (!thread) return
      const runtime = this.#state(threadId)
      switch (event.type) {
        case "timeline":
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
              code: "PROVIDER_ERROR",
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
      }
    })
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
    content: readonly ThreadInputBlock[]
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
    if (!text && attachments.length === 0) return
    await this.#appendTimeline(threadId, {
      item: {
        ...(attachments.length > 0 ? { attachments } : {}),
        itemId: `user:${clientMessageId}`,
        operation: "replace",
        role: "user",
        text,
        type: "message",
      },
      turnId,
    })
  }

  #context(thread: ThreadRecord): ThreadProviderContext {
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
        if (operation.status === "provider-created") {
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
          "Interrupted before the provider session identity was committed"
        )
        return
      }
      const thread = await this.#persistence.getThread(operation.threadId)
      if (operation.status === "provider-deleted") {
        if (thread) await this.#persistence.deleteThread(thread.id)
        await this.#lifecycle.complete(operation.id)
        return
      }
      if (!thread) {
        await this.#lifecycle.complete(operation.id)
        return
      }
      await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
      await this.#lifecycle.transition(operation.id, { status: "provider-deleted" })
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
