import { createHash, randomUUID } from "node:crypto"
import { basename } from "node:path"
import {
  type AgentId,
  type ExtensionAppCapabilities,
  type ExtensionAppInstance,
  type ExtensionAppTarget,
  type ExtensionCatalog,
  type ExtensionClientMessage,
  type ExtensionDisplayMode,
  type ExtensionElicitation,
  type ExtensionMentionItem,
  type ExtensionModelContext,
  type ExtensionServerMessage,
  type ExtensionToolResult,
  OpenAIFileOpenParamsSchema,
  OpenAIMentionSearchResultSchema,
  OpenAIMessageOptionsSchema,
  OpenAIResourceReadMetadataSchema,
  OpenAIResourceWriteParamsSchema,
  OpenAISettingsReadResultSchema,
  OpenAIUiResourceMetadataSchema,
  type ServerMessage,
  type ThreadInputBlock,
  type ThreadMessageOrigin,
  type ThreadTimelineItem,
  type ThreadView,
} from "@cypheria/protocol"
import type { Logger } from "pino"
import type { UntrustedAppInput } from "../thread/harness-adapter.js"
import {
  appContentToInput,
  ModelContextStore,
  modelContextToInput,
  modelContextToUntrusted,
  parseAppContent,
  untrustedAppInput,
} from "./app-content.js"
import {
  type BuiltCatalog,
  buildCatalog,
  type CatalogRoute,
  type HostInventory,
  toolResourceUri,
  toolVisibility,
} from "./catalog.js"
import { FileResourceStore } from "./file-resources.js"
import {
  ExtensionUnsupportedError,
  type McpHost,
  type McpHostElicitation,
  type McpHostElicitationResult,
  type McpServerInventory,
  type McpSession,
  type McpToolDescriptor,
} from "./mcp-host.js"

/** Characters of App HTML per message; four bytes each stays within the default message cap. */
const RESOURCE_PIECE = 200_000
/** How long a built catalog is reused before a client read rebuilds it. */
const CATALOG_TTL_MS = 60_000
/** How long a person has to answer an extension elicitation. */
const ELICITATION_TIMEOUT_MS = 10 * 60_000

/** How long one mention provider may take to answer a search. */
const MENTION_TIMEOUT_MS = 5_000
const MENTION_RESOURCE_BYTES = 256 * 1024

/** How many messages one App may send per minute. */
const MESSAGES_PER_MINUTE = 10

/** The Thread operations extensions use. */
export type ExtensionThreads = {
  get(threadId: string): Promise<ThreadView | null>
  findItem(threadId: string, itemId: string): Promise<ThreadTimelineItem | null>
  startTurn(input: {
    clientMessageId: string
    content: readonly ThreadInputBlock[]
    origin: ThreadMessageOrigin
    /** The message as App content, for Agents that keep it apart from the person's words. */
    appMessage: UntrustedAppInput
    threadId: string
  }): Promise<unknown>
  /** Starts a chat for `ui/message` with `target: "new"`; returns its Thread ID. */
  create(agentId: AgentId): Promise<string>
}

/** A connected client that can receive extension notifications. */
export type ExtensionClient = {
  readonly id: string
  notify(message: ServerMessage): void
}

type Instance = {
  /** The key other clients find a shared instance by. */
  key: string | null
  /** What the instance renders; model context belongs to it across reopening. */
  contextKey: string
  /** A plugin's global page, whose App follows the chat shown beside it. */
  readonly global: boolean
  /** The opened file of a file entry point, by its canonical path and opaque URI. */
  readonly file: { readonly path: string; readonly uri: string } | null
  readonly view: ExtensionAppInstance
  readonly route: CatalogRoute
  session: McpSession
  readonly entryTool: string
  readonly html: string
  readonly mimeType: string | null
  readonly clients: Set<string>
}

type PendingElicitation = {
  readonly client: string
  readonly resolve: (result: McpHostElicitationResult) => void
  readonly timer: NodeJS.Timeout
}

type ActiveCall = { readonly client: string; readonly instanceId: string | null; server: string }

export class ExtensionError extends Error {
  constructor(code: string, message: string) {
    super(message)
    this.name = code
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const textOf = (result: ExtensionToolResult): string =>
  result.content
    .flatMap((item) => {
      const block = record(item)
      return block.type === "text" && typeof block.text === "string" ? [block.text] : []
    })
    .join("\n")

/** The display modes a UI resource allows, and the one it starts in. */
const displayModes = (
  meta: Record<string, unknown>,
  preferred: ExtensionDisplayMode | null
): { available: ExtensionDisplayMode[]; mode: ExtensionDisplayMode } => {
  const ui = OpenAIUiResourceMetadataSchema.safeParse(meta["openai/ui"] ?? {})
  const supported = (modes: readonly string[]) =>
    modes.filter((mode): mode is ExtensionDisplayMode => mode === "inline" || mode === "fullscreen")
  const resourcePreferred = ui.success ? supported([ui.data.preferredDisplayMode ?? ""])[0] : null
  const declared = ui.success && ui.data.availableDisplayModes
  const available = declared
    ? supported(declared)
    : resourcePreferred
      ? [resourcePreferred]
      : (["inline", "fullscreen"] as ExtensionDisplayMode[])
  const wanted = preferred ?? resourcePreferred ?? "inline"
  const mode = available.includes(wanted) ? wanted : (available[0] ?? "inline")
  return { available: available.length > 0 ? available : [mode], mode }
}

/**
 * The Server side of Plugin Extensions: the catalog built from what Agents report, App instances
 * every client shares, and the routing of App requests to the Agent that runs the server.
 */
export class ExtensionService {
  readonly #hosts: readonly McpHost[]
  readonly #threads: ExtensionThreads
  readonly #context = new ModelContextStore()
  /** Model context a global page's App attached before it had a chat, by instance. */
  readonly #drafts = new Map<string, ExtensionModelContext>()
  readonly #files = new FileResourceStore()
  readonly #messages = new Map<string, number[]>()
  readonly #broadcast: (message: ServerMessage) => void
  readonly #logger: Logger | undefined
  readonly #clients = new Map<string, ExtensionClient>()
  readonly #instances = new Map<string, Instance>()
  /** Shared instances, such as an entry point in a Thread, by what they render. */
  readonly #shared = new Map<string, string>()
  readonly #elicitations = new Map<string, PendingElicitation>()
  readonly #activeCalls: ActiveCall[] = []
  #catalog: { built: BuiltCatalog; builtAt: number; hash: string; revision: number } | undefined
  #building: Promise<BuiltCatalog> | undefined

  constructor(options: {
    /** Hosts in priority order: bundled plugins first, then Codex, then Claude. */
    hosts: readonly McpHost[]
    threads: ExtensionThreads
    broadcast: (message: ServerMessage) => void
    logger?: Logger
  }) {
    this.#hosts = options.hosts
    this.#threads = options.threads
    this.#broadcast = options.broadcast
    this.#logger = options.logger
  }

  /** The elicitation callback hosts use for calls they make for extensions. */
  readonly elicit = (elicitation: McpHostElicitation): Promise<McpHostElicitationResult> => {
    const call = [...this.#activeCalls]
      .reverse()
      .find((candidate) => candidate.server === elicitation.server)
    const client = call ? this.#clients.get(call.client) : undefined
    if (!call || !client) return Promise.resolve({ action: "decline" })
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#elicitations.delete(id)
        resolve({ action: "cancel" })
      }, ELICITATION_TIMEOUT_MS)
      timer.unref()
      this.#elicitations.set(id, { client: client.id, resolve, timer })
      const payload: ExtensionElicitation = {
        id,
        instanceId: call.instanceId,
        message: elicitation.message,
        mode: elicitation.mode,
        openai: elicitation.openai,
        requestedSchema: elicitation.requestedSchema,
        server: elicitation.server,
        url: elicitation.url,
      }
      client.notify({ payload, type: "extension.elicitation.notification" })
    })
  }

  /** Rebuilds the catalog after plugins, Agents, or MCP configuration change. */
  invalidate(): void {
    void this.#rebuild().catch((error: unknown) => {
      this.#logger?.warn({ err: error }, "Extension catalog rebuild failed")
    })
  }

  async catalog(refresh = false): Promise<ExtensionCatalog> {
    const current = this.#catalog
    const built =
      !refresh && current && Date.now() - current.builtAt < CATALOG_TTL_MS
        ? current.built
        : await this.#rebuild()
    const { routes: _routes, servers: _servers, ...catalog } = built
    return { ...catalog, revision: this.#catalog?.revision ?? 0 }
  }

  /**
   * The model context Apps attached to a Thread, as input for its next message. Committing
   * clears it and tells the Apps their context was sent.
   */
  readonly extensionInput = async (
    threadId: string
  ): Promise<{
    blocks: readonly ThreadInputBlock[]
    untrusted: readonly UntrustedAppInput[]
    commit(): void
  } | null> => {
    const entries = this.#context.list(threadId)
    if (entries.length === 0) return null
    return {
      blocks: modelContextToInput(entries),
      untrusted: modelContextToUntrusted(entries),
      commit: () => {
        for (const entry of this.#context.clear(threadId)) {
          this.#contextChanged(threadId, entry.key, null)
        }
      },
    }
  }

  /**
   * Searches every plugin's mention tool, or the given providers', each with its own time limit.
   * A provider that fails reports its error instead of hiding the others.
   */
  async searchMentions(
    input: { providerIds?: readonly string[]; query: string },
    clientId = ""
  ): Promise<{ error: string | null; items: ExtensionMentionItem[]; providerId: string }[]> {
    const built = await this.#built()
    const providers = built.mentions.filter(
      (provider) => !input.providerIds || input.providerIds.includes(provider.id)
    )
    return Promise.all(
      providers.map(async (provider) => {
        const route = built.routes.get(provider.id)
        try {
          if (!route) throw new Error("The mention provider is unavailable")
          const result = await Promise.race([
            this.#call(
              route,
              { kind: "host" },
              provider.tool,
              { query: input.query },
              clientId,
              null
            ),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("The search took too long")),
                MENTION_TIMEOUT_MS
              ).unref()
            ),
          ])
          if (result.isError) throw new Error(textOf(result) || "The search failed")
          const parsed = OpenAIMentionSearchResultSchema.safeParse(result.structuredContent)
          if (!parsed.success) throw new Error("The plugin returned mentions Cypheria cannot show")
          return {
            error: null,
            items: parsed.data.items.slice(0, 50).map((item) => ({
              description: item.description ?? null,
              mimeType: item.mimeType ?? null,
              name: item.name,
              title: item.title ?? null,
              uri: item.uri,
            })),
            providerId: provider.id,
          }
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            items: [],
            providerId: provider.id,
          }
        }
      })
    )
  }

  /** The mention providers' titles, by ID. */
  async mentionProviders(): Promise<ReadonlyMap<string, string>> {
    const built = await this.#built()
    return new Map(built.mentions.map((provider) => [provider.id, provider.title]))
  }

  /**
   * A mentioned resource as message input: its text, an image, or a labeled link when the
   * plugin cannot read it.
   */
  async resolveMention(input: {
    label: string
    providerId: string
    threadId: string | null
    uri: string
  }): Promise<ThreadInputBlock> {
    const built = await this.#built()
    const provider = built.mentions.find((candidate) => candidate.id === input.providerId)
    const route = built.routes.get(input.providerId)
    const label = `[${input.label}](${input.uri})${provider ? ` (from ${provider.title})` : ""}`
    const link: ThreadInputBlock = { text: label, type: "text" }
    if (!route) return link
    try {
      // Mentions read through the host session, as ChatGPT Desktop's do, not the chat's.
      const session: McpSession = { kind: "host" }
      const contents = await route.host.readResource({
        server: route.server.name,
        session,
        uri: input.uri,
      })
      const content = contents.find((item) => item.uri === input.uri) ?? contents[0]
      if (content?.text !== undefined && content.text.length <= MENTION_RESOURCE_BYTES) {
        return { text: `${label}:\n${content.text}`, type: "text" }
      }
      if (content?.blob && content.mimeType?.startsWith("image/")) {
        return { data: content.blob, mimeType: content.mimeType, type: "image" }
      }
    } catch {
      // The link still names what the person mentioned.
    }
    return link
  }

  /** Forgets a disconnected client: its instances lose it and its forms are cancelled. */
  detach(clientId: string): void {
    this.#clients.delete(clientId)
    for (const instance of [...this.#instances.values()]) {
      instance.clients.delete(clientId)
      if (instance.clients.size === 0) this.#drop(instance)
    }
    for (const [id, pending] of this.#elicitations) {
      if (pending.client !== clientId) continue
      clearTimeout(pending.timer)
      this.#elicitations.delete(id)
      pending.resolve({ action: "cancel" })
    }
  }

  async dispose(): Promise<void> {
    for (const pending of this.#elicitations.values()) {
      clearTimeout(pending.timer)
      pending.resolve({ action: "cancel" })
    }
    this.#elicitations.clear()
    this.#instances.clear()
    this.#shared.clear()
    await Promise.all(this.#hosts.map((host) => host.dispose?.().catch(() => undefined)))
  }

  async handle(
    message: ExtensionClientMessage,
    client: ExtensionClient,
    send: (message: ExtensionServerMessage) => void
  ): Promise<boolean> {
    this.#clients.set(client.id, client)
    const type = message.type.replace(/\.request$/u, ".response") as ExtensionServerMessage["type"]
    try {
      const value = await this.#run(message, client)
      send({ payload: { ok: true, value }, requestId: message.requestId, type } as never)
    } catch (error) {
      send({
        payload: {
          error: {
            code: error instanceof Error && error.name !== "Error" ? error.name : "EXTENSION_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
          ok: false,
        },
        requestId: message.requestId,
        type,
      } as never)
    }
    return true
  }

  async #run(message: ExtensionClientMessage, client: ExtensionClient): Promise<unknown> {
    switch (message.type) {
      case "extension.catalog.get.request":
        return this.catalog(message.payload.refresh)
      case "extension.app.open.request":
        return { instance: await this.#open(message.payload.target, client) }
      case "extension.app.resource.read.request":
        return this.#readResource(message.payload.instanceId, message.payload.offset ?? 0)
      case "extension.app.request.request":
        return {
          result: await this.#appRequest(
            this.#instance(message.payload.instanceId),
            message.payload.method,
            message.payload.params ?? {},
            client
          ),
        }
      case "extension.app.bind.request":
        return {
          instance: await this.#bind(
            this.#instance(message.payload.instanceId),
            message.payload.threadId
          ),
        }
      case "extension.app.close.request": {
        const instance = this.#instances.get(message.payload.instanceId)
        instance?.clients.delete(client.id)
        if (instance && instance.clients.size === 0) this.#drop(instance)
        return {}
      }
      case "extension.settings.read.request":
        return this.#readSettings(message.payload.providerId, client)
      case "extension.settings.update.request":
        return this.#updateSettings(message.payload.providerId, message.payload.set, client)
      case "extension.settings.tool.request":
        return this.#settingsTool(message.payload.providerId, message.payload.tool, client)
      case "extension.elicitation.respond.request": {
        const pending = this.#elicitations.get(message.payload.elicitationId)
        if (!pending || pending.client !== client.id) {
          throw new ExtensionError("EXTENSION_NOT_FOUND", "This request is no longer waiting")
        }
        clearTimeout(pending.timer)
        this.#elicitations.delete(message.payload.elicitationId)
        pending.resolve({
          action: message.payload.action,
          ...(message.payload.content ? { content: message.payload.content } : {}),
        })
        return {}
      }
      case "extension.context.list.request":
        return { entries: this.#context.list(message.payload.threadId) }
      case "extension.context.remove.request": {
        const { index, key, threadId } = message.payload
        const remaining = this.#context.remove(threadId, key, index)
        this.#contextChanged(threadId, key, remaining)
        return {}
      }
      case "extension.mentions.search.request":
        return { groups: await this.searchMentions(message.payload, client.id) }
    }
  }

  async #rebuild(): Promise<BuiltCatalog> {
    if (this.#building) return this.#building
    const building = (async () => {
      const inventories: HostInventory[] = await Promise.all(
        this.#hosts.map(async (host) => ({
          host,
          servers: await host.listServers().catch((error: unknown) => {
            this.#logger?.warn({ agentId: host.agentId, err: error }, "MCP server listing failed")
            return [] as McpServerInventory[]
          }),
        }))
      )
      const built = buildCatalog(inventories)
      const { routes: _routes, servers: _servers, ...surfaces } = built
      const hash = createHash("sha256").update(JSON.stringify(surfaces)).digest("hex")
      const previous = this.#catalog
      const changed = previous?.hash !== hash
      const revision = changed ? (previous?.revision ?? 0) + 1 : (previous?.revision ?? 0)
      this.#catalog = { built, builtAt: Date.now(), hash, revision }
      if (previous && changed) {
        this.#broadcast({ payload: { revision }, type: "extension.catalog.updated.notification" })
      }
      return built
    })()
    this.#building = building
    try {
      return await building
    } finally {
      if (this.#building === building) this.#building = undefined
    }
  }

  async #built(): Promise<BuiltCatalog> {
    return this.#catalog?.built ?? this.#rebuild()
  }

  #drop(instance: Instance): void {
    this.#instances.delete(instance.view.id)
    this.#drafts.delete(instance.view.id)
    this.#files.release(instance.view.id)
    if (instance.key && this.#shared.get(instance.key) === instance.view.id) {
      this.#shared.delete(instance.key)
    }
  }

  #instance(id: string): Instance {
    const instance = this.#instances.get(id)
    if (!instance) throw new ExtensionError("EXTENSION_NOT_FOUND", "This App is no longer open")
    return instance
  }

  async #session(route: CatalogRoute, threadId: string | null): Promise<McpSession> {
    if (threadId && (await route.host.threadSession?.(threadId))) {
      return { kind: "thread", threadId }
    }
    return { kind: "host" }
  }

  async #open(target: ExtensionAppTarget, client: ExtensionClient): Promise<ExtensionAppInstance> {
    const built = await this.#built()
    const id = randomUUID()
    let file: { path: string; uri: string } | null = null
    let key: string
    let route: CatalogRoute
    let tool: McpToolDescriptor | undefined
    let threadId: string | null = null
    let toolInput: Record<string, unknown> = {}
    let title: string
    let preferred: ExtensionDisplayMode | null = null
    let hostContext: Record<string, unknown> = {}
    /** A tool call's own result; other targets call their tool when they open. */
    let recorded: { result: ExtensionToolResult | null; error: string | null } | null = null
    let resourceUri: string | null = null
    let global = false
    switch (target.kind) {
      case "entrypoint": {
        const entrypoint = built.entrypoints.find((entry) => entry.id === target.entrypointId)
        const found = built.routes.get(target.entrypointId)
        if (!entrypoint || !found) {
          throw new ExtensionError("EXTENSION_NOT_FOUND", "This entry point is no longer available")
        }
        if (entrypoint.type === "file") {
          const thread = target.threadId ? await this.#threads.get(target.threadId) : null
          if (!thread || !target.path) {
            throw new ExtensionError("EXTENSION_INVALID", "A file entry point needs a chat's file")
          }
          const path = await this.#files.resolve(thread.roots, target.path)
          const extension = basename(path).toLowerCase()
          if (!entrypoint.extensions.some((candidate) => extension.endsWith(`.${candidate}`))) {
            throw new ExtensionError(
              "EXTENSION_INVALID",
              `${entrypoint.title} does not open this file`
            )
          }
          file = { path, uri: "" }
        }
        if (entrypoint.type === "thread" && !target.threadId) {
          throw new ExtensionError("EXTENSION_INVALID", "A Thread entry point needs a Thread")
        }
        route = found
        // A global entry point opened beside a chat belongs to that Thread, as on ChatGPT's
        // global page, where the composer's Thread receives the App's context and messages.
        threadId = entrypoint.type === "settings" ? null : (target.threadId ?? null)
        global = entrypoint.type === "global"
        tool = route.server.tools.find((candidate) => candidate.name === entrypoint.tool)
        title = entrypoint.title
        preferred = "fullscreen"
        key = JSON.stringify(["entrypoint", entrypoint.id, threadId, file?.path ?? null])
        if (target.deepLink) hostContext = { "openai/deepLink": { url: target.deepLink } }
        break
      }
      case "tool": {
        const found = [...built.servers.values()].find(
          (candidate) => candidate.server.name === target.server
        )
        if (!found) {
          throw new ExtensionError(
            "EXTENSION_NOT_FOUND",
            `MCP server ${target.server} is unavailable`
          )
        }
        route = found
        threadId = target.threadId ?? null
        tool = route.server.tools.find((candidate) => candidate.name === target.tool)
        title = tool ? (tool.title ?? tool.name) : target.tool
        toolInput = target.arguments ?? {}
        preferred = "fullscreen"
        key = JSON.stringify(["tool", randomUUID()])
        break
      }
      case "tool-call": {
        const opened = await this.#toolCall(built, target.threadId, target.itemId)
        route = opened.route
        tool = opened.tool
        threadId = target.threadId
        title = opened.title
        toolInput = opened.input
        preferred = opened.displayMode
        recorded = { error: opened.error, result: opened.result }
        resourceUri = opened.resourceUri
        key = JSON.stringify(["tool-call", target.threadId, target.itemId])
        break
      }
    }
    if (!tool) throw new ExtensionError("EXTENSION_NOT_FOUND", "The App's tool is unavailable")
    resourceUri ??= toolResourceUri(tool)
    if (!resourceUri) {
      throw new ExtensionError("EXTENSION_INVALID", `${tool.name} does not declare an MCP App`)
    }

    const sharedId = this.#shared.get(key)
    const existing = sharedId ? this.#instances.get(sharedId) : undefined
    if (existing) {
      if (file) this.#files.release(id)
      existing.clients.add(client.id)
      if (Object.keys(hostContext).length > 0) {
        Object.assign(existing.view.hostContext, hostContext)
        this.#notifyInstance(existing, "ui/notifications/host-context-changed", hostContext)
      }
      return existing.view
    }

    if (file) {
      file = { path: file.path, uri: this.#files.bind(id, file.path) }
      toolInput = { file: { name: basename(file.path), resourceUri: file.uri } }
    }
    const session = await this.#session(route, threadId)
    const contents = await route.host.readResource({
      server: route.server.name,
      session,
      uri: resourceUri,
    })
    const content = contents.find((item) => item.uri === resourceUri) ?? contents[0]
    if (content?.text === undefined) {
      throw new ExtensionError("EXTENSION_INVALID", "The MCP App resource has no document")
    }
    if (content.mimeType && !content.mimeType.startsWith("text/html")) {
      throw new ExtensionError("EXTENSION_INVALID", `Unsupported MCP App type ${content.mimeType}`)
    }
    const resourceMeta = content._meta ?? {}
    const modes = displayModes(resourceMeta, preferred)
    const hosted = route.host.support
    const external = route.host.agentId !== null
    const capabilities: ExtensionAppCapabilities = {
      host: external ? [] : ["cypheria/"],
      // Bundled Apps start chats through their own host requests.
      message: external,
      modelContext: external && (threadId !== null || global),
      openFiles: external && threadId !== null,
      resource: file !== null,
      serverResources: hosted.serverResources,
      toolCalls: hosted.toolCalls,
    }
    let toolResult: ExtensionToolResult | null = recorded?.result ?? null
    let toolError: string | null = recorded?.error ?? null
    if (!recorded) {
      try {
        toolResult = await this.#call(
          route,
          session,
          tool.name,
          toolInput,
          client.id,
          null,
          file ? { "openai/resource": { path: file.path } } : undefined
        )
      } catch (error) {
        toolError = error instanceof Error ? error.message : String(error)
      }
    }
    const context = threadId ? this.#context.get(threadId, key) : null
    if (context) {
      hostContext["openai/modelContext"] = {
        content: context.content,
        ...(context.structuredContent ? { structuredContent: context.structuredContent } : {}),
        updateId: context.updateId,
      }
    }
    const view: ExtensionAppInstance = {
      agentId: route.host.agentId,
      availableDisplayModes: modes.available,
      capabilities,
      displayMode: modes.mode,
      hostContext,
      id,
      pluginId: route.server.pluginId,
      resourceMeta,
      resourceUri,
      server: route.server.name,
      threadId,
      title,
      tool: tool.name,
      toolError,
      toolInput,
      toolResult,
    }
    // Entry points and tool calls are shared, so a second client attaches to the same instance.
    const shared = target.kind === "tool" ? null : key
    const instance: Instance = {
      clients: new Set([client.id]),
      contextKey: key,
      file,
      global,
      key: shared,
      entryTool: tool.name,
      html: content.text,
      mimeType: content.mimeType ?? null,
      route,
      session,
      view,
    }
    this.#instances.set(id, instance)
    if (shared) this.#shared.set(shared, id)
    return view
  }

  /** A model tool call's App: the call's server, its recorded input and result. */
  async #toolCall(built: BuiltCatalog, threadId: string, itemId: string) {
    const [thread, item] = await Promise.all([
      this.#threads.get(threadId),
      this.#threads.findItem(threadId, itemId),
    ])
    if (!thread || item?.type !== "tool" || !item.app) {
      throw new ExtensionError("EXTENSION_NOT_FOUND", "This tool call has no App")
    }
    const { app } = item
    const candidates = [...built.servers.values()].filter(
      (candidate) =>
        candidate.server.name === app.server &&
        (app.pluginId === null || candidate.server.pluginId === app.pluginId)
    )
    const route =
      candidates.find((candidate) => candidate.host.agentId === thread.agentId) ?? candidates[0]
    if (!route) {
      throw new ExtensionUnsupportedError(
        `MCP server ${app.server} is unavailable to render its App`
      )
    }
    const tool = route.server.tools.find((candidate) => candidate.name === app.tool) ?? {
      _meta: { ui: { resourceUri: app.resourceUri } },
      name: app.tool,
    }
    const output = record(item.output)
    const result: ExtensionToolResult | null = Array.isArray(output.content)
      ? (output as ExtensionToolResult)
      : null
    return {
      displayMode: app.displayMode ?? "inline",
      error: item.error,
      input: record(item.input),
      resourceUri: app.resourceUri,
      result,
      route,
      title: tool.title ?? app.tool,
      tool,
    }
  }

  #readResource(instanceId: string, offset: number) {
    const instance = this.#instance(instanceId)
    const end = Math.min(instance.html.length, offset + RESOURCE_PIECE)
    return {
      mimeType: instance.mimeType,
      nextOffset: end < instance.html.length ? end : null,
      text: instance.html.slice(offset, end),
    }
  }

  async #call(
    route: CatalogRoute,
    session: McpSession,
    tool: string,
    args: Record<string, unknown>,
    clientId: string,
    instanceId: string | null,
    meta?: Record<string, unknown>
  ): Promise<ExtensionToolResult> {
    if (!route.host.support.toolCalls) {
      throw new ExtensionUnsupportedError(
        `${route.host.agentId ?? "This host"} cannot call MCP tools for Apps`
      )
    }
    const call: ActiveCall = { client: clientId, instanceId, server: route.server.name }
    this.#activeCalls.push(call)
    try {
      return await route.host.callTool({
        arguments: args,
        ...(meta ? { meta } : {}),
        server: route.server.name,
        session,
        tool,
      })
    } finally {
      this.#activeCalls.splice(this.#activeCalls.indexOf(call), 1)
    }
  }

  async #appRequest(
    instance: Instance,
    method: string,
    params: Record<string, unknown>,
    client: ExtensionClient
  ): Promise<unknown> {
    switch (method) {
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : ""
        const tool = instance.route.server.tools.find((candidate) => candidate.name === name)
        const allowed =
          name === instance.entryTool ||
          instance.route.host.agentId === null ||
          (tool !== undefined && toolVisibility(tool).includes("app"))
        if (!allowed) {
          throw new ExtensionError(
            "EXTENSION_FORBIDDEN",
            `This App cannot call ${name || "that tool"}`
          )
        }
        // A file entry point's calls to its own server carry the file's path.
        const meta = {
          ...record(params._meta),
          ...(instance.file ? { "openai/resource": { path: instance.file.path } } : {}),
        }
        return this.#call(
          instance.route,
          instance.session,
          name,
          record(params.arguments),
          client.id,
          instance.view.id,
          Object.keys(meta).length > 0 ? meta : undefined
        )
      }
      case "resources/read": {
        if (instance.file && params.uri === instance.file.uri) {
          const requested = OpenAIResourceReadMetadataSchema.safeParse(
            record(params._meta)["openai/resource"] ?? {}
          )
          if (!requested.success) {
            throw new ExtensionError("EXTENSION_INVALID", "Invalid resource representation")
          }
          return this.#files.read(
            instance.view.id,
            instance.file.uri,
            requested.data.representation ?? "auto"
          )
        }
        if (!instance.view.capabilities.serverResources) {
          throw new ExtensionUnsupportedError("This App cannot read its server's resources")
        }
        const uri = typeof params.uri === "string" ? params.uri : ""
        if (!uri) throw new ExtensionError("EXTENSION_INVALID", "resources/read needs a URI")
        return {
          contents: await instance.route.host.readResource({
            ...(params._meta ? { meta: record(params._meta) } : {}),
            server: instance.route.server.name,
            session: instance.session,
            uri,
          }),
        }
      }
      case "resources/subscribe":
      case "resources/unsubscribe": {
        const file = instance.file
        if (!file || params.uri !== file.uri) {
          throw new ExtensionUnsupportedError("Apps may subscribe only to the file they opened")
        }
        if (method === "resources/unsubscribe") this.#files.unsubscribe(instance.view.id, file.uri)
        else {
          this.#files.subscribe(instance.view.id, file.uri, () =>
            this.#notifyInstance(instance, "notifications/resources/updated", { uri: file.uri })
          )
        }
        return {}
      }
      case "openai/resources/write": {
        const write = OpenAIResourceWriteParamsSchema.safeParse(params)
        if (!instance.file || !write.success || write.data.uri !== instance.file.uri) {
          throw new ExtensionError(
            "EXTENSION_FORBIDDEN",
            "Apps may write only the file they opened"
          )
        }
        return this.#files.write(instance.view.id, write.data)
      }
      case "openai/files/open": {
        const open = OpenAIFileOpenParamsSchema.safeParse(params)
        const thread = instance.view.threadId
          ? await this.#threads.get(instance.view.threadId)
          : null
        if (!instance.view.capabilities.openFiles || !thread || !open.success) {
          throw new ExtensionUnsupportedError("This App has no chat workspace to open files in")
        }
        const path = await this.#files.resolve(thread.roots, open.data.path)
        return { _meta: { "cypheria/file": { path, threadId: thread.id } } }
      }
      case "ui/update-model-context":
        return this.#updateModelContext(instance, params)
      case "ui/message":
        return this.#message(instance, params)
      default:
        throw new ExtensionUnsupportedError(`${method} is not available to this App`)
    }
  }

  #updateModelContext(instance: Instance, params: Record<string, unknown>) {
    const threadId = instance.view.threadId
    if (!instance.view.capabilities.modelContext || (!threadId && !instance.global)) {
      throw new ExtensionUnsupportedError("This App has no chat to attach context to")
    }
    const content = parseAppContent(params.content)
    const structuredContent =
      params.structuredContent === undefined ? null : record(params.structuredContent)
    if (structuredContent && Buffer.byteLength(JSON.stringify(structuredContent)) > 512 * 1024) {
      throw new ExtensionError(
        "EXTENSION_INVALID",
        "The App sent more context than Cypheria accepts"
      )
    }
    const updateId = randomUUID()
    const entry: ExtensionModelContext = {
      content,
      key: instance.contextKey,
      pluginId: instance.view.pluginId,
      server: instance.view.server,
      structuredContent,
      title: instance.view.title,
      updateId,
    }
    const attached = content.length > 0 || structuredContent ? entry : null
    if (!threadId) {
      // A global page before its first message: the context waits for the chat it starts.
      if (attached) this.#drafts.set(instance.view.id, attached)
      else this.#drafts.delete(instance.view.id)
      this.#showContext(instance, attached)
      return { _meta: { "openai/modelContext": { updateId } } }
    }
    this.#context.set(threadId, entry)
    this.#contextChanged(threadId, instance.contextKey, attached)
    return { _meta: { "openai/modelContext": { updateId } } }
  }

  /** Tells one instance's App what model context it has attached. */
  #showContext(instance: Instance, entry: ExtensionModelContext | null): void {
    const state = entry
      ? {
          content: entry.content,
          ...(entry.structuredContent ? { structuredContent: entry.structuredContent } : {}),
          updateId: entry.updateId,
        }
      : null
    instance.view.hostContext["openai/modelContext"] = state
    this.#notifyInstance(instance, "ui/notifications/host-context-changed", {
      "openai/modelContext": state,
    })
  }

  /**
   * Moves a global page's App to another chat, or to none for a new one, without reopening it.
   * Its context comes along: the context it attached to the previous chat is copied to the next,
   * as ChatGPT Desktop does when a workspace starts a new chat.
   */
  async #bind(instance: Instance, threadId: string | null): Promise<ExtensionAppInstance> {
    if (!instance.global) {
      throw new ExtensionUnsupportedError("Only a plugin's global page follows another chat")
    }
    const previous = instance.view.threadId
    if (previous === threadId) return instance.view
    if (threadId && !(await this.#threads.get(threadId))) {
      throw new ExtensionError("EXTENSION_NOT_FOUND", "The chat is unavailable")
    }
    const carried = previous
      ? this.#context.get(previous, instance.contextKey)
      : (this.#drafts.get(instance.view.id) ?? null)
    const entrypointId = JSON.parse(instance.contextKey)[1] as string
    const key = JSON.stringify(["entrypoint", entrypointId, threadId, null])
    if (instance.key && this.#shared.get(instance.key) === instance.view.id) {
      this.#shared.delete(instance.key)
    }
    if (!this.#shared.has(key)) this.#shared.set(key, instance.view.id)
    instance.key = key
    instance.contextKey = key
    instance.session = await this.#session(instance.route, threadId)
    instance.view.threadId = threadId
    instance.view.capabilities.openFiles = instance.view.capabilities.message && threadId !== null
    this.#drafts.delete(instance.view.id)
    const entry = carried ? { ...carried, key } : null
    if (threadId) {
      if (entry) {
        this.#context.set(threadId, entry)
        this.#contextChanged(threadId, key, entry)
      } else {
        this.#showContext(instance, this.#context.get(threadId, key))
      }
    } else {
      if (entry) this.#drafts.set(instance.view.id, entry)
      this.#showContext(instance, entry)
    }
    return instance.view
  }

  async #message(instance: Instance, params: Record<string, unknown>) {
    if (!instance.view.capabilities.message) {
      throw new ExtensionUnsupportedError("This App cannot send messages")
    }
    if (params.role !== undefined && params.role !== "user") {
      throw new ExtensionError("EXTENSION_INVALID", "Apps send messages as the user")
    }
    const options = OpenAIMessageOptionsSchema.safeParse(
      record(params._meta)["openai/message"] ?? {}
    )
    if (!options.success) {
      throw new ExtensionError("EXTENSION_INVALID", "Unsupported openai/message options")
    }
    const blocks = parseAppContent(params.content)
    if (blocks.length === 0) throw new ExtensionError("EXTENSION_INVALID", "The message is empty")
    const now = Date.now()
    const recent = (this.#messages.get(instance.contextKey) ?? []).filter((at) => now - at < 60_000)
    if (recent.length >= MESSAGES_PER_MINUTE) {
      throw new ExtensionError("EXTENSION_RATE_LIMITED", "The App is sending messages too quickly")
    }
    this.#messages.set(instance.contextKey, [...recent, now])
    let threadId = options.data.target === "new" ? null : instance.view.threadId
    // An App without a chat, such as a global page before its first message, starts one.
    if (!threadId) {
      const agentId =
        (instance.view.threadId
          ? (await this.#threads.get(instance.view.threadId))?.agentId
          : undefined) ??
        instance.view.agentId ??
        "codex"
      threadId = await this.#threads.create(agentId)
      // A global page's App follows the chat it starts, bringing the context it attached.
      if (instance.global && !instance.view.threadId) await this.#bind(instance, threadId)
    }
    await this.#threads.startTurn({
      clientMessageId: randomUUID(),
      content: appContentToInput(blocks),
      appMessage: untrustedAppInput({
        content: blocks,
        kind: "message",
        server: instance.view.server,
        sourceId: instance.contextKey,
        title: instance.view.title,
      }),
      origin: {
        kind: "extension",
        pluginId: instance.view.pluginId,
        server: instance.view.server,
        title: instance.view.title,
      },
      threadId,
    })
    return { _meta: { "cypheria/threadId": threadId } }
  }

  /** Tells clients and the App that attached it that a Thread's model context changed. */
  #contextChanged(threadId: string, key: string, entry: ExtensionModelContext | null): void {
    const state = entry
      ? {
          content: entry.content,
          ...(entry.structuredContent ? { structuredContent: entry.structuredContent } : {}),
          updateId: entry.updateId,
        }
      : null
    for (const instance of this.#instances.values()) {
      if (instance.contextKey !== key || instance.view.threadId !== threadId) continue
      instance.view.hostContext["openai/modelContext"] = state
      this.#notifyInstance(instance, "ui/notifications/host-context-changed", {
        "openai/modelContext": state,
      })
    }
    this.#broadcast({ payload: { threadId }, type: "extension.context.updated.notification" })
  }

  #notifyInstance(instance: Instance, method: string, params: Record<string, unknown>): void {
    for (const clientId of instance.clients) {
      this.#clients.get(clientId)?.notify({
        payload: { instanceId: instance.view.id, method, params },
        type: "extension.app.notification",
      })
    }
  }

  async #settingsRoute(providerId: string) {
    const built = await this.#built()
    const provider = built.settings.find((candidate) => candidate.id === providerId)
    const route = built.routes.get(providerId)
    if (!provider || !route) {
      throw new ExtensionError("EXTENSION_NOT_FOUND", "These settings are no longer available")
    }
    return { provider, route }
  }

  async #readSettings(providerId: string, client: ExtensionClient) {
    const { provider, route } = await this.#settingsRoute(providerId)
    const result = await this.#call(route, { kind: "host" }, provider.readTool, {}, client.id, null)
    if (result.isError)
      throw new ExtensionError("EXTENSION_TOOL_ERROR", textOf(result) || "Reading settings failed")
    const parsed = OpenAISettingsReadResultSchema.safeParse(result.structuredContent)
    if (!parsed.success) {
      throw new ExtensionError(
        "EXTENSION_INVALID",
        "The plugin returned settings Cypheria cannot show"
      )
    }
    // Layout tools that are MCP Apps open in a modal; the others run and show their text.
    const appTools = new Set(
      route.server.tools.filter((tool) => toolResourceUri(tool)).map((tool) => tool.name)
    )
    return {
      layout: (parsed.data.layout ?? []).map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.kind === "tool" ? { ...item, app: appTools.has(item.tool) } : item
        ),
      })),
      schema: parsed.data.schema as Record<string, unknown>,
      values: parsed.data.values,
    }
  }

  async #updateSettings(
    providerId: string,
    set: Record<string, string | number | boolean>,
    client: ExtensionClient
  ) {
    const { provider, route } = await this.#settingsRoute(providerId)
    const result = await this.#call(
      route,
      { kind: "host" },
      provider.updateTool,
      { set },
      client.id,
      null
    )
    if (result.isError)
      throw new ExtensionError("EXTENSION_TOOL_ERROR", textOf(result) || "Saving settings failed")
    return { values: record(record(result.structuredContent).values) }
  }

  async #settingsTool(providerId: string, tool: string, client: ExtensionClient) {
    const { route } = await this.#settingsRoute(providerId)
    if (!route.server.tools.some((candidate) => candidate.name === tool)) {
      throw new ExtensionError("EXTENSION_NOT_FOUND", `${tool} is not a tool of this plugin`)
    }
    const result = await this.#call(route, { kind: "host" }, tool, {}, client.id, null)
    return { isError: result.isError === true, text: textOf(result) }
  }
}
