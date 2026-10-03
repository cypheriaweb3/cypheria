import type { v2 } from "@cypheria/protocol/codex-types"
import type { AutomationTool } from "./automation.js"
import { AUTOMATION_UPDATE_SPEC } from "./automation.js"
import { APP_TOOL_SPECS } from "./definitions.js"
import type { HandoffService } from "./handoff.js"

/** The id the sidebar tools use for the Pinned section. */
const PINNED = "pinned"
const DEFAULT_THREAD_LIMIT = 20
const MAX_WAIT_MS = 120_000
const WAIT_POLL_MS = 500
const DEFAULT_TURN_LIMIT = 3
const DEFAULT_OUTPUT_CHARS = 2000
const TIMELINE_WINDOW = 500
const WORKTREE_INLINE_WAIT_MS = 3000

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

export type AppToolWorktree = {
  readonly active: boolean
  readonly branch: string | null
  readonly head: string | null
  readonly id: string | null
  readonly managed: boolean
  readonly ownerThreadId: string | null
  readonly path: string
}

type WorktreeJob = {
  readonly error: string | null
  readonly id: string
  readonly log: string
  readonly path: string | null
  readonly phase: "queued" | "creating" | "setting-up" | "ready" | "failed" | "cancelled"
  readonly worktree: AppToolWorktree | null
}

/** The slice of the Git service the worktree tools use. */
export type AppToolWorktrees = {
  archive(cwd: string, path: string): Promise<void>
  /** The repository's default branch, such as `origin/main`, when it can be determined. */
  defaultBranch(cwd: string): Promise<string | null>
  job(id: string): WorktreeJob
  list(cwd: string): Promise<AppToolWorktree[]>
  /** The full ref a user-given commit-ish names. */
  resolveRef(cwd: string, ref: string): Promise<string>
  restore(cwd: string, path: string): Promise<AppToolWorktree>
  start(input: { attachToThreadId: string; cwd: string; startPoint: string }): Promise<WorktreeJob>
}

export type AppToolAttachment = {
  readonly attachmentType: "pull_request" | "worktree"
  readonly createdAt: number
  readonly identityKey: string
  readonly payload: unknown
}

export type AppToolAttachments = {
  attachPullRequest(threadId: string, url: string, checkout?: "thread"): Promise<AppToolAttachment>
  detachPullRequest(threadId: string, url: string): Promise<boolean>
  list(threadId: string): Promise<AppToolAttachment[]>
}

/** An Agent a new thread can run on, with the models it offers. */
export type AppToolAgent = {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly description: string | null
    readonly reasoningEfforts: readonly string[]
  }[]
}

const AGENT_GUIDANCE_TIMEOUT_MS = 5000
const MODEL_GUIDANCE_TOOLS = new Set(["create_thread", "send_message_to_thread"])

export type AppToolServiceOptions = {
  /** The Agents a thread can use and their models, for the `agent` and `model` guidance. */
  readonly agents?: () => Promise<readonly AppToolAgent[]>
  readonly automations: Pick<AutomationTool, "call">
  readonly handoff: Pick<HandoffService, "start" | "status">
  readonly attachments: AppToolAttachments
  readonly worktrees: AppToolWorktrees
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

/** The Thread a call acts for, and the signal that cancels it. */
export type AppToolCallContext = {
  readonly cwd?: string
  readonly threadId?: string
  readonly signal?: AbortSignal
}

/** A tool as a bundled plugin's MCP server lists it. */
export type AppToolMcpTool = {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: unknown
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly openWorldHint?: boolean }
  /** MCP tool metadata, such as the MCP App resource and visibility under `ui`. */
  readonly _meta?: Record<string, unknown>
}

export type AppToolMcpResult = {
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string }
  >
  readonly isError: boolean
  /** Machine-readable result an MCP App reads; models read `content`. */
  readonly structuredContent?: Record<string, unknown>
}

/** An app tool result in MCP form. Media arrive as data URLs; any other URL stays text. */
export const toMcpResult = (result: v2.DynamicToolCallResponse): AppToolMcpResult => ({
  content: result.contentItems.map((item) => {
    if (item.type === "inputText") return { text: item.text, type: "text" as const }
    const [url, type] =
      item.type === "inputImage"
        ? [item.imageUrl, "image" as const]
        : [item.audioUrl, "audio" as const]
    const match = /^data:([^;,]+);base64,(.*)$/su.exec(url)
    return match
      ? { data: match[2] as string, mimeType: match[1] as string, type }
      : { text: url, type: "text" as const }
  }),
  isError: !result.success,
})

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
  static readonly specs: readonly v2.DynamicToolSpec[] = [...APP_TOOL_SPECS, AUTOMATION_UPDATE_SPEC]
  static readonly toolNames: ReadonlySet<string> = new Set(
    [...APP_TOOL_SPECS, AUTOMATION_UPDATE_SPEC].flatMap((spec) =>
      spec.type === "function" ? [spec.name] : []
    )
  )

  /**
   * Lists the Agents a new thread can use in the `agent` field of `create_thread`, and the models and
   * reasoning efforts of each Agent in the `model` field of the tools that take one. A lookup that
   * fails or takes longer than five seconds leaves the descriptions unchanged.
   */
  decorateSpecs = async (
    specs: readonly v2.DynamicToolSpec[]
  ): Promise<readonly v2.DynamicToolSpec[]> => {
    const load = this.#options.agents
    if (!load) return specs
    let timer: ReturnType<typeof setTimeout> | undefined
    const agents = await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out loading thread tool Agent guidance.")),
          AGENT_GUIDANCE_TIMEOUT_MS
        )
      }),
    ]).finally(() => clearTimeout(timer))
    if (agents.length === 0) return specs
    const guidance = agents
      .map((agent) => {
        const models = agent.models
          .map((model) => {
            const efforts = model.reasoningEfforts.join(", ")
            const note = efforts
              ? `supported reasoning efforts: ${efforts}`
              : "no reasoning effort overrides"
            const description = model.description?.trim()
            return description ? `${model.id} (${description}; ${note})` : `${model.id} (${note})`
          })
          .join(", ")
        return `${agent.id} (${agent.name}): ${models || "its default model only"}`
      })
      .join("; ")
    return specs.map((spec) => {
      if (spec.type !== "function" || !MODEL_GUIDANCE_TOOLS.has(spec.name)) return spec
      const schema = record(spec.inputSchema)
      const properties = record(schema.properties)
      const next: Record<string, unknown> = { ...properties }
      const model = properties.model as { description?: string } | undefined
      if (model) {
        next.model = {
          ...model,
          description: `${model.description ?? ""} Agents, their models, and supported reasoning efforts on this host: ${guidance}.`,
        }
      }
      const agent = properties.agent as Record<string, unknown> | undefined
      if (agent) next.agent = { ...agent, enum: agents.map(({ id }) => id) }
      return { ...spec, inputSchema: { ...schema, properties: next } } as v2.DynamicToolSpec
    })
  }

  /** The tools in MCP form, with the guidance of {@link decorateSpecs}. */
  async mcpTools(): Promise<AppToolMcpTool[]> {
    const specs = await this.decorateSpecs(AppToolService.specs).catch(() => AppToolService.specs)
    return specs.flatMap((spec) =>
      spec.type === "function"
        ? [{ description: spec.description, inputSchema: spec.inputSchema, name: spec.name }]
        : []
    )
  }

  async call(
    request: Pick<v2.DynamicToolCallParams, "arguments" | "tool">,
    context: AppToolCallContext
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
    context: AppToolCallContext
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
        return ok(await this.#waitThreads(args, context.signal))
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
      case "create_worktree":
        return ok(await this.#createWorktree(args, context))
      case "get_worktree_creation_status":
        return ok(this.#worktreeStatus(text(args, "operationId", true) as string))
      case "archive_worktree":
        return ok(await this.#archiveWorktree(args, context))
      case "restore_worktree":
        return ok(await this.#restoreWorktree(args, context))
      case "automation_update":
        return ok(await this.#options.automations.call(args, context.threadId))
      case "handoff_thread": {
        const threadId = text(args, "threadId", true) as string
        if (threadId === context.threadId) {
          throw new ToolInputError("The calling thread cannot hand itself off.")
        }
        await this.#options.threads.get(threadId)
        const followUpPrompt = text(args, "followUpPrompt")
        return ok(
          this.#options.handoff.start({ threadId, ...(followUpPrompt ? { followUpPrompt } : {}) })
        )
      }
      case "get_handoff_status": {
        const afterRevision = integer(args, "afterRevision", 0, Number.MAX_SAFE_INTEGER)
        const waitMs = integer(args, "waitMs", 0, 60_000)
        return ok(
          await this.#options.handoff.status(text(args, "operationId", true) as string, {
            ...(afterRevision === undefined ? {} : { afterRevision }),
            ...(waitMs === undefined ? {} : { waitMs }),
          })
        )
      }
      case "list_artifacts":
        return ok(await this.#listArtifacts(context))
      case "attach_artifact": {
        // The Agent attaches what it pushed from its working directory, so that checkout is the
        // pull request's.
        const attachment = await this.#options.attachments.attachPullRequest(
          this.#caller(context),
          this.#pullRequestUrl(args),
          "thread"
        )
        return ok({ artifact_type: "pull_request", identityKey: attachment.identityKey })
      }
      case "remove_artifact": {
        const removed = await this.#options.attachments.detachPullRequest(
          this.#caller(context),
          this.#pullRequestUrl(args)
        )
        return ok({ artifact_type: "pull_request", removed })
      }
      default:
        throw new ToolInputError(`Unknown Cypheria app tool ${tool}.`)
    }
  }

  #target(args: Record<string, unknown>, context: AppToolCallContext): string {
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

  async #waitThreads(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const targets = Array.isArray(args.targets) ? args.targets.map(record) : []
    if (targets.length < 1 || targets.length > 8) {
      throw new ToolInputError("targets needs 1 to 8 entries")
    }
    const timeoutMs = integer(args, "timeoutMs", 0, MAX_WAIT_MS) ?? MAX_WAIT_MS
    const pause =
      this.#options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const deadline = Date.now() + timeoutMs
    for (;;) {
      signal?.throwIfAborted()
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
    context: AppToolCallContext
  ): Promise<unknown> {
    const prompt = text(args, "prompt", true) as string
    const target = record(args.target)
    const title = text(args, "title")
    const caller = context.threadId
      ? await this.#options.threads.get(context.threadId).catch(() => undefined)
      : undefined
    const agentId = text(args, "agent") ?? caller?.agentId ?? this.#options.defaultAgentId
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

  async #forkThread(args: Record<string, unknown>, context: AppToolCallContext): Promise<unknown> {
    const threadId = this.#target(args, context)
    const forked = await this.#options.threads.fork({ target: { kind: "thread-head" }, threadId })
    return { sourceThreadId: threadId, threadId: forked.thread.id }
  }

  async #sendMessage(args: Record<string, unknown>, context: AppToolCallContext): Promise<unknown> {
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

  #caller(context: AppToolCallContext): string {
    if (!context.threadId) throw new ToolInputError("This tool acts on the calling thread.")
    return context.threadId
  }

  #pullRequestUrl(args: Record<string, unknown>): string {
    if (args.artifact_type !== "pull_request") {
      throw new ToolInputError("Only pull_request artifacts are supported.")
    }
    return text(args, "url", true) as string
  }

  async #callerCwd(context: AppToolCallContext): Promise<{ cwd: string; threadId: string }> {
    const threadId = this.#caller(context)
    const cwd = (await this.#options.threads.get(threadId)).roots[0]
    if (!cwd) throw new ToolInputError("The calling thread has no working directory.")
    return { cwd, threadId }
  }

  async #createWorktree(
    args: Record<string, unknown>,
    context: AppToolCallContext
  ): Promise<unknown> {
    if (args.allowAsync !== true) throw new ToolInputError("allowAsync must be true")
    const { cwd, threadId } = await this.#callerCwd(context)
    const requested = text(args, "ref")
    if (requested?.startsWith("-")) throw new ToolInputError("ref must not start with a dash")
    const base = requested ?? (await this.#options.worktrees.defaultBranch(cwd))
    if (!base) {
      throw new ToolInputError("The repository's default branch cannot be determined; specify ref.")
    }
    const startPoint = await this.#options.worktrees.resolveRef(cwd, base)
    const started = await this.#options.worktrees.start({
      attachToThreadId: threadId,
      cwd,
      startPoint,
    })
    const pause =
      this.#options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    for (let waited = 0; waited < WORKTREE_INLINE_WAIT_MS; waited += WAIT_POLL_MS) {
      const job = this.#options.worktrees.job(started.id)
      if (job.phase === "ready" || job.phase === "failed" || job.phase === "cancelled") break
      await pause(WAIT_POLL_MS)
    }
    return this.#worktreeStatus(started.id)
  }

  #worktreeStatus(operationId: string): Record<string, unknown> {
    const job = this.#options.worktrees.job(operationId)
    const status =
      job.phase === "queued"
        ? "preparing"
        : job.phase === "creating" || job.phase === "setting-up"
          ? "creating"
          : job.phase === "ready"
            ? "completed"
            : "failed"
    return {
      operationId,
      status,
      ...(job.error ? { error: job.error } : {}),
      ...(job.phase === "creating" || job.phase === "setting-up"
        ? { recentOutput: truncate(job.log.slice(-1000), 1000) }
        : {}),
      ...(job.worktree?.id ? { identityKey: job.worktree.id } : {}),
      ...(job.phase === "ready" && job.path ? { workspaceDirectory: job.path } : {}),
    }
  }

  async #attachedWorktree(
    root: string,
    context: AppToolCallContext
  ): Promise<{ cwd: string; worktree: AppToolWorktree }> {
    const { cwd, threadId } = await this.#callerCwd(context)
    const attached = (await this.#options.attachments.list(threadId)).some(
      (entry) => entry.attachmentType === "worktree" && entry.identityKey === root
    )
    const worktree = (await this.#options.worktrees.list(cwd)).find((entry) => entry.id === root)
    if (!attached || !worktree?.managed) {
      throw new ToolInputError("root is not a worktree attached to this task; see list_artifacts.")
    }
    return { cwd, worktree }
  }

  async #archiveWorktree(
    args: Record<string, unknown>,
    context: AppToolCallContext
  ): Promise<unknown> {
    const root = text(args, "root", true) as string
    const { cwd, worktree } = await this.#attachedWorktree(root, context)
    if (!worktree.active) throw new ToolInputError("The worktree is already archived.")
    if (worktree.ownerThreadId) {
      throw new ToolInputError("A thread works in this worktree; move the thread out of it first.")
    }
    await this.#options.worktrees.archive(cwd, worktree.path)
    return { archived: true, identityKey: root }
  }

  async #restoreWorktree(
    args: Record<string, unknown>,
    context: AppToolCallContext
  ): Promise<unknown> {
    const root = text(args, "root", true) as string
    const { cwd, worktree } = await this.#attachedWorktree(root, context)
    if (worktree.active) throw new ToolInputError("The worktree is not archived.")
    const restored = await this.#options.worktrees.restore(cwd, worktree.path)
    return { identityKey: root, workspaceDirectory: restored.path }
  }

  async #listArtifacts(context: AppToolCallContext): Promise<unknown> {
    const { cwd, threadId } = await this.#callerCwd(context)
    const [attachments, worktrees] = await Promise.all([
      this.#options.attachments.list(threadId),
      this.#options.worktrees.list(cwd).catch(() => [] as AppToolWorktree[]),
    ])
    return {
      artifacts: attachments.map((entry) => {
        if (entry.attachmentType === "pull_request") {
          return {
            createdAt: entry.createdAt,
            identityKey: entry.identityKey,
            payload: entry.payload,
            type: "pull_request",
          }
        }
        const worktree = worktrees.find((candidate) => candidate.id === entry.identityKey)
        return {
          createdAt: entry.createdAt,
          identityKey: entry.identityKey,
          payload: {
            branch: worktree?.branch ?? null,
            head: worktree?.head ?? null,
            path: worktree?.path ?? null,
            state: worktree ? (worktree.active ? "active" : "archived") : "missing",
          },
          type: "worktree",
        }
      }),
    }
  }
}
