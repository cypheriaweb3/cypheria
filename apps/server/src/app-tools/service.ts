import type { v2 } from "@cypheria/protocol/codex-types"
import type { CodexDynamicToolCallContext } from "../agent/codex-dynamic-tools.js"
import { APP_TOOL_SPECS } from "./definitions.js"

/** The id the sidebar tools use for the Pinned section. */
const PINNED = "pinned"
const DEFAULT_THREAD_LIMIT = 20
const MAX_WAIT_MS = 120_000
const WAIT_POLL_MS = 500
const DEFAULT_TURN_LIMIT = 3
const DEFAULT_OUTPUT_CHARS = 2000
const TIMELINE_WINDOW = 500

type ThreadState = "stopped" | "starting" | "idle" | "running" | "stopping" | "deleting" | "errored"

export type AppToolThread = {
  readonly activeTurn: unknown
  readonly agentId: string
  readonly archivedAt: number | null
  readonly attention: boolean
  readonly createdAt: number
  readonly id: string
  readonly pendingInteractions: readonly unknown[]
  readonly recencyAt: number | null
  readonly roots: readonly string[]
  readonly state: ThreadState
  readonly title: string | null
  readonly updatedAt: number
}

type TimelineCursor = { epoch: string; seq: number }
type TimelineItem = {
  readonly item: {
    readonly type: string
    readonly role?: string
    readonly text?: string
    readonly name?: string
    readonly command?: string
    readonly output?: unknown
    readonly status?: string
  }
  readonly seqEnd: number
  readonly seqStart: number
  readonly turnId: string | null
}
type TimelinePage = {
  readonly epoch: string
  readonly hasOlder: boolean
  readonly projectedItems: readonly TimelineItem[]
}

type Page<T> = { readonly data: readonly T[]; readonly nextCursor: string | null }
type ProjectRecord = {
  readonly id: string
  readonly name: string
  readonly roots: readonly string[]
}
type SectionRecord = { readonly id: string; readonly name: string }
type ItemRef = { id: string; type: "project" | "thread" }
type SectionMembership = { readonly item: ItemRef; readonly sectionId: string }
type ProjectMembership = { readonly projectId: string; readonly threadId: string }
type Memberships = {
  projectOf: Map<string, string>
  sections: SectionRecord[]
  sectionOf: Map<string, string>
  sectionItems: Map<string, ItemRef[]>
}

/** The slice of ThreadManager the tools use. */
export type AppToolThreads = {
  archive(threadId: string): Promise<unknown>
  create(input: {
    agentId: string
    projectPlacement?: { projectId: string }
    title?: string | null
    workspaceName?: string | null
  }): Promise<{ thread: AppToolThread }>
  fork(input: {
    target: { kind: "thread-head" }
    threadId: string
  }): Promise<{ thread: AppToolThread }>
  get(threadId: string): Promise<AppToolThread>
  getTimeline(threadId: string, limit?: number, before?: TimelineCursor): Promise<TimelinePage>
  list(options: {
    archived?: boolean
    cursor?: string | null
    limit?: number
    sortDirection?: "asc" | "desc"
    sortKey?: "recencyAt"
  }): Promise<Page<AppToolThread>>
  startTurn(input: {
    clientMessageId: string
    content: { text: string; type: "text" }[]
    threadId: string
  }): Promise<unknown>
  steerTurn(input: {
    clientMessageId: string
    content: { text: string; type: "text" }[]
    threadId: string
  }): Promise<unknown>
  unarchive(threadId: string): Promise<unknown>
  update(threadId: string, patch: { title?: string | null }): Promise<unknown>
  updateConfig(
    threadId: string,
    patch: { model?: string | null; thinking?: string | null }
  ): Promise<unknown>
}

export type AppToolServiceOptions = {
  readonly isGitRepository: (root: string) => Promise<boolean>
  /** Section and Project requests, answered by the same code the clients reach. */
  readonly projectThread: (type: string, payload: unknown) => Promise<unknown>
  readonly randomId: () => string
  readonly threads: AppToolThreads
  /** Section id of the Pinned section. */
  readonly pinnedSectionId: string
  /** Agent of a new Thread when the caller does not name one. */
  readonly defaultAgentId: string
  readonly wait?: (ms: number) => Promise<void>
}

const ok = (value: unknown): v2.DynamicToolCallResponse => ({
  contentItems: [
    { text: typeof value === "string" ? value : JSON.stringify(value), type: "inputText" },
  ],
  success: true,
})

class ToolInputError extends Error {}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (args: Record<string, unknown>, key: string, required = false): string | undefined => {
  const value = args[key]
  if (typeof value === "string" && value.length > 0) return value
  if (required) throw new ToolInputError(`${key} is required`)
  return undefined
}

const bool = (args: Record<string, unknown>, key: string): boolean => {
  const value = args[key]
  if (typeof value !== "boolean") throw new ToolInputError(`${key} is required`)
  return value
}

const integer = (
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number | undefined => {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolInputError(`${key} must be an integer from ${min} to ${max}`)
  }
  return value
}

const strings = (args: Record<string, unknown>, key: string, min = 0): string[] => {
  const value = args[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new ToolInputError(`${key} must be an array of ids`)
  }
  if (value.length < min) throw new ToolInputError(`${key} needs at least ${min} entries`)
  return value as string[]
}

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}… [truncated ${value.length - limit}]`

const statusOf = (thread: AppToolThread): string => {
  if (thread.pendingInteractions.length > 0) return "needsAttention"
  if (thread.state === "running" || thread.state === "starting") return "running"
  return thread.state
}

/**
 * The refill of the slots `wanted` occupies in `current`: entries of `wanted` take the positions
 * the same entries held, in the order given; every other entry keeps its position.
 */
export const reorderWithinSlots = (
  current: readonly string[],
  wanted: readonly string[]
): string[] => {
  const included = new Set(wanted)
  const queue = [...wanted]
  return current.map((id) => (included.has(id) ? (queue.shift() as string) : id))
}

/**
 * Executors of the Cypheria app tools. A tool acts on behalf of the Thread that calls it
 * (`context.threadId`), through the same Server code the clients reach.
 */
export class AppToolService {
  readonly #options: AppToolServiceOptions

  constructor(options: AppToolServiceOptions) {
    this.#options = options
  }

  /** Specs and the names they carry; the names gate the matching developer instructions. */
  static readonly specs: readonly v2.DynamicToolSpec[] = APP_TOOL_SPECS
  static readonly toolNames: ReadonlySet<string> = new Set(
    APP_TOOL_SPECS.flatMap((spec) => (spec.type === "function" ? [spec.name] : []))
  )

  async call(
    request: v2.DynamicToolCallParams,
    context: CodexDynamicToolCallContext
  ): Promise<v2.DynamicToolCallResponse> {
    const args = record(request.arguments)
    try {
      return await this.#dispatch(request.tool, args, context)
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof Error) {
        return {
          contentItems: [{ text: error.message, type: "inputText" }],
          success: false,
        }
      }
      throw error
    }
  }

  async #dispatch(
    tool: string,
    args: Record<string, unknown>,
    context: CodexDynamicToolCallContext
  ): Promise<v2.DynamicToolCallResponse> {
    switch (tool) {
      case "list_projects":
        return ok(await this.#listProjects())
      case "list_threads":
        return ok(await this.#listThreads(integer(args, "limit", 1, 50)))
      case "list_archived_threads":
        return ok(await this.#listArchived(args))
      case "read_thread":
        return ok(await this.#readThread(args))
      case "wait_threads":
        return ok(await this.#waitThreads(args))
      case "create_thread":
        return ok(await this.#createThread(args, context))
      case "fork_thread":
        return ok(await this.#forkThread(args, context))
      case "send_message_to_thread":
        return ok(await this.#sendMessage(args, context))
      case "set_thread_title": {
        const threadId = this.#target(args, context)
        await this.#options.threads.update(threadId, { title: text(args, "title", true) as string })
        return ok({ threadId, title: args.title })
      }
      case "set_thread_archived": {
        const threadId = this.#target(args, context)
        const archived = bool(args, "archived")
        if (archived) await this.#options.threads.archive(threadId)
        else await this.#options.threads.unarchive(threadId)
        return ok({ archived, threadId })
      }
      case "create_sidebar_section": {
        const section = (await this.#options.projectThread("section.create.request", {
          name: text(args, "name", true),
        })) as SectionRecord
        return ok({ name: section.name, sectionId: section.id })
      }
      case "rename_sidebar_section": {
        const sectionId = await this.#customSection(text(args, "sectionId", true) as string)
        await this.#options.projectThread("section.update.request", {
          name: text(args, "name", true),
          sectionId,
        })
        return ok({ name: args.name, sectionId })
      }
      case "delete_sidebar_section": {
        const sectionId = await this.#customSection(text(args, "sectionId", true) as string)
        await this.#options.projectThread("section.delete.request", { sectionId })
        return ok({ deleted: true, sectionId })
      }
      case "move_thread_to_sidebar_section":
        return ok(
          await this.#moveItem(
            { id: text(args, "threadId", true) as string, type: "thread" },
            args.sectionId
          )
        )
      case "move_project_to_sidebar_section":
        return ok(
          await this.#moveItem(
            { id: text(args, "projectId", true) as string, type: "project" },
            args.sectionId
          )
        )
      case "reorder_section":
        return ok(await this.#reorderSection(args))
      case "reorder_sidebar_projects":
        return ok(await this.#reorderProjects(strings(args, "projectIds", 1)))
      case "reorder_sidebar_sections":
        return ok(await this.#reorderSections(strings(args, "sectionIds", 1)))
      default:
        throw new ToolInputError(`Unknown Cypheria app tool ${tool}.`)
    }
  }

  #target(args: Record<string, unknown>, context: CodexDynamicToolCallContext): string {
    const threadId = text(args, "threadId") ?? context.threadId
    if (!threadId) throw new ToolInputError("threadId is required")
    return threadId
  }

  async #all<T>(type: string, payload: Record<string, unknown> = {}): Promise<T[]> {
    const data: T[] = []
    let cursor: string | null = null
    do {
      const page = (await this.#options.projectThread(type, {
        ...payload,
        ...(cursor ? { cursor } : {}),
        limit: 200,
      })) as Page<T>
      data.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return data
  }

  async #memberships(): Promise<Memberships> {
    const [projectMemberships, sectionMemberships, sections] = await Promise.all([
      this.#all<ProjectMembership>("project.membership.list.request"),
      this.#all<SectionMembership>("section.membership.list.request"),
      this.#all<SectionRecord>("section.list.request"),
    ])
    const sectionOf = new Map<string, string>()
    const sectionItems = new Map<string, ItemRef[]>()
    for (const membership of sectionMemberships) {
      sectionOf.set(`${membership.item.type}:${membership.item.id}`, membership.sectionId)
      const items = sectionItems.get(membership.sectionId) ?? []
      items.push(membership.item)
      sectionItems.set(membership.sectionId, items)
    }
    return {
      projectOf: new Map(projectMemberships.map((entry) => [entry.threadId, entry.projectId])),
      sectionItems,
      sectionOf,
      sections,
    }
  }

  #entry(thread: AppToolThread, memberships: Memberships): Record<string, unknown> {
    const sectionId = memberships.sectionOf.get(`thread:${thread.id}`)
    return {
      agentId: thread.agentId,
      createdAt: thread.createdAt,
      cwd: thread.roots[0] ?? null,
      projectId: memberships.projectOf.get(thread.id) ?? null,
      recencyAt: thread.recencyAt ?? thread.updatedAt,
      sectionId: sectionId === this.#options.pinnedSectionId ? PINNED : (sectionId ?? null),
      status: statusOf(thread),
      threadId: thread.id,
      title: thread.title,
      unread: thread.attention,
    }
  }

  async #listProjects(): Promise<unknown> {
    const projects = await this.#all<ProjectRecord>("project.list.request", { sortKey: "position" })
    return {
      projects: await Promise.all(
        projects.map(async (project) => ({
          isGitRepository: await this.#options
            .isGitRepository(project.roots[0] as string)
            .catch(() => false),
          name: project.name,
          projectId: project.id,
          roots: project.roots,
        }))
      ),
    }
  }

  async #listThreads(limit = DEFAULT_THREAD_LIMIT): Promise<unknown> {
    const memberships = await this.#memberships()
    const pinnedIds = (memberships.sectionItems.get(this.#options.pinnedSectionId) ?? []).filter(
      (item) => item.type === "thread"
    )
    const pinned = await Promise.all(
      pinnedIds.map((item) => this.#options.threads.get(item.id).catch(() => null))
    )
    const pinnedSet = new Set(pinnedIds.map((item) => item.id))
    const page = await this.#options.threads.list({
      archived: false,
      limit: Math.min(200, limit + pinnedSet.size),
      sortDirection: "desc",
      sortKey: "recencyAt",
    })
    const customSections = memberships.sections.filter(
      (section) => section.id !== this.#options.pinnedSectionId
    )
    return {
      pinnedThreads: pinned.flatMap((thread, index) =>
        thread && thread.archivedAt === null
          ? [{ pinnedIndex: index + 1, ...this.#entry(thread, memberships) }]
          : []
      ),
      sections: customSections.map((section) => ({
        name: section.name,
        projectIds: (memberships.sectionItems.get(section.id) ?? [])
          .filter((item) => item.type === "project")
          .map((item) => item.id),
        sectionId: section.id,
        threadIds: (memberships.sectionItems.get(section.id) ?? [])
          .filter((item) => item.type === "thread")
          .map((item) => item.id),
      })),
      threads: page.data
        .filter((thread) => !pinnedSet.has(thread.id))
        .slice(0, limit)
        .map((thread) => this.#entry(thread, memberships)),
    }
  }

  async #listArchived(args: Record<string, unknown>): Promise<unknown> {
    const memberships = await this.#memberships()
    const page = await this.#options.threads.list({
      archived: true,
      cursor: text(args, "cursor") ?? null,
      limit: integer(args, "limit", 1, 50) ?? 10,
      sortDirection: "desc",
      sortKey: "recencyAt",
    })
    return {
      nextCursor: page.nextCursor,
      threads: page.data.map((thread) => this.#entry(thread, memberships)),
    }
  }

  async #readThread(args: Record<string, unknown>): Promise<unknown> {
    const threadId = text(args, "threadId", true) as string
    const turnLimit = integer(args, "turnLimit", 1, 10) ?? DEFAULT_TURN_LIMIT
    const includeOutputs = args.includeOutputs === true
    const maxChars = integer(args, "maxOutputCharsPerItem", 0, 20_000) ?? DEFAULT_OUTPUT_CHARS
    const cursor = this.#parseCursor(text(args, "cursor"))
    const thread = await this.#options.threads.get(threadId)
    const page = await this.#options.threads.getTimeline(threadId, TIMELINE_WINDOW, cursor)
    const turns: { id: string | null; items: TimelineItem[] }[] = []
    for (const entry of page.projectedItems) {
      const last = turns.at(-1)
      if (last && (entry.turnId === null || last.id === entry.turnId)) last.items.push(entry)
      else turns.push({ id: entry.turnId, items: [entry] })
    }
    const kept = turns.slice(-turnLimit)
    const dropped = turns.length > kept.length
    const first = kept[0]?.items[0]
    return {
      nextCursor: first && (dropped || page.hasOlder) ? `${page.epoch}:${first.seqStart}` : null,
      status: statusOf(thread),
      threadId,
      title: thread.title,
      turns: kept.map((turn) => ({
        items: turn.items.flatMap((entry) => this.#summarize(entry, includeOutputs, maxChars)),
        turnId: turn.id,
      })),
    }
  }

  #summarize(entry: TimelineItem, includeOutputs: boolean, maxChars: number): unknown[] {
    const { item } = entry
    if (item.type === "message") {
      return [
        { role: item.role, text: truncate(item.text ?? "", maxChars || DEFAULT_OUTPUT_CHARS) },
      ]
    }
    if (!includeOutputs) return []
    if (item.type === "command") {
      return [
        {
          command: item.command,
          output: truncate(String(item.output ?? ""), maxChars),
          status: item.status,
          type: "command",
        },
      ]
    }
    if (item.type === "tool") {
      return [
        {
          name: item.name,
          output: truncate(JSON.stringify(item.output ?? null), maxChars),
          status: item.status,
          type: "tool",
        },
      ]
    }
    return []
  }

  #parseCursor(value: string | undefined): TimelineCursor | undefined {
    if (!value) return undefined
    const split = value.lastIndexOf(":")
    const seq = Number(value.slice(split + 1))
    if (split < 1 || !Number.isInteger(seq) || seq < 0) {
      throw new ToolInputError("cursor is not a cursor returned by read_thread")
    }
    return { epoch: value.slice(0, split), seq }
  }

  async #waitThreads(args: Record<string, unknown>): Promise<unknown> {
    const targets = Array.isArray(args.targets) ? args.targets.map(record) : []
    if (targets.length < 1 || targets.length > 8) {
      throw new ToolInputError("targets needs 1 to 8 entries")
    }
    const timeoutMs = integer(args, "timeoutMs", 0, MAX_WAIT_MS) ?? MAX_WAIT_MS
    const pause =
      this.#options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const snapshots: {
        afterCursor?: string
        error?: string
        thread?: AppToolThread
        threadId: string
      }[] = await Promise.all(
        targets.map(async (target) => {
          const threadId = text(target, "threadId", true) as string
          const afterCursor = text(target, "afterCursor")
          try {
            return {
              ...(afterCursor ? { afterCursor } : {}),
              thread: await this.#options.threads.get(threadId),
              threadId,
            }
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error), threadId }
          }
        })
      )
      const errors = snapshots.flatMap((entry) =>
        entry.error ? [{ error: entry.error, threadId: entry.threadId }] : []
      )
      for (const entry of snapshots) {
        const { thread } = entry
        if (!thread) continue
        const needsAttention = thread.pendingInteractions.length > 0
        if (needsAttention || !["running", "starting", "stopping"].includes(thread.state)) {
          return {
            errors,
            reason: needsAttention ? "needsAttention" : "completed",
            ...(await this.#finished(thread, entry.afterCursor)),
          }
        }
      }
      if (errors.length === targets.length || Date.now() >= deadline) {
        return {
          errors,
          reason: "timeout",
          threads: snapshots.flatMap((entry) =>
            entry.thread
              ? [
                  {
                    status: statusOf(entry.thread),
                    threadId: entry.threadId,
                    title: entry.thread.title,
                  },
                ]
              : []
          ),
        }
      }
      await pause(Math.min(WAIT_POLL_MS, Math.max(0, deadline - Date.now())))
    }
  }

  async #finished(
    thread: AppToolThread,
    afterCursor: string | undefined
  ): Promise<Record<string, unknown>> {
    const page = await this.#options.threads.getTimeline(thread.id, TIMELINE_WINDOW)
    const final = [...page.projectedItems]
      .reverse()
      .find((entry) => entry.item.type === "message" && entry.item.role === "assistant")
    const cursor = final ? `${page.epoch}:${final.seqEnd}` : null
    const seen = afterCursor ? this.#parseCursor(afterCursor) : undefined
    const delivered = Boolean(
      final && seen && seen.epoch === page.epoch && seen.seq >= final.seqEnd
    )
    return {
      cursor,
      finalText: final && !delivered ? truncate(final.item.text ?? "", 20_000) : null,
      status: statusOf(thread),
      threadId: thread.id,
      title: thread.title,
    }
  }

  async #createThread(
    args: Record<string, unknown>,
    context: CodexDynamicToolCallContext
  ): Promise<unknown> {
    const prompt = text(args, "prompt", true) as string
    const target = record(args.target)
    const title = text(args, "title")
    const caller = context.threadId
      ? await this.#options.threads.get(context.threadId).catch(() => undefined)
      : undefined
    const agentId = caller?.agentId ?? this.#options.defaultAgentId
    let created: { thread: AppToolThread }
    if (target.type === "project") {
      created = await this.#options.threads.create({
        agentId,
        projectPlacement: { projectId: text(target, "projectId", true) as string },
        ...(title ? { title } : {}),
      })
    } else if (target.type === "projectless") {
      created = await this.#options.threads.create({
        agentId,
        ...(title ? { title } : {}),
        workspaceName: text(target, "directoryName") ?? title ?? prompt,
      })
    } else {
      throw new ToolInputError("target.type must be project or projectless")
    }
    await this.#configure(created.thread.id, args)
    await this.#options.threads.startTurn({
      clientMessageId: this.#options.randomId(),
      content: [{ text: prompt, type: "text" }],
      threadId: created.thread.id,
    })
    return { cwd: created.thread.roots[0] ?? null, threadId: created.thread.id }
  }

  async #configure(threadId: string, args: Record<string, unknown>): Promise<void> {
    const model = text(args, "model")
    const thinking = text(args, "thinking")
    if (model || thinking) {
      await this.#options.threads.updateConfig(threadId, {
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      })
    }
  }

  async #forkThread(
    args: Record<string, unknown>,
    context: CodexDynamicToolCallContext
  ): Promise<unknown> {
    const threadId = this.#target(args, context)
    const forked = await this.#options.threads.fork({ target: { kind: "thread-head" }, threadId })
    return { sourceThreadId: threadId, threadId: forked.thread.id }
  }

  async #sendMessage(
    args: Record<string, unknown>,
    context: CodexDynamicToolCallContext
  ): Promise<unknown> {
    const threadId = text(args, "threadId", true) as string
    if (threadId === context.threadId) {
      throw new ToolInputError("A thread cannot send a message to itself.")
    }
    const thread = await this.#options.threads.get(threadId)
    await this.#configure(threadId, args)
    const input = {
      clientMessageId: this.#options.randomId(),
      content: [{ text: text(args, "prompt", true) as string, type: "text" as const }],
      threadId,
    }
    if (thread.activeTurn) {
      await this.#options.threads.steerTurn(input)
      return { delivered: "steered", threadId }
    }
    await this.#options.threads.startTurn(input)
    return { delivered: "started", threadId }
  }

  async #customSection(id: string): Promise<string> {
    if (id === PINNED || id === this.#options.pinnedSectionId) {
      throw new ToolInputError("The Pinned section cannot be changed.")
    }
    await this.#options.projectThread("section.read.request", { sectionId: id })
    return id
  }

  async #moveItem(item: ItemRef, destination: unknown): Promise<unknown> {
    if (destination === null || destination === "chats" || destination === "threads") {
      await this.#options.projectThread("section.item.remove.request", { item })
      return { item, sectionId: null }
    }
    if (typeof destination !== "string" || !destination) {
      throw new ToolInputError('sectionId must be a section id, "pinned", or null')
    }
    if (destination === PINNED) {
      await this.#options.projectThread("section.item.pin.request", { item })
      return { item, sectionId: PINNED }
    }
    const sectionId = await this.#customSection(destination)
    await this.#options.projectThread("section.item.move.request", { item, sectionId })
    return { item, sectionId }
  }

  async #reorderSection(args: Record<string, unknown>): Promise<unknown> {
    const id = text(args, "sectionId", true) as string
    const sectionId = id === PINNED ? this.#options.pinnedSectionId : await this.#customSection(id)
    const threadIds = strings(args, "threadIds")
    if (new Set(threadIds).size !== threadIds.length) {
      throw new ToolInputError("threadIds lists a thread more than once")
    }
    const items = await this.#all<{
      type: "project" | "thread"
      thread?: { id: string }
      project?: { id: string }
    }>("section.item.list.request", { sectionId })
    const current = items.map((item) => `${item.type}:${(item.thread ?? item.project)?.id}`)
    const wanted = threadIds.map((threadId) => `thread:${threadId}`)
    const missing = wanted.filter((entry) => !current.includes(entry))
    if (
      missing.length > 0 ||
      threadIds.length !== current.filter((e) => e.startsWith("thread:")).length
    ) {
      throw new ToolInputError("threadIds must list every thread in the section exactly once")
    }
    const order = reorderWithinSlots(current, wanted).map((entry): ItemRef => {
      const [type, ...rest] = entry.split(":")
      return { id: rest.join(":"), type: type as ItemRef["type"] }
    })
    for (let index = order.length - 1; index >= 0; index -= 1) {
      await this.#options.projectThread("section.item.move.request", {
        beforeItem: order[index + 1] ?? null,
        item: order[index],
        sectionId,
      })
    }
    return { sectionId: id, threadIds }
  }

  async #reorderProjects(projectIds: string[]): Promise<unknown> {
    const projects = await this.#all<ProjectRecord>("project.list.request", { sortKey: "position" })
    const known = new Set(projects.map((project) => project.id))
    const unknown = projectIds.filter((id) => !known.has(id))
    if (unknown.length > 0) throw new ToolInputError(`Unknown project ids: ${unknown.join(", ")}`)
    const order = reorderWithinSlots(
      projects.map((project) => project.id),
      projectIds
    )
    for (let index = order.length - 1; index >= 0; index -= 1) {
      await this.#options.projectThread("project.move.request", {
        beforeProjectId: order[index + 1] ?? null,
        projectId: order[index],
      })
    }
    return { projectIds: order }
  }

  async #reorderSections(sectionIds: string[]): Promise<unknown> {
    const sections = await this.#all<SectionRecord>("section.list.request")
    const resolve = (id: string): string => (id === PINNED ? this.#options.pinnedSectionId : id)
    const known = new Set(sections.map((section) => section.id))
    const wanted = sectionIds.map(resolve)
    const unknown = wanted.filter((id) => !known.has(id))
    if (unknown.length > 0) throw new ToolInputError(`Unknown section ids: ${unknown.join(", ")}`)
    const custom = sections.filter((section) => section.id !== this.#options.pinnedSectionId)
    const omitted = custom.filter((section) => !wanted.includes(section.id))
    if (omitted.length > 0) {
      throw new ToolInputError(
        `sectionIds must include every custom section; missing ${omitted.map((s) => s.id).join(", ")}`
      )
    }
    const order = reorderWithinSlots(
      sections.map((section) => section.id),
      wanted
    )
    for (let index = order.length - 1; index >= 0; index -= 1) {
      await this.#options.projectThread("section.move.request", {
        beforeSectionId: order[index + 1] ?? null,
        sectionId: order[index],
      })
    }
    return { sectionIds: order.map((id) => (id === this.#options.pinnedSectionId ? PINNED : id)) }
  }
}
