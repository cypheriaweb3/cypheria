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
  type ThreadContextUsage,
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
  activeTurn: { id: string; startedAt: string; captureId?: string | null } | null
  capabilities: ThreadView["capabilities"]
  contextUsage: ThreadContextUsage | null
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
  readonly onArchived?: (cwd: string) => Promise<void>
  readonly onUnarchiving?: (cwd: string) => Promise<void>
  readonly timelinePersistence: ThreadTimelinePersistenceService
  readonly turnCapture?: {
    start(threadId: string, cwd: string): Promise<string>
    complete(captureId: string, turnId: string): Promise<void>
    discard(captureId: string): Promise<void>
  }
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
  readonly #onArchived: ThreadManagerOptions["onArchived"]
  readonly #onUnarchiving: ThreadManagerOptions["onUnarchiving"]
  readonly #runtime = new Map<string, RuntimeState>()
  readonly #timeline: ThreadTimelineStore
  readonly #turnCapture: ThreadManagerOptions["turnCapture"]

  constructor(options: ThreadManagerOptions) {
    this.#adapterFor = options.adapterFor
    this.#assertAgentCallable = options.assertAgentCallable
    this.#lifecycle = options.lifecycle
    this.#messageRequests = options.messageRequests
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#onArchived = options.onArchived
    this.#onUnarchiving = options.onUnarchiving
    this.#timeline = new ThreadTimelineStore(options.timelinePersistence)
    this.#turnCapture = options.turnCapture
  }

  async initialize(): Promise<void> {
    for (const operation of await this.#lifecycle.listRecoverable()) {
      await this.#recover(operation)
    }
  }

  async cleanupDeletedThreads(): Promise<void> {
    for (const operation of await this.#lifecycle.listRecoverable()) {
      if (operation.kind !== "delete") continue
      await this.#withLock(operation.threadId, async () => {
        if (await this.#lifecycle.get(operation.id)) await this.#recover(operation)
      })
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
        case "thread.recency.touch.request": {
          const thread = await this.#persistence.touchThreadRecency(
            message.payload.threadId,
            message.payload.recencyAt
          )
          respond(await this.#updateAndPublish(thread))
          await this.#publishThreadProject(thread.id)
          break
        }
        case "thread.move.request":
          await this.#persistence.moveThread(message.payload)
          respond({})
          await this.#publishThreads()
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
        case "thread.context.usage.get.request":
          respond(await this.getContextUsage(message.payload.threadId))
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
      const placement = input.projectPlacement
      const project = placement
        ? await this.#persistence.getProject(placement.projectId)
        : undefined
      if (placement && !project) {
        throw new ThreadManagerError("PROJECT_NOT_FOUND", "Project was not found")
      }
      const cwd = project ? this.#projectCwd(project.roots, input.cwd) : (input.cwd ?? null)
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
          cwd,
          forkedFromAgentSessionId: source?.agentSessionId ?? null,
          onEvent: (event) => this.#acceptEvent(threadId, event),
          threadId,
          ...(project ? { workspaceRoots: project.roots } : {}),
        })
        harnessSessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "harness-created",
        })
        const thread = await this.#persistence.createThread({
          ...input,
          agentSessionId: session.sessionId,
          cwd,
          id: threadId,
        })
        databaseCommitted = true
        this.#runtime.set(threadId, {
          activeTurn: null,
          capabilities: session.capabilities,
          contextUsage: null,
          pendingInteractions: new Map(),
          state: "idle",
        })
        if (session.history) await this.#timeline.replace(threadId, session.history)
        const timeline = await this.#timeline.head(threadId)
        await this.#lifecycle.complete(operation.id)
        const view = this.#view(thread)
        this.#publish({ payload: view, type: "thread.created.notification" })
        const [projectMembership, sectionMembership] = await Promise.all([
          this.#persistence.getThreadProject(thread.id),
          this.#persistence.getItemSection({ id: thread.id, type: "thread" }),
        ])
        if (projectMembership) {
          await this.#publishProjectMemberships(projectMembership.project.id)
          await this.#publishThreadProject(thread.id)
        }
        if (sectionMembership) {
          await this.#publishSectionMemberships(sectionMembership.section.id)
        }
        return { thread: view, timeline }
      } catch (error) {
        if (databaseCommitted) {
          // Leave harness-created state for startup recovery to complete journal cleanup.
        } else if (harnessSessionId !== undefined) {
          try {
            await adapter.delete({
              agentId,
              agentSessionId: harnessSessionId,
              cwd,
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
      const nextPatch = { ...patch }
      if (patch.cwd !== undefined) {
        const membership = await this.#persistence.getThreadProject(threadId)
        if (membership) nextPatch.cwd = this.#projectCwd(membership.project.roots, patch.cwd)
      }
      return this.#updateAndPublish(await this.#persistence.updateThread(threadId, nextPatch))
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
      const membership = await this.#persistence.getThreadProject(threadId)
      const nextCwd = membership ? this.#projectCwd(membership.project.roots, cwd) : cwd
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
        moved = await this.#persistence.updateThread(threadId, { cwd: nextCwd })
        if (wasIdle) {
          const session = await adapter.resume({
            ...(await this.#resumeContext(moved)),
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
              ...(await this.#resumeContext(thread)),
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
    const sourceProject = await this.#persistence.getThreadProject(source.id)
    return this.create({
      agentId: source.agentId,
      beforeThreadId: input.beforeThreadId,
      cwd: input.cwd === undefined ? source.cwd : input.cwd,
      forkedFromId: source.id,
      projectPlacement:
        input.projectPlacement ??
        (sourceProject ? { projectId: sourceProject.project.id } : undefined),
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
          ...(await this.#resumeContext(thread)),
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
    const archived = await this.#withLock(threadId, async () => {
      const current = await this.#required(threadId)
      if (current.archivedAt !== null) return this.#view(current)
      return this.#updateAndPublish(
        await this.#persistence.setThreadArchived(threadId, Math.floor(Date.now() / 1000))
      )
    })
    if (archived.cwd) await this.#onArchived?.(archived.cwd).catch(() => undefined)
    await this.#publishThreadProject(threadId)
    return archived
  }

  async unarchive(threadId: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      if (thread.archivedAt === null) return this.#view(thread)
      if (thread.cwd) await this.#onUnarchiving?.(thread.cwd)
      const unarchived = await this.#updateAndPublish(
        await this.#persistence.setThreadArchived(threadId, null)
      )
      await this.#publishThreadProject(threadId)
      return unarchived
    })
  }

  async delete(threadId: string): Promise<void> {
    const initial = await this.#required(threadId)
    const cwd = initial.cwd
    const project = await this.#persistence.getThreadProject(threadId)
    const section = await this.#persistence.getItemSection({ id: threadId, type: "thread" })
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
      let tombstoned = false
      try {
        await this.#persistence.markThreadDeleting(threadId)
        tombstoned = true
        this.#publish({ payload: { threadId }, type: "thread.deleted.notification" })
        if (project) {
          this.#publish({
            payload: { threadId },
            type: "project.membership.deleted.notification",
          })
        }
        if (section) {
          this.#publish({
            payload: { item: { id: threadId, type: "thread" } },
            type: "section.membership.deleted.notification",
          })
        }
        await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
        harnessDeleted = true
        await this.#lifecycle.transition(operation.id, { status: "harness-deleted" })
        await this.#persistence.purgeThread(threadId)
        await this.#lifecycle.complete(operation.id)
        this.#runtime.delete(threadId)
        await this.#timeline.delete(threadId)
        if (project) {
          await this.#publishProjectMemberships(project.project.id)
          await this.#publishProject(project.project.id)
        }
        if (section) await this.#publishSectionMemberships(section.section.id)
      } catch (error) {
        runtime.state = "errored"
        if (!harnessDeleted) {
          await this.#lifecycle.fail(operation.id, this.#message(error)).catch(() => undefined)
        }
        if (!tombstoned) {
          this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
        }
        throw error
      }
    })
    if (cwd) await this.#onArchived?.(cwd).catch(() => undefined)
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
      const captureId =
        thread.agentId === "codex" && thread.cwd && this.#turnCapture
          ? await this.#turnCapture.start(thread.id, thread.cwd).catch(() => null)
          : null
      let started: Awaited<ReturnType<ThreadHarnessAdapter["startTurn"]>>
      try {
        started = await this.#adapterFor(thread.agentId as AgentId, thread.id).startTurn({
          ...(await this.#resumeContext(thread)),
          clientMessageId: input.clientMessageId,
          content: input.content,
        })
      } catch (error) {
        if (captureId) await this.#turnCapture?.discard(captureId).catch(() => undefined)
        throw error
      }
      const { agentMessageId, turnId } = started
      runtime.activeTurn = { id: turnId, startedAt: new Date().toISOString(), captureId }
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
      if (runtime.activeTurn?.captureId)
        await this.#turnCapture
          ?.complete(runtime.activeTurn.captureId, target)
          .catch(() => undefined)
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
      speed?: string | null
      thinking?: string | null
    }
  ): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      await this.#adapterFor(thread.agentId as AgentId, thread.id).updateConfig(
        this.#context(thread),
        patch
      )
      if (patch.model !== undefined) this.#publishContextUsage(threadId, null)
      return this.#updateAndPublishSync(thread)
    })
  }

  async getContextUsage(threadId: string): Promise<ThreadContextUsage | null> {
    const thread = await this.#required(threadId)
    const runtime = this.#state(threadId)
    if (runtime.state === "stopped" || runtime.state === "deleting") return runtime.contextUsage
    const usage = await this.#adapterFor(thread.agentId as AgentId, thread.id).getContextUsage(
      this.#context(thread)
    )
    if (usage) this.#publishContextUsage(threadId, usage)
    return usage ?? runtime.contextUsage
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
        case "context-usage":
          this.#publishContextUsage(threadId, event.usage)
          break
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
            const captureId = runtime.activeTurn?.captureId
            if (captureId)
              await this.#turnCapture
                ?.complete(captureId, runtime.activeTurn?.id ?? event.turnId)
                .catch(() => undefined)
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
          if (runtime.activeTurn?.captureId)
            await this.#turnCapture?.discard(runtime.activeTurn.captureId).catch(() => undefined)
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

  async #resumeContext(thread: ThreadRecord): Promise<ThreadHarnessContext> {
    const membership = await this.#persistence.getThreadProject(thread.id)
    return {
      ...this.#context(thread),
      ...(membership ? { workspaceRoots: membership.project.roots } : {}),
    }
  }

  #projectCwd(roots: readonly string[], requested: string | null | undefined): string {
    const normalizedRoots = [...new Set(roots.map((root) => resolve(root)))]
    const cwd = resolve(requested ?? normalizedRoots[0] ?? "")
    if (!isAbsolute(cwd) || !normalizedRoots.includes(cwd)) {
      throw new ThreadManagerError(
        "THREAD_CWD_OUTSIDE_PROJECT",
        "Thread cwd must match one of the project workspace roots"
      )
    }
    return cwd
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
      const deletedThread = (await this.#persistence.listDeletedResources())
        .flatMap((resource) => (resource.type === "thread" ? [resource.value] : []))
        .find((value) => value.id === operation.threadId)
      const thread = (await this.#persistence.getThread(operation.threadId)) ?? deletedThread
      if (operation.status === "harness-deleted") {
        if (thread) await this.#persistence.purgeThread(thread.id)
        await this.#lifecycle.complete(operation.id)
        return
      }
      if (!thread) {
        await this.#lifecycle.complete(operation.id)
        return
      }
      await this.#adapterFor(thread.agentId as AgentId, thread.id).delete(this.#context(thread))
      await this.#lifecycle.transition(operation.id, { status: "harness-deleted" })
      if (thread.deletedAt === null) await this.#persistence.markThreadDeleting(thread.id)
      await this.#persistence.purgeThread(thread.id)
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
        contextUsage: null,
        pendingInteractions: new Map(),
        state: "stopped",
      }
      this.#runtime.set(threadId, state)
    }
    return state
  }

  #publishContextUsage(threadId: string, usage: ThreadContextUsage | null): void {
    this.#state(threadId).contextUsage = usage
    this.#publish({
      payload: { threadId, usage },
      type: "thread.context.usage.updated.notification",
    })
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

  async #publishProjectMemberships(projectId: string): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listProjectMemberships({
        cursor,
        limit: 200,
        projectId,
      })
      for (const membership of page.data) {
        this.#publish({
          payload: membership,
          type: "project.membership.upserted.notification",
        })
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  async #publishProject(projectId: string): Promise<void> {
    const project = await this.#persistence.getProject(projectId)
    if (project) this.#publish({ payload: project, type: "project.updated.notification" })
  }

  async #publishThreadProject(threadId: string): Promise<void> {
    const membership = await this.#persistence.getThreadProject(threadId)
    if (membership) await this.#publishProject(membership.project.id)
  }

  async #publishThreads(): Promise<void> {
    for (const archived of [false, true]) {
      let cursor: string | null = null
      do {
        const page = await this.#persistence.listThreads({ archived, cursor, limit: 200 })
        for (const thread of page.data) {
          this.#publish({ payload: this.#view(thread), type: "thread.updated.notification" })
        }
        cursor = page.nextCursor
      } while (cursor)
    }
  }

  async #publishSectionMemberships(sectionId: string): Promise<void> {
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listSectionMemberships({
        cursor,
        limit: 200,
        sectionId,
      })
      for (const membership of page.data) {
        this.#publish({
          payload: membership,
          type: "section.membership.upserted.notification",
        })
      }
      cursor = page.nextCursor
    } while (cursor)
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

import { isAbsolute, resolve } from "node:path"
