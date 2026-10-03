import { mkdir } from "node:fs/promises"
import type { ExtensionToolResult, ThreadView } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

import type { AgentManager } from "../agent/agent-manager.js"
import { MCP_EXTENSION_HOST_THREAD_SOURCE } from "../agent/codex-runtime.js"
import { BUNDLED_MARKETPLACE_NAME } from "../integration/plugin-utils.js"
import type {
  McpHost,
  McpHostElicitation,
  McpHostElicitationResult,
  McpResourceContent,
  McpServerInventory,
  McpSession,
  McpToolDescriptor,
} from "./mcp-host.js"

type Agents = Pick<AgentManager, "callCodex" | "hideCodexThread" | "unhideCodexThread">

const TOOL_TIMEOUT_MS = 300_000
const READ_TIMEOUT_MS = 60_000
/** Codex hosts OpenAI's connectors in this server; they belong to Codex Apps, not extensions. */
export const CODEX_APPS_SERVER = "codex_apps"
const LOADED_STATES = new Set<ThreadView["state"]>(["idle", "running"])
/** How long a call waits for a Thread that is starting, and how often it looks. */
const STARTING_WAIT_MS = 30_000
const STARTING_POLL_MS = 200

/** Errors after which the hidden Thread is replaced, as ChatGPT Desktop does once. */
const isStaleSession = (error: unknown): boolean =>
  error instanceof Error &&
  /transport closed|thread not found|unknown thread|no (?:such|active) thread|not loaded/iu.test(
    error.message
  )

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const toTool = (name: string, tool: v2.McpServerStatus["tools"][string]): McpToolDescriptor => ({
  ...(record(tool?._meta) ? { _meta: record(tool?._meta) } : {}),
  ...(record(tool?.annotations) ? { annotations: record(tool?.annotations) } : {}),
  ...(tool?.description ? { description: tool.description } : {}),
  ...(Array.isArray(tool?.icons) ? { icons: tool.icons } : {}),
  inputSchema: tool?.inputSchema,
  name: tool?.name ?? name,
  ...(tool?.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
  ...(tool?.title ? { title: tool.title } : {}),
})

/**
 * Codex as an extension host. Codex runs and authenticates every MCP server; this host lists them,
 * and calls them in a Cypheria Thread's own Codex session or, for surfaces without a loaded
 * session, in a hidden read-only ephemeral Thread, like ChatGPT Desktop's `mcp_extension_host`.
 */
export class CodexMcpHost implements McpHost {
  readonly agentId = "codex" as const
  readonly support = { fullMetadata: true, serverResources: true, toolCalls: true }
  readonly #agents: Agents
  readonly #cwd: string
  readonly #thread: (threadId: string) => Promise<ThreadView | null>
  readonly #resume: (threadId: string) => Promise<ThreadView | null>
  readonly #elicit: (elicitation: McpHostElicitation) => Promise<McpHostElicitationResult>
  #hostThread: Promise<string> | undefined

  constructor(options: {
    agents: Agents
    /** The hidden Thread's working directory, which holds nothing. */
    cwd: string
    elicit: (elicitation: McpHostElicitation) => Promise<McpHostElicitationResult>
    thread: (threadId: string) => Promise<ThreadView | null>
    /** Loads a stopped Thread's Agent session again. */
    resume: (threadId: string) => Promise<ThreadView | null>
  }) {
    this.#agents = options.agents
    this.#cwd = options.cwd
    this.#elicit = options.elicit
    this.#thread = options.thread
    this.#resume = options.resume
  }

  async listServers(): Promise<readonly McpServerInventory[]> {
    const statuses: v2.McpServerStatus[] = []
    let cursor: string | null = null
    try {
      for (let page = 0; page < 50; page += 1) {
        const response = (await this.#agents.callCodex(
          "mcpServerStatus/list",
          { cursor, detail: "full", limit: 100 },
          { timeoutMs: READ_TIMEOUT_MS }
        )) as unknown as v2.ListMcpServerStatusResponse
        statuses.push(...response.data)
        cursor = response.nextCursor
        if (!cursor) break
      }
    } catch {
      // Codex is not installed, enabled, or running: it hosts nothing.
      return []
    }
    return statuses
      .filter(
        (status) =>
          status.name !== CODEX_APPS_SERVER &&
          !status.pluginId?.endsWith(`@${BUNDLED_MARKETPLACE_NAME}`)
      )
      .map((status) => ({
        capabilities: record(status.serverCapabilities) ?? null,
        error: status.toolsError,
        name: status.name,
        pluginId: status.pluginId,
        serverInfo: status.serverInfo
          ? {
              icons: status.serverInfo.icons,
              name: status.serverInfo.name,
              title: status.serverInfo.title,
            }
          : null,
        tools: Object.entries(status.tools).map(([name, tool]) => toTool(name, tool)),
      }))
  }

  /**
   * The tools of Codex Apps, by name with their `_meta`: the connectors the user linked in
   * ChatGPT, which Cypheria calls itself for host features such as creating pull requests.
   */
  async codexAppsTools(): Promise<ReadonlyMap<string, Record<string, unknown> | undefined>> {
    let cursor: string | null = null
    for (let page = 0; page < 50; page += 1) {
      const response = (await this.#agents.callCodex(
        "mcpServerStatus/list",
        { cursor, detail: "full", limit: 100 },
        { timeoutMs: READ_TIMEOUT_MS }
      )) as unknown as v2.ListMcpServerStatusResponse
      const apps = response.data.find((status) => status.name === CODEX_APPS_SERVER)
      if (apps) {
        return new Map(
          Object.entries(apps.tools).map(([name, tool]) => [name, record(tool?._meta)])
        )
      }
      cursor = response.nextCursor
      if (!cursor) break
    }
    return new Map()
  }

  /** Calls for a Codex Thread run in that Thread's own session, which is loaded when needed. */
  async threadSession(threadId: string): Promise<boolean> {
    return (await this.#thread(threadId).catch(() => null))?.agentId === "codex"
  }

  async readResource(input: {
    meta?: Record<string, unknown>
    server: string
    session: McpSession
    uri: string
  }): Promise<readonly McpResourceContent[]> {
    const response = (await this.#inSession(input.session, (threadId) =>
      this.#agents.callCodex(
        "mcpServer/resource/read",
        { server: input.server, threadId, uri: input.uri },
        { timeoutMs: READ_TIMEOUT_MS }
      )
    )) as unknown as v2.McpResourceReadResponse
    return response.contents.map((content) => {
      const item = content as Record<string, unknown>
      return {
        ...(record(item._meta) ? { _meta: record(item._meta) } : {}),
        ...(typeof item.blob === "string" ? { blob: item.blob } : {}),
        ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
        ...(typeof item.text === "string" ? { text: item.text } : {}),
        uri: typeof item.uri === "string" ? item.uri : input.uri,
      }
    })
  }

  async callTool(input: {
    arguments: Record<string, unknown>
    meta?: Record<string, unknown>
    server: string
    session: McpSession
    signal?: AbortSignal
    tool: string
  }): Promise<ExtensionToolResult> {
    const response = (await this.#inSession(input.session, (threadId) =>
      this.#agents.callCodex(
        "mcpServer/tool/call",
        {
          arguments: input.arguments,
          ...(input.meta ? { _meta: input.meta } : {}),
          server: input.server,
          threadId,
          tool: input.tool,
        },
        { timeoutMs: TOOL_TIMEOUT_MS }
      )
    )) as unknown as v2.McpServerToolCallResponse
    return {
      ...(record(response._meta) ? { _meta: record(response._meta) } : {}),
      content: response.content,
      ...(response.isError === undefined ? {} : { isError: response.isError }),
      ...(record(response.structuredContent)
        ? { structuredContent: record(response.structuredContent) }
        : {}),
    }
  }

  async dispose(): Promise<void> {
    const pending = this.#hostThread
    this.#hostThread = undefined
    const threadId = await pending?.catch(() => undefined)
    if (threadId) {
      await this.#agents.unhideCodexThread(threadId)
      await this.#agents.callCodex("thread/unsubscribe", { threadId }).catch(() => undefined)
    }
  }

  /**
   * The Codex session of a Cypheria Codex Thread, loading it when it is stopped, as ChatGPT
   * Desktop calls a chat's Apps in that chat's own session. Null for a Thread of another Agent.
   */
  async #codexSession(threadId: string, reload = false): Promise<string | null> {
    let thread = await this.#thread(threadId).catch(() => null)
    if (!thread || thread.agentId !== "codex") return null
    for (let waited = 0; thread?.state === "starting" && waited < STARTING_WAIT_MS; ) {
      await new Promise((resolve) => setTimeout(resolve, STARTING_POLL_MS))
      waited += STARTING_POLL_MS
      thread = await this.#thread(threadId).catch(() => null)
    }
    if (thread && (reload || thread.state === "stopped" || thread.state === "errored")) {
      thread = await this.#resume(threadId)
    }
    if (thread?.agentSessionId && LOADED_STATES.has(thread.state)) return thread.agentSessionId
    throw new Error("The chat's Codex session is unavailable")
  }

  async #inSession<T>(session: McpSession, call: (threadId: string) => Promise<T>): Promise<T> {
    if (session.kind === "thread") {
      const codexThreadId = await this.#codexSession(session.threadId)
      if (codexThreadId) {
        try {
          return await call(codexThreadId)
        } catch (error) {
          if (!isStaleSession(error)) throw error
          const reloaded = await this.#codexSession(session.threadId, true)
          if (!reloaded) throw error
          return call(reloaded)
        }
      }
    }
    const threadId = await this.#ensureHostThread()
    try {
      return await call(threadId)
    } catch (error) {
      if (!isStaleSession(error)) throw error
      await this.#retire(threadId)
      return call(await this.#ensureHostThread())
    }
  }

  #ensureHostThread(): Promise<string> {
    const pending =
      this.#hostThread ??
      (async () => {
        await mkdir(this.#cwd, { recursive: true })
        const response = (await this.#agents.callCodex(
          "thread/start",
          {
            cwd: this.#cwd,
            ephemeral: true,
            permissions: ":read-only",
            threadSource: MCP_EXTENSION_HOST_THREAD_SOURCE,
          },
          { timeoutMs: READ_TIMEOUT_MS }
        )) as unknown as v2.ThreadStartResponse
        const threadId = response.thread.id
        await this.#agents.hideCodexThread(threadId, {
          request: (method, params) => this.#reverse(method, params),
        })
        return threadId
      })()
    this.#hostThread = pending
    pending.catch(() => {
      if (this.#hostThread === pending) this.#hostThread = undefined
    })
    return pending
  }

  async #retire(threadId: string): Promise<void> {
    if ((await this.#hostThread?.catch(() => undefined)) === threadId) this.#hostThread = undefined
    await this.#agents.unhideCodexThread(threadId)
    void this.#agents.callCodex("thread/unsubscribe", { threadId }).catch(() => undefined)
  }

  /** Answers what Codex asks of the hidden Thread. Only MCP elicitation reaches a person. */
  async #reverse(method: string, params: unknown): Promise<unknown> {
    if (method !== "mcpServer/elicitation/request") {
      throw new Error(`The extension host does not handle ${method}`)
    }
    const request = params as v2.McpServerElicitationRequestParams
    if (request.mode === "openai/userVerification") {
      return { _meta: null, action: "decline", content: null }
    }
    const result = await this.#elicit(
      request.mode === "url"
        ? {
            message: request.message,
            mode: "url",
            openai: false,
            requestedSchema: null,
            server: request.serverName,
            url: request.url,
          }
        : {
            message: request.message,
            mode: "form",
            openai: request.mode !== "form",
            requestedSchema: record(request.requestedSchema) ?? null,
            server: request.serverName,
            url: null,
          }
    )
    return { _meta: null, action: result.action, content: result.content ?? null }
  }
}
