import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
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
import { createThreadId, PINNED_SECTION_ID } from "@cypheria/db"
import {
  type AgentId,
  type ClientKind,
  type ServerMessage,
  type ThreadClientMessage,
  type ThreadConfig,
  ThreadConfigSchema,
  type ThreadContextUsage,
  type ThreadInputBlock,
  type ThreadInteraction,
  ThreadSchema,
  type ThreadServerMessage,
  type ThreadState,
  type ThreadTimelineCursor,
  type ThreadView,
} from "@cypheria/protocol"
import type {
  ThreadHarnessAdapter,
  ThreadHarnessContext,
  ThreadHarnessEvent,
  ThreadHarnessHistoryItem,
  ThreadInteractionResponse,
} from "./harness-adapter.js"
import type { InputFileService } from "./input-file-service.js"
import {
  createProjectlessWorkspace,
  isManagedProjectlessWorkspace,
  pruneProjectlessDateDirectory,
} from "./projectless-workspace.js"
import { ThreadTimelineStore } from "./timeline-store.js"

type Publish = (message: ServerMessage) => void
type CreatePublicThreadInput = Omit<
  CreateThreadInput,
  "agentSessionId" | "config" | "forkedFromId" | "id" | "roots"
> & {
  config?: ThreadConfig
  /** Text the projectless directory name derives from. Defaults to the title. */
  workspaceName?: string | null
}

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
  readonly inputFiles?: InputFileService
  readonly resolveReference?: (
    input: Extract<ThreadInputBlock, { type: "reference" }>,
    context: {
      agentId: AgentId
      cwd: string | null
      threadId: string
      workspaceRoots?: readonly string[]
    }
  ) => Promise<ThreadInputBlock>
  readonly messageRequests: ThreadMessageRequestPersistenceService
  readonly persistence: ProjectThreadPersistenceService
  readonly publish: Publish
  readonly resolveInitialConfig?: (
    agentId: AgentId,
    requested?: ThreadConfig
  ) => Promise<ThreadConfig>
  readonly projectlessWorkspaceRoot?: string
  readonly onArchived?: (threadId: string, cwd: string) => Promise<void>
  readonly onDeleting?: (threadId: string) => Promise<void>
  readonly onUnarchiving?: (cwd: string) => Promise<void>
  readonly timelinePersistence: ThreadTimelinePersistenceService
  readonly turnCapture?: {
    start(threadId: string, cwd: string): Promise<string>
    complete(captureId: string, turnId: string): Promise<void>
    discard(captureId: string): Promise<void>
  }
}

const stoppedCapabilities: ThreadView["capabilities"] = {
  changeCwd: false,
  changeRoots: false,
  configure: false,
  fork: { assistantMessage: false, threadHead: false, userMessage: false },
  promptContent: ["text"],
  rewind: { userMessage: false },
  harnessExtensions: false,
  steer: false,
}

export class ThreadManager {
  readonly #adapterFor: ThreadManagerOptions["adapterFor"]
  readonly #assertAgentCallable: ThreadManagerOptions["assertAgentCallable"]
  readonly #lifecycle: ThreadLifecyclePersistenceService
  readonly #inputFiles: InputFileService | undefined
  readonly #resolveReference: ThreadManagerOptions["resolveReference"]
  readonly #locks = new Map<string, Promise<unknown>>()
  readonly #messageRequests: ThreadMessageRequestPersistenceService
  readonly #persistence: ProjectThreadPersistenceService
  readonly #publish: Publish
  readonly #resolveInitialConfig: NonNullable<ThreadManagerOptions["resolveInitialConfig"]>
  #projectlessWorkspaceRoot: string
  readonly #onArchived: ThreadManagerOptions["onArchived"]
  readonly #onDeleting: ThreadManagerOptions["onDeleting"]
  readonly #onUnarchiving: ThreadManagerOptions["onUnarchiving"]
  readonly #runtime = new Map<string, RuntimeState>()
  readonly #timeline: ThreadTimelineStore
  readonly #turnCapture: ThreadManagerOptions["turnCapture"]

  constructor(options: ThreadManagerOptions) {
    this.#adapterFor = options.adapterFor
    this.#assertAgentCallable = options.assertAgentCallable
    this.#lifecycle = options.lifecycle
    this.#inputFiles = options.inputFiles
    this.#resolveReference = options.resolveReference
    this.#messageRequests = options.messageRequests
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#resolveInitialConfig =
      options.resolveInitialConfig ??
      (async (agentId, requested) =>
        ThreadConfigSchema.parse(
          requested ?? {
            model: null,
            permissionsMode: agentId === "codex" ? "auto" : null,
            speed: null,
            thinking: null,
          }
        ))
    this.#projectlessWorkspaceRoot = resolve(
      options.projectlessWorkspaceRoot ?? join(homedir(), "Documents", "Cypheria")
    )
    this.#onArchived = options.onArchived
    this.#onDeleting = options.onDeleting
    this.#onUnarchiving = options.onUnarchiving
    this.#timeline = new ThreadTimelineStore(options.timelinePersistence)
    this.#turnCapture = options.turnCapture
  }

  async initialize(): Promise<void> {
    for (const operation of await this.#lifecycle.listRecoverable()) {
      await this.#recover(operation)
    }
  }

  setProjectlessWorkspaceRoot(path: string): void {
    this.#projectlessWorkspaceRoot = resolve(path)
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
    send: (message: ServerMessage) => void,
    context: { readonly clientKind?: ClientKind } = {}
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
        case "thread.rewind.request":
          respond(await this.rewind(message.payload))
          break
        case "thread.close.request":
          respond(await this.close(message.payload.threadId))
          break
        case "thread.archive.request":
          respond(await this.archive(message.payload.threadId))
          break
        case "thread.archive_many.request":
          respond(await this.archiveMany(message.payload.threadIds))
          break
        case "thread.unarchive.request":
          respond(await this.unarchive(message.payload.threadId))
          break
        case "thread.delete.request":
          await this.delete(message.payload.threadId)
          respond({})
          break
        case "thread.turn.start.request":
          respond(
            await this.startTurn({
              ...message.payload,
              ...(context.clientKind ? { clientKind: context.clientKind } : {}),
            })
          )
          break
        case "thread.turn.steer.request":
          respond(await this.steerTurn(message.payload))
          break
        case "thread.turn.cancel.request":
          respond(await this.cancelTurn(message.payload.threadId, message.payload.turnId))
          break
        case "thread.workspace.sync.request":
          respond(await this.syncWorkspace(message.payload.threadId, message.payload.mode))
          break
        case "thread.timeline.get.request":
          await this.#required(message.payload.threadId)
          respond(await this.#timeline.page(message.payload.threadId, message.payload))
          break
        case "thread.summary.get.request":
          await this.#required(message.payload.threadId)
          respond(await this.#timeline.summary(message.payload.threadId))
          break
        case "thread.context.usage.get.request":
          respond(await this.getContextUsage(message.payload.threadId))
          break
        case "thread.config.update.request": {
          respond(await this.updateConfig(message.payload.threadId, message.payload.patch))
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

  async create(request: CreatePublicThreadInput): Promise<{
    thread: ThreadView
    timeline: Awaited<ReturnType<ThreadTimelineStore["head"]>>
  }> {
    const { workspaceName, ...input } = request
    const threadId = createThreadId()
    return this.#withLock(threadId, async () => {
      const agentId = input.agentId as AgentId
      await this.#assertAgentCallable(agentId)
      const placement = input.projectPlacement
      const project = placement
        ? await this.#persistence.getProject(placement.projectId)
        : undefined
      if (placement && !project) {
        throw new ThreadManagerError("PROJECT_NOT_FOUND", "Project was not found")
      }
      const projectlessRoot = project
        ? null
        : await this.#createProjectlessWorkspace(threadId, workspaceName ?? input.title)
      const roots = project ? [...project.roots] : [projectlessRoot as string]
      const cwd = roots[0] as string
      const config = await this.#resolveInitialConfig(agentId, input.config)
      const operation = await this.#lifecycle.begin({
        agentId,
        input: { ...input, config, roots },
        kind: "create",
        threadId,
      })
      const adapter = this.#adapterFor(agentId, threadId)
      let databaseCommitted = false
      let harnessSessionId: string | null | undefined
      try {
        const session = await adapter.create({
          agentId,
          config,
          cwd,
          onEvent: (event) => this.#acceptEvent(threadId, event),
          threadId,
          workspaceRoots: roots,
        })
        harnessSessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "harness-created",
        })
        const thread = await this.#persistence.createThread({
          ...input,
          agentSessionId: session.sessionId,
          config: session.config ?? config,
          id: threadId,
          roots,
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
              config,
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
        if (!databaseCommitted && projectlessRoot) {
          await this.#removeProjectlessWorkspace(projectlessRoot).catch(() => undefined)
        }
        throw error
      }
    })
  }

  async get(threadId: string): Promise<ThreadView> {
    return this.#view(await this.#required(threadId))
  }

  async getComposerContext(threadId: string): Promise<ThreadHarnessContext> {
    return this.#resumeContext(await this.#required(threadId))
  }

  async getTimeline(threadId: string, limit = 10, before?: { epoch: string; seq: number }) {
    await this.#required(threadId)
    return this.#timeline.page(threadId, {
      ...(before ? { cursor: before } : {}),
      direction: before ? "before" : "tail",
      limit,
      projection: "projected",
    })
  }

  async prepareComposerInput(
    threadId: string,
    content: readonly ThreadInputBlock[]
  ): Promise<ThreadInputBlock[]> {
    return this.#prepareInput(content, await this.#required(threadId))
  }

  async list(options: Parameters<ProjectThreadPersistenceService["listThreads"]>[0]) {
    const page = await this.#persistence.listThreads(options)
    return { ...page, data: page.data.map((thread) => this.#view(thread)) }
  }

  async update(threadId: string, patch: { title?: string | null }): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const updated = await this.#persistence.updateThread(threadId, patch)
      const view = await this.#updateAndPublish(updated)
      if (patch.title !== undefined) {
        await this.#adapterFor(updated.agentId as AgentId, updated.id)
          .rename(this.#context(updated), patch.title)
          .catch((error) =>
            this.#publish({
              payload: {
                event: {
                  code: "PROVIDER_RENAME_FAILED",
                  message: this.#message(error),
                  type: "warning",
                },
                threadId,
              },
              type: "thread.event.notification",
            })
          )
      }
      return view
    })
  }

  /** Internal Git worktree handoff. Public Thread workspace changes use membership or sync APIs. */
  async moveWorkingDirectory(threadId: string, cwd: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(threadId)
      this.#assertWorkspaceMutationAllowed(thread, runtime)
      const nextCwd = resolve(cwd)
      if (thread.roots[0] === nextCwd) return this.#view(thread)
      const capabilities = this.#capabilities(thread, runtime)
      if (!capabilities.changeCwd || !capabilities.changeRoots) {
        throw new ThreadManagerError(
          "THREAD_WORKSPACE_UNSUPPORTED",
          "This Agent cannot change the thread workspace after creation"
        )
      }
      const roots = [nextCwd, ...thread.roots.slice(1).filter((root) => root !== nextCwd)]
      const updated = await this.#commitWorkspaceMutation(thread, roots, () =>
        this.#persistence.updateThread(threadId, { roots })
      )
      return this.#updateAndPublishSync(updated)
    })
  }

  async syncWorkspace(
    threadId: string,
    mode: "safe-additive" | "project-exact"
  ): Promise<{ changed: boolean; thread: ThreadView }> {
    return this.#withLock(threadId, async () => this.#syncWorkspaceUnlocked(threadId, mode))
  }

  async moveToProject(input: {
    beforeThreadId?: string | null
    projectId: string
    threadId: string
  }) {
    return this.#withLock(input.threadId, async () => {
      const thread = await this.#required(input.threadId)
      const runtime = this.#state(thread.id)
      this.#assertWorkspaceMutationAllowed(thread, runtime)
      const project = await this.#persistence.getProject(input.projectId)
      if (!project) throw new ThreadManagerError("PROJECT_NOT_FOUND", "Project was not found")
      const cwdChanged = thread.roots[0] !== project.roots[0]
      const capabilities = this.#capabilities(thread, runtime)
      const rootsChanged =
        thread.roots.length !== project.roots.length ||
        thread.roots.some((root, index) => root !== project.roots[index])
      if (rootsChanged && (!capabilities.changeRoots || (cwdChanged && !capabilities.changeCwd))) {
        throw new ThreadManagerError(
          "THREAD_WORKSPACE_UNSUPPORTED",
          "This Agent cannot change the thread workspace after creation"
        )
      }
      const previous = await this.#persistence.getThreadProject(thread.id)
      const projectlessRoot = !previous && thread.roots.length === 1 ? thread.roots[0] : undefined
      const membership = rootsChanged
        ? await this.#commitWorkspaceMutation(thread, project.roots, () =>
            this.#persistence.moveThreadToProject(input)
          )
        : await this.#persistence.moveThreadToProject(input)
      const updated = await this.#required(thread.id)
      const warnings: Array<{ code: string; message: string }> = []
      if (
        projectlessRoot &&
        this.#isManagedProjectlessRoot(projectlessRoot) &&
        (await this.#persistence.countProjectlessRootReferences(projectlessRoot)) === 0
      ) {
        await this.#removeProjectlessWorkspace(projectlessRoot).catch((error) => {
          warnings.push({ code: "WORKSPACE_CLEANUP_FAILED", message: this.#message(error) })
        })
      }
      return { membership, thread: this.#updateAndPublishSync(updated), warnings }
    })
  }

  async removeFromProject(threadId: string) {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      const runtime = this.#state(thread.id)
      this.#assertWorkspaceMutationAllowed(thread, runtime)
      const membership = await this.#persistence.getThreadProject(thread.id)
      if (!membership) {
        return {
          thread: this.#view(thread),
          warnings: [] as Array<{ code: string; message: string }>,
        }
      }
      const capabilities = this.#capabilities(thread, runtime)
      if (!capabilities.changeCwd || !capabilities.changeRoots) {
        throw new ThreadManagerError(
          "THREAD_WORKSPACE_UNSUPPORTED",
          "This Agent cannot change the thread workspace after creation"
        )
      }
      const root = await this.#createProjectlessWorkspace(thread.id, thread.title)
      try {
        await this.#commitWorkspaceMutation(thread, [root], () =>
          this.#persistence.removeThreadFromProject(thread.id, [root])
        )
      } catch (error) {
        await rm(root, { force: true, recursive: true }).catch(() => undefined)
        throw error
      }
      return {
        thread: this.#updateAndPublishSync(await this.#required(thread.id)),
        warnings: [] as Array<{ code: string; message: string }>,
      }
    })
  }

  async deleteProject(projectId: string) {
    const memberships: Array<{ threadId: string }> = []
    let cursor: string | null = null
    do {
      const page = await this.#persistence.listProjectMemberships({
        cursor,
        limit: 200,
        projectId,
      })
      memberships.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    const threadIds = memberships.map(({ threadId }) => threadId).sort()
    return this.#withLocks(threadIds, async () => {
      const assignments: Array<{ roots: string[]; thread: ThreadRecord }> = []
      try {
        for (const threadId of threadIds) {
          const thread = await this.#required(threadId)
          const runtime = this.#state(thread.id)
          this.#assertWorkspaceMutationAllowed(thread, runtime)
          const capabilities = this.#capabilities(thread, runtime)
          if (!capabilities.changeCwd || !capabilities.changeRoots) {
            throw new ThreadManagerError(
              "THREAD_WORKSPACE_UNSUPPORTED",
              "Every project thread must support workspace changes before deleting the project"
            )
          }
          assignments.push({
            roots: [await this.#createProjectlessWorkspace(thread.id, thread.title)],
            thread,
          })
        }
        const commit = assignments.reduceRight<() => Promise<void>>(
          (next, assignment) => () =>
            this.#commitWorkspaceMutation(assignment.thread, assignment.roots, next),
          () =>
            this.#persistence.deleteProjectToProjectless(
              projectId,
              assignments.map(({ roots, thread }) => ({ roots, threadId: thread.id }))
            )
        )
        await commit()
      } catch (error) {
        await Promise.all(
          assignments.map(({ roots }) =>
            rm(roots[0] as string, { force: true, recursive: true }).catch(() => undefined)
          )
        )
        throw error
      }
      for (const { thread } of assignments) {
        this.#updateAndPublishSync(await this.#required(thread.id))
      }
      return {
        affectedThreads: assignments.length,
        warnings: [] as Array<{ code: string; message: string }>,
      }
    })
  }

  async #syncWorkspaceUnlocked(
    threadId: string,
    mode: "safe-additive" | "project-exact"
  ): Promise<{ changed: boolean; thread: ThreadView }> {
    const thread = await this.#required(threadId)
    const membership = await this.#persistence.getThreadProject(threadId)
    if (!membership) {
      if (mode === "safe-additive") return { changed: false, thread: this.#view(thread) }
      throw new ThreadManagerError("THREAD_NOT_IN_PROJECT", "Thread does not belong to a project")
    }
    const runtime = this.#state(threadId)
    if (runtime.activeTurn || runtime.state === "running") {
      if (mode === "safe-additive") return { changed: false, thread: this.#view(thread) }
      throw new ThreadManagerError("THREAD_ACTIVE", "Finish the current turn before syncing")
    }
    const capabilities = this.#capabilities(thread, runtime)
    const target = membership.project.roots
    if (
      thread.roots.length === target.length &&
      thread.roots.every((root, i) => root === target[i])
    ) {
      return { changed: false, thread: this.#view(thread) }
    }
    const cwdChanged = thread.roots[0] !== target[0]
    const supported = capabilities.changeRoots && (!cwdChanged || capabilities.changeCwd)
    if (mode === "safe-additive") {
      const additive =
        supported &&
        thread.roots[0] === target[0] &&
        thread.roots.every((root) => target.includes(root))
      if (!additive) return { changed: false, thread: this.#view(thread) }
    } else if (!supported) {
      throw new ThreadManagerError(
        "THREAD_WORKSPACE_UNSUPPORTED",
        "This Agent cannot change the thread workspace after creation"
      )
    }
    const updated = await this.#commitWorkspaceMutation(thread, target, () =>
      this.#persistence.updateThread(threadId, { roots: target })
    )
    return { changed: true, thread: this.#updateAndPublishSync(updated) }
  }

  async fork(input: {
    target:
      | { kind: "thread-head" }
      | { kind: "user-message"; cursor: ThreadTimelineCursor }
      | { kind: "assistant-message"; cursor: ThreadTimelineCursor }
    threadId: string
    title?: string | null
  }) {
    let source = await this.#required(input.threadId)
    if (input.target.kind === "thread-head" && this.#state(source.id).state === "stopped") {
      await this.resume(source.id)
      source = await this.#required(source.id)
    }
    if (!source.agentSessionId) {
      throw new ThreadManagerError("THREAD_FORK_UNAVAILABLE", "The source thread is not bound")
    }
    const resolved = await this.#resolveBranchTarget(source, input.target, "fork")
    const threadId = createThreadId()
    return this.#withLock(threadId, async () => {
      const placement = await this.#forkPlacement(source.id)
      const operation = await this.#lifecycle.begin({
        agentId: source.agentId,
        input: { sourceThreadId: source.id, target: input.target },
        kind: "fork",
        threadId,
      })
      const adapter = this.#adapterFor(source.agentId as AgentId, threadId)
      let sessionId: string | null | undefined
      let databaseCommitted = false
      try {
        const session = await adapter.fork({
          ...(await this.#resumeContext(source)),
          onEvent: (event) => this.#acceptEvent(threadId, event),
          sourceThreadId: source.id,
          target: resolved.target,
          threadId,
        })
        if (session.sessionId && session.sessionId === source.agentSessionId) {
          throw new ThreadManagerError(
            "THREAD_FORK_BINDING_REUSED",
            "Provider fork reused the source session binding"
          )
        }
        sessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: sessionId,
          status: "provider-branched",
        })
        const thread = await this.#persistence.createThread({
          agentId: source.agentId,
          agentSessionId: sessionId,
          beforeThreadId: placement.beforeThreadId,
          config: session.config ?? source.config,
          roots: source.roots,
          forkedFromId: source.id,
          id: threadId,
          projectPlacement: placement.projectPlacement,
          sectionPlacement: placement.sectionPlacement,
          title: input.title === undefined ? source.title : input.title,
        })
        databaseCommitted = true
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: sessionId,
          status: "binding-committed",
        })
        this.#runtime.set(threadId, {
          activeTurn: null,
          capabilities: session.capabilities,
          contextUsage: null,
          pendingInteractions: new Map(),
          state: "idle",
        })
        const history =
          session.history ??
          (input.target.kind === "thread-head" ? await this.#timeline.history(source.id) : [])
        await this.#timeline.replace(
          threadId,
          await this.#preserveHistoryIdentity(source.id, history)
        )
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: sessionId,
          status: "timeline-replaced",
        })
        const timeline = await this.#timeline.snapshot(threadId)
        await this.#lifecycle.complete(operation.id)
        const view = this.#view(thread)
        this.#publish({ payload: view, type: "thread.created.notification" })
        await this.#publishForkPlacement(threadId, placement)
        return { composerContent: resolved.composerContent, thread: view, timeline }
      } catch (error) {
        if (!databaseCommitted && sessionId !== undefined) {
          await adapter
            .delete({
              agentId: source.agentId as AgentId,
              agentSessionId: sessionId,
              config: source.config,
              cwd: source.roots[0] ?? null,
              threadId,
            })
            .catch(() => undefined)
        } else if (!databaseCommitted) {
          await adapter
            .close({
              agentId: source.agentId as AgentId,
              agentSessionId: source.agentSessionId,
              config: source.config,
              cwd: source.roots[0] ?? null,
              threadId,
            })
            .catch(() => undefined)
        }
        if (!databaseCommitted) {
          await this.#lifecycle.fail(operation.id, this.#message(error)).catch(() => undefined)
        }
        throw error
      }
    })
  }

  async rewind(input: {
    target: { kind: "user-message"; cursor: ThreadTimelineCursor }
    threadId: string
  }) {
    let source = await this.#required(input.threadId)
    if (!source.agentSessionId) {
      throw new ThreadManagerError("THREAD_REWIND_UNAVAILABLE", "The source thread is not bound")
    }
    const resolved = await this.#resolveBranchTarget(source, input.target, "rewind")
    if (this.#state(source.id).activeTurn) await this.cancelTurn(source.id)
    return this.#withLock(source.id, async () => {
      source = await this.#required(source.id)
      const operation = await this.#lifecycle.begin({
        agentId: source.agentId,
        agentSessionId: source.agentSessionId,
        input: { oldAgentSessionId: source.agentSessionId, target: input.target },
        kind: "rewind",
        threadId: source.id,
      })
      const adapter = this.#adapterFor(source.agentId as AgentId, source.id)
      let bindingCommitted = false
      let sessionId: string | null | undefined
      try {
        const session = await adapter.fork({
          ...(await this.#resumeContext(source)),
          onEvent: (event) => this.#acceptEvent(source.id, event),
          sourceThreadId: source.id,
          target: resolved.target,
        })
        if (session.sessionId && session.sessionId === source.agentSessionId) {
          throw new ThreadManagerError(
            "THREAD_FORK_BINDING_REUSED",
            "Provider fork reused the source session binding"
          )
        }
        sessionId = session.sessionId
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "provider-branched",
        })
        let rebound = await this.#persistence.bindThreadAgentSession(source.id, session.sessionId)
        if (session.config && JSON.stringify(session.config) !== JSON.stringify(rebound.config)) {
          rebound = await this.#persistence.updateThread(source.id, { config: session.config })
        }
        bindingCommitted = true
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "binding-committed",
        })
        const runtime = this.#state(source.id)
        runtime.activeTurn = null
        runtime.capabilities = session.capabilities
        runtime.pendingInteractions.clear()
        runtime.state = "idle"
        await this.#timeline.replace(
          source.id,
          await this.#preserveHistoryIdentity(source.id, session.history ?? [])
        )
        await this.#lifecycle.transition(operation.id, {
          agentSessionId: session.sessionId,
          status: "timeline-replaced",
        })
        const timeline = await this.#timeline.snapshot(source.id)
        await this.#lifecycle.complete(operation.id)
        const view = this.#view(rebound)
        this.#publish({
          payload: { epoch: timeline.epoch, reason: "history_changed", threadId: source.id },
          type: "thread.timeline.replaced.notification",
        })
        this.#publish({ payload: view, type: "thread.updated.notification" })
        return { composerContent: resolved.composerContent, thread: view, timeline }
      } catch (error) {
        if (!bindingCommitted) {
          const compensationFailures: unknown[] = []
          if (sessionId !== undefined) {
            await adapter
              .delete({
                agentId: source.agentId as AgentId,
                agentSessionId: sessionId,
                config: source.config,
                cwd: source.roots[0] ?? null,
                threadId: source.id,
              })
              .catch((cause) => compensationFailures.push(cause))
          } else {
            await adapter
              .close(this.#context(source))
              .catch((cause) => compensationFailures.push(cause))
          }
          try {
            const restored = await this.#adapterFor(source.agentId as AgentId, source.id).resume({
              ...(await this.#resumeContext(source)),
              onEvent: (event) => this.#acceptEvent(source.id, event),
            })
            const runtime = this.#state(source.id)
            runtime.capabilities = restored.capabilities
            runtime.state = "idle"
          } catch (cause) {
            compensationFailures.push(cause)
            this.#state(source.id).state = "errored"
          }
          await this.#lifecycle.fail(operation.id, this.#message(error)).catch(() => undefined)
          if (compensationFailures.length > 0) {
            throw new AggregateError(
              [error, ...compensationFailures],
              "Thread rewind and provider-session restoration failed"
            )
          }
        } else {
          const runtime = this.#state(source.id)
          runtime.state = "errored"
          this.#updateAndPublishSync(await this.#required(source.id))
        }
        throw error
      }
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
        if (session.config && JSON.stringify(session.config) !== JSON.stringify(thread.config)) {
          thread = await this.#persistence.updateThread(threadId, { config: session.config })
        }
        const runtime = this.#state(threadId)
        runtime.capabilities = session.capabilities
        runtime.state = "idle"
        runtime.activeTurn = null
        runtime.pendingInteractions.clear()
        if (session.history !== undefined) {
          await this.#timeline.replace(
            threadId,
            await this.#preserveHistoryIdentity(threadId, session.history)
          )
        }
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

  async archive(threadId: string): Promise<{
    thread: ThreadView
    warnings: Array<{ code: string; message: string }>
  }> {
    const thread = await this.#required(threadId)
    if (thread.archivedAt !== null) return { thread: this.#view(thread), warnings: [] }
    if (this.#state(threadId).activeTurn) await this.cancelTurn(threadId)
    if (this.#state(threadId).state !== "stopped") await this.close(threadId)
    const archived = await this.#withLock(threadId, async () => {
      const current = await this.#required(threadId)
      if (current.archivedAt !== null) return this.#view(current)
      return this.#updateAndPublish(
        await this.#persistence.setThreadArchived(threadId, Math.floor(Date.now() / 1000))
      )
    })
    const archivedCwd = archived.roots[0]
    if (archivedCwd) await this.#onArchived?.(threadId, archivedCwd).catch(() => undefined)
    const warnings: Array<{ code: string; message: string }> = []
    await this.#adapterFor(thread.agentId as AgentId, thread.id)
      .archive(this.#context(thread))
      .catch((error) => {
        const warning = { code: "PROVIDER_ARCHIVE_FAILED", message: this.#message(error) }
        warnings.push(warning)
        this.#publish({
          payload: { event: { ...warning, type: "warning" }, threadId },
          type: "thread.event.notification",
        })
      })
    await this.#publishThreadProject(threadId)
    return { thread: archived, warnings }
  }

  async archiveMany(threadIds: readonly string[]) {
    const succeeded: Array<Awaited<ReturnType<ThreadManager["archive"]>>> = []
    const failed: Array<{ code: string; message: string; threadId: string }> = []
    for (const threadId of [...new Set(threadIds)]) {
      try {
        succeeded.push(await this.archive(threadId))
      } catch (error) {
        failed.push({
          code: error instanceof ThreadManagerError ? error.code : "THREAD_ARCHIVE_FAILED",
          message: this.#message(error),
          threadId,
        })
      }
    }
    return { failed, succeeded }
  }

  async unarchive(threadId: string): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      const thread = await this.#required(threadId)
      if (thread.archivedAt === null) return this.#view(thread)
      const cwd = thread.roots[0]
      if (cwd) await this.#onUnarchiving?.(cwd)
      await this.#adapterFor(thread.agentId as AgentId, thread.id).unarchive(this.#context(thread))
      const unarchived = await this.#updateAndPublish(
        await this.#persistence.setThreadArchived(threadId, null)
      )
      await this.#publishThreadProject(threadId)
      return unarchived
    })
  }

  async delete(threadId: string): Promise<void> {
    const initial = await this.#required(threadId)
    const cwd = initial.roots[0]
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
        await this.#onDeleting?.(threadId)
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
    if (cwd) await this.#onArchived?.(threadId, cwd).catch(() => undefined)
    if (
      !project &&
      cwd &&
      this.#isManagedProjectlessRoot(cwd) &&
      (await this.#persistence.countProjectlessRootReferences(cwd)) === 0
    ) {
      await this.#removeProjectlessWorkspace(cwd).catch(() => undefined)
    }
  }

  async startTurn(input: {
    /** The kind of client that submitted the turn; schedules pass `schedule`. */
    clientKind?: ClientKind | "schedule"
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
      let thread = await this.#required(input.threadId)
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
      const synchronized = await this.#syncWorkspaceUnlocked(thread.id, "safe-additive")
      if (synchronized.changed) thread = await this.#required(thread.id)
      const adapterContent = await this.#prepareInput(input.content, thread)
      const claimed = await this.#messageRequests.claim({
        clientMessageId: input.clientMessageId,
        request,
        threadId: thread.id,
      })
      const claimedTurnId = this.#resolveMessageRequest(claimed)
      if (claimedTurnId) return { thread: this.#view(thread), turnId: claimedTurnId }
      const captureId =
        thread.agentId === "codex" && thread.roots[0] && this.#turnCapture
          ? await this.#turnCapture.start(thread.id, thread.roots[0]).catch(() => null)
          : null
      let started: Awaited<ReturnType<ThreadHarnessAdapter["startTurn"]>>
      try {
        started = await this.#adapterFor(thread.agentId as AgentId, thread.id).startTurn({
          ...(await this.#resumeContext(thread)),
          ...(input.clientKind ? { clientKind: input.clientKind } : {}),
          clientMessageId: input.clientMessageId,
          content: adapterContent,
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
        agentMessageId,
        "turn-user"
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
      const adapterContent = await this.#prepareInput(input.content, thread)
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
        content: adapterContent,
        turnId,
      })
      await this.#appendUserInput(
        thread.id,
        turnId,
        input.clientMessageId,
        input.content,
        result.agentMessageId,
        "steer-user"
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

  async updateConfig(threadId: string, patch: Partial<ThreadConfig>): Promise<ThreadView> {
    return this.#withLock(threadId, async () => {
      let thread = await this.#required(threadId)
      const config = ThreadConfigSchema.parse({ ...thread.config, ...patch })
      await this.#adapterFor(thread.agentId as AgentId, thread.id).updateConfig(
        this.#context(thread),
        config
      )
      thread = await this.#persistence.updateThread(threadId, { config })
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
          await this.#appendTimeline(threadId, {
            ...event.item,
            turnId: event.item.turnId ?? runtime.activeTurn?.id ?? null,
          })
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
            const completedTurnId = runtime.activeTurn?.id ?? event.turnId
            const finalized =
              event.successful === false
                ? null
                : await this.#timeline.finalizeAssistant(threadId, completedTurnId)
            if (finalized) {
              this.#publish({
                payload: { ...finalized, threadId },
                type: "thread.timeline.appended.notification",
              })
            }
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
    agentMessageId: string | undefined,
    boundary: "turn-user" | "steer-user"
  ): Promise<void> {
    const text = content
      .map((block) => {
        if (block.type === "text") return block.text
        if (block.type === "reference")
          return `${block.kind === "skill" || block.kind === "app" ? "$" : "@"}${block.label}`
        return ""
      })
      .join("")
    const attachments = content.filter(
      (block): block is Exclude<ThreadInputBlock, { type: "text" | "reference" }> =>
        block.type !== "text" && block.type !== "reference"
    )
    await this.#appendTimeline(threadId, {
      agentMessageId,
      item: {
        ...(attachments.length > 0 ? { attachments } : {}),
        clientMessageId,
        input: [...content],
        boundary,
        itemId: `user:${clientMessageId}`,
        operation: "replace",
        role: "user",
        text,
        type: "message",
      },
      turnId,
    })
  }

  async #resolveBranchTarget(
    source: ThreadRecord,
    target:
      | { kind: "thread-head" }
      | { kind: "user-message"; cursor: ThreadTimelineCursor }
      | { kind: "assistant-message"; cursor: ThreadTimelineCursor },
    operation: "fork" | "rewind"
  ): Promise<{
    composerContent: ThreadInputBlock[]
    target: Parameters<ThreadHarnessAdapter["fork"]>[0]["target"]
  }> {
    const capabilities = this.#state(source.id).capabilities
    if (target.kind === "thread-head") {
      if (!capabilities.fork.threadHead) {
        throw new ThreadManagerError(
          "THREAD_FORK_UNSUPPORTED",
          `${source.agentId} does not support complete-session forks`
        )
      }
      return { composerContent: [], target }
    }
    const supported =
      target.kind === "user-message"
        ? operation === "rewind"
          ? capabilities.rewind.userMessage
          : capabilities.fork.userMessage
        : capabilities.fork.assistantMessage
    if (!supported) {
      throw new ThreadManagerError(
        "THREAD_BRANCH_UNSUPPORTED",
        `${source.agentId} does not support ${operation} at this message`
      )
    }
    let resolved: Awaited<ReturnType<ThreadTimelineStore["resolve"]>>
    try {
      resolved = await this.#timeline.resolve(source.id, target.cursor)
    } catch (error) {
      throw new ThreadManagerError("INVALID_TIMELINE_CURSOR", this.#message(error))
    }
    const { row, rows } = resolved
    if (row.item.type !== "message") {
      throw new ThreadManagerError("INVALID_BRANCH_TARGET", "Only message boundaries can be used")
    }
    if (target.kind === "user-message" && row.item.boundary !== "turn-user") {
      throw new ThreadManagerError(
        "INVALID_BRANCH_TARGET",
        "Rewind and user-message fork require a turn user message"
      )
    }
    if (target.kind === "assistant-message" && row.item.boundary !== "assistant-final") {
      throw new ThreadManagerError(
        "INVALID_BRANCH_TARGET",
        "Assistant-message fork requires a completed final assistant message"
      )
    }
    if (!row.turnId) {
      throw new ThreadManagerError("INVALID_BRANCH_TARGET", "Message boundary has no turn identity")
    }
    const messages = rows.filter(
      (candidate) => candidate.item.type === "message" && candidate.agentMessageId
    )
    const messagesByItem = new Map<string, { firstSeq: number; row: (typeof rows)[number] }>()
    for (const candidate of rows) {
      if (candidate.item.type !== "message") continue
      const previous = messagesByItem.get(candidate.item.itemId)
      messagesByItem.set(candidate.item.itemId, {
        firstSeq: previous?.firstSeq ?? candidate.seq,
        row: candidate,
      })
    }
    const messageRows = [...messagesByItem.values()]
      .sort((left, right) => left.firstSeq - right.firstSeq)
      .map((entry) => entry.row)
    const messageOrdinal = messageRows.findIndex(
      (candidate) => candidate.item.itemId === row.item.itemId
    )
    if (messageOrdinal < 0) {
      throw new ThreadManagerError("INVALID_BRANCH_TARGET", "Message boundary was not projected")
    }
    if (target.kind === "user-message") {
      const previous = messages.filter((candidate) => candidate.seq < row.seq).at(-1)
      return {
        composerContent: row.item.input ?? [
          ...(row.item.text.length > 0
            ? ([{ text: row.item.text, type: "text" }] satisfies ThreadInputBlock[])
            : []),
          ...(row.item.attachments ?? []),
        ],
        target: {
          agentMessageId: row.agentMessageId,
          kind: target.kind,
          messageOrdinal,
          previousAgentMessageId: previous?.agentMessageId ?? null,
          turnId: row.turnId,
        },
      }
    }
    const nextUser = rows.find(
      (candidate) =>
        candidate.seq > row.seq &&
        candidate.item.type === "message" &&
        candidate.item.boundary === "turn-user"
    )
    const nextUserOrdinal = nextUser
      ? messageRows.findIndex((candidate) => candidate.item.itemId === nextUser.item.itemId)
      : null
    return {
      composerContent: [],
      target: {
        agentMessageId: row.agentMessageId,
        kind: target.kind,
        messageOrdinal,
        nextAgentMessageId: nextUser?.agentMessageId ?? null,
        nextTurnId: nextUser?.turnId ?? null,
        nextUserOrdinal: nextUserOrdinal !== null && nextUserOrdinal >= 0 ? nextUserOrdinal : null,
        turnId: row.turnId,
      },
    }
  }

  async #forkPlacement(sourceThreadId: string): Promise<{
    beforeThreadId: string | null
    projectPlacement?: CreateThreadInput["projectPlacement"]
    sectionPlacement?: CreateThreadInput["sectionPlacement"]
  }> {
    const allThreads = await this.#collectPages((cursor) =>
      this.#persistence.listThreads({
        cursor,
        limit: 200,
        sortDirection: "asc",
        sortKey: "position",
      })
    )
    const sourceIndex = allThreads.findIndex((thread) => thread.id === sourceThreadId)
    const beforeThreadId = sourceIndex >= 0 ? (allThreads[sourceIndex + 1]?.id ?? null) : null
    const project = await this.#persistence.getThreadProject(sourceThreadId)
    const section = await this.#persistence.getItemSection({ id: sourceThreadId, type: "thread" })
    let projectPlacement: CreateThreadInput["projectPlacement"]
    if (project) {
      const memberships = await this.#collectPages((cursor) =>
        this.#persistence.listProjectMemberships({
          cursor,
          limit: 200,
          projectId: project.project.id,
        })
      )
      const index = memberships.findIndex((item) => item.threadId === sourceThreadId)
      projectPlacement = {
        beforeThreadId: index >= 0 ? (memberships[index + 1]?.threadId ?? null) : null,
        projectId: project.project.id,
      }
    }
    let sectionPlacement: CreateThreadInput["sectionPlacement"]
    if (section && section.section.id !== PINNED_SECTION_ID) {
      const memberships = await this.#collectPages((cursor) =>
        this.#persistence.listSectionMemberships({
          cursor,
          limit: 200,
          sectionId: section.section.id,
        })
      )
      const index = memberships.findIndex(
        (membership) => membership.item.type === "thread" && membership.item.id === sourceThreadId
      )
      sectionPlacement = {
        beforeItem: index >= 0 ? (memberships[index + 1]?.item ?? null) : null,
        sectionId: section.section.id,
      }
    }
    return { beforeThreadId, projectPlacement, sectionPlacement }
  }

  async #publishForkPlacement(
    threadId: string,
    placement: {
      beforeThreadId: string | null
      projectPlacement?: CreateThreadInput["projectPlacement"]
      sectionPlacement?: CreateThreadInput["sectionPlacement"]
    }
  ): Promise<void> {
    if (placement.projectPlacement) {
      await this.#publishProjectMemberships(placement.projectPlacement.projectId)
      await this.#publishThreadProject(threadId)
    }
    if (placement.sectionPlacement) {
      await this.#publishSectionMemberships(placement.sectionPlacement.sectionId)
    }
  }

  async #collectPages<T>(
    load: (cursor: string | null) => Promise<{ data: T[]; nextCursor: string | null }>
  ): Promise<T[]> {
    const result: T[] = []
    let cursor: string | null = null
    do {
      const page = await load(cursor)
      result.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return result
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

  async #prepareInput(
    content: readonly ThreadInputBlock[],
    thread: ThreadRecord
  ): Promise<ThreadInputBlock[]> {
    const context = await this.#resumeContext(thread)
    const prepared: ThreadInputBlock[] = []
    for (const block of content) {
      if (block.type === "uploaded-file") {
        if (!this.#inputFiles)
          throw new ThreadManagerError("INPUT_FILE_UNAVAILABLE", "Input files are unavailable")
        const { file, path } = await this.#inputFiles.bind(block.fileId, thread.id)
        prepared.push({ name: file.fileName, type: "resource-link", uri: pathToFileURL(path).href })
      } else if (block.type === "reference") {
        if (!this.#resolveReference)
          throw new ThreadManagerError("REFERENCE_UNAVAILABLE", "References are unavailable")
        prepared.push(await this.#resolveReference(block, context))
      } else {
        prepared.push(block)
      }
    }
    return prepared
  }

  #context(thread: ThreadRecord): ThreadHarnessContext {
    return {
      workspaceKind:
        thread.roots.length === 1 && this.#isManagedProjectlessRoot(thread.roots[0] as string)
          ? "projectless"
          : "project",
      agentId: thread.agentId as AgentId,
      agentSessionId: thread.agentSessionId,
      config: thread.config,
      cwd: thread.roots[0] ?? null,
      threadId: thread.id,
      workspaceRoots: thread.roots,
    }
  }

  async #resumeContext(thread: ThreadRecord): Promise<ThreadHarnessContext> {
    return this.#context(thread)
  }

  async #createProjectlessWorkspace(_threadId: string, title?: string | null): Promise<string> {
    return createProjectlessWorkspace({ root: this.#projectlessWorkspaceRoot, text: title })
  }

  #assertWorkspaceMutationAllowed(thread: ThreadRecord, runtime: RuntimeState): void {
    if (
      runtime.activeTurn ||
      runtime.pendingInteractions.size > 0 ||
      (runtime.state !== "idle" && runtime.state !== "stopped")
    ) {
      throw new ThreadManagerError(
        "THREAD_ACTIVE",
        "Finish the current turn before changing workspace directories"
      )
    }
    if (thread.archivedAt !== null) {
      throw new ThreadManagerError("THREAD_ARCHIVED", "Unarchive the thread first")
    }
  }

  async #commitWorkspaceMutation<T>(
    thread: ThreadRecord,
    roots: readonly string[],
    commit: () => Promise<T>
  ): Promise<T> {
    const runtime = this.#state(thread.id)
    const adapter = this.#adapterFor(thread.agentId as AgentId, thread.id)
    if (runtime.state !== "idle" || adapter.workspaceUpdateMode === "turn-start") return commit()
    if (adapter.workspaceUpdateMode === "unsupported") {
      throw new ThreadManagerError(
        "THREAD_WORKSPACE_UNSUPPORTED",
        "This Agent cannot change the thread workspace after creation"
      )
    }
    if (!adapter.updateWorkspace) {
      throw new ThreadManagerError(
        "THREAD_WORKSPACE_UNSUPPORTED",
        "The Agent adapter cannot apply workspace changes immediately"
      )
    }
    const nextContext: ThreadHarnessContext = {
      ...this.#context(thread),
      cwd: roots[0] ?? null,
      workspaceRoots: roots,
    }
    await adapter.updateWorkspace(nextContext)
    try {
      return await commit()
    } catch (error) {
      try {
        await adapter.updateWorkspace(this.#context(thread))
      } catch (restoreError) {
        await adapter.close(nextContext).catch(() => undefined)
        runtime.state = "stopped"
        this.#updateAndPublishSync(thread)
        throw new AggregateError(
          [error, restoreError],
          "Workspace update failed and the Agent runtime could not be restored"
        )
      }
      throw error
    }
  }

  #isManagedProjectlessRoot(path: string): boolean {
    return isManagedProjectlessWorkspace(this.#projectlessWorkspaceRoot, path)
  }

  /** Deletes an unreferenced managed workspace and its date directory when that becomes empty. */
  async #removeProjectlessWorkspace(path: string): Promise<void> {
    await rm(path, { force: true, recursive: true })
    await pruneProjectlessDateDirectory(path)
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
      if (operation.kind === "fork" || operation.kind === "rewind") {
        const thread = await this.#persistence.getThread(operation.threadId)
        if (operation.status === "timeline-replaced") {
          await this.#lifecycle.complete(operation.id)
          return
        }
        const bindingCommitted =
          operation.status === "binding-committed" ||
          (operation.status === "provider-branched" &&
            thread !== undefined &&
            thread.agentSessionId === operation.agentSessionId)
        if (bindingCommitted && thread) {
          if (operation.status === "provider-branched") {
            await this.#lifecycle.transition(operation.id, {
              agentSessionId: operation.agentSessionId,
              status: "binding-committed",
            })
          }
          const adapter = this.#adapterFor(thread.agentId as AgentId, thread.id)
          const session = await adapter.resume({
            ...(await this.#resumeContext(thread)),
            onEvent: (event) => this.#acceptEvent(thread.id, event),
          })
          if (session.sessionId !== thread.agentSessionId) {
            throw new ThreadManagerError(
              "THREAD_BINDING_MISMATCH",
              "Recovered branch resumed a different provider session"
            )
          }
          const identitySourceThreadId =
            operation.kind === "fork" && typeof operation.input.sourceThreadId === "string"
              ? operation.input.sourceThreadId
              : thread.id
          await this.#timeline.replace(
            thread.id,
            await this.#preserveHistoryIdentity(identitySourceThreadId, session.history ?? [])
          )
          await this.#lifecycle.transition(operation.id, {
            agentSessionId: session.sessionId,
            status: "timeline-replaced",
          })
          await this.#lifecycle.complete(operation.id)
          return
        }
        if (
          (operation.status === "provider-branched" || operation.status === "binding-committed") &&
          operation.agentSessionId
        ) {
          await this.#adapterFor(operation.agentId as AgentId, operation.threadId).delete({
            agentId: operation.agentId as AgentId,
            agentSessionId: operation.agentSessionId,
            config:
              thread?.config ??
              ThreadConfigSchema.parse(
                (operation.input as { config?: ThreadConfig }).config ?? {
                  model: null,
                  permissionsMode: operation.agentId === "codex" ? "auto" : null,
                  speed: null,
                  thinking: null,
                }
              ),
            cwd: thread?.roots[0] ?? null,
            threadId: operation.threadId,
          })
        }
        await this.#lifecycle.complete(operation.id)
        return
      }
      const deletedThread = (await this.#persistence.listDeletedResources())
        .flatMap((resource) => (resource.type === "thread" ? [resource.value] : []))
        .find((value) => value.id === operation.threadId)
      const thread = (await this.#persistence.getThread(operation.threadId)) ?? deletedThread
      if (operation.status === "harness-deleted") {
        if (thread) {
          await this.#onDeleting?.(thread.id)
          await this.#persistence.purgeThread(thread.id)
        }
        await this.#lifecycle.complete(operation.id)
        return
      }
      if (!thread) {
        await this.#lifecycle.complete(operation.id)
        return
      }
      await this.#onDeleting?.(thread.id)
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

  async #preserveHistoryIdentity(
    sourceThreadId: string,
    history: readonly ThreadHarnessHistoryItem[]
  ): Promise<readonly ThreadHarnessHistoryItem[]> {
    const previous = await this.#timeline.history(sourceThreadId)
    const byAgentMessageId = new Map(
      previous.flatMap((entry) =>
        entry.agentMessageId && entry.item.type === "message"
          ? ([[entry.agentMessageId, entry]] as const)
          : []
      )
    )
    const byClientMessageId = new Map(
      previous.flatMap((entry) =>
        entry.item.type === "message" && entry.item.clientMessageId
          ? ([[entry.item.clientMessageId, entry]] as const)
          : []
      )
    )
    return history.map((entry) => {
      if (entry.item.type !== "message") return entry
      const prior =
        (entry.agentMessageId ? byAgentMessageId.get(entry.agentMessageId) : undefined) ??
        (entry.item.clientMessageId ? byClientMessageId.get(entry.item.clientMessageId) : undefined)
      if (!prior || prior.item.type !== "message" || prior.item.role !== entry.item.role) {
        return entry
      }
      return {
        ...entry,
        item: {
          ...entry.item,
          boundary: prior.item.boundary,
          ...(prior.item.clientMessageId ? { clientMessageId: prior.item.clientMessageId } : {}),
        },
        turnId: prior.turnId ?? entry.turnId,
      }
    })
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
      capabilities: this.#capabilities(thread, runtime),
      pendingInteractions: [...runtime.pendingInteractions.values()],
      state: runtime.state,
    }
  }

  #capabilities(thread: Pick<ThreadRecord, "agentId">, runtime: RuntimeState) {
    if (runtime.state !== "stopped") return runtime.capabilities
    const mutableWorkspace = thread.agentId === "codex" || thread.agentId === "claude"
    return {
      ...runtime.capabilities,
      changeCwd: mutableWorkspace,
      changeRoots: mutableWorkspace,
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

  async #withLocks<T>(threadIds: readonly string[], task: () => Promise<T>): Promise<T> {
    const ids = [...new Set(threadIds)].sort()
    const run = (index: number): Promise<T> => {
      const threadId = ids[index]
      return threadId === undefined ? task() : this.#withLock(threadId, () => run(index + 1))
    }
    return run(0)
  }
}
