import type {
  AgentClaudeServerMessage,
  ClaudeForkSessionOptions,
  ClaudeGetSessionInfoOptions,
  ClaudeGetSessionMessagesOptions,
  ClaudeGetSubagentMessagesOptions,
  ClaudeListSessionsOptions,
  ClaudeListSubagentsOptions,
  ClaudeMcpServerConfig,
  ClaudeQueryOptions,
  ClaudeResolveSettingsOptions,
  ClaudeSessionMutationOptions,
} from "@cypheria/protocol"
import type {
  AccountInfo,
  AgentInfo,
  ForkSessionResult,
  McpServerStatus,
  McpSetServersResult,
  ModelInfo,
  PermissionMode,
  ResolvedSettings,
  RewindFilesResult,
  SDKControlGetContextUsageResponse,
  SDKControlGetUsageResponse,
  SDKControlInitializeResponse,
  SDKControlInterruptResponse,
  SDKControlReadFileResponse,
  SDKControlReloadOutputStylesResponse,
  SDKControlReloadPluginsResponse,
  SDKControlReloadSkillsResponse,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  Query as SdkQuery,
  SessionMessage,
  SlashCommand,
} from "@cypheria/protocol/claude-types"

import { type ClaudeEndpoint, observeClaudeEndpoint } from "./claude-endpoint.js"
import type { CypheriaApi } from "./index.js"

export type * from "@cypheria/protocol/claude-types"

export type ClaudeClientOptions = ClaudeQueryOptions & {
  /** Local cancellation only; the AbortController itself is never serialized. */
  readonly abortController?: AbortController
}

export interface ClaudeQuery extends Omit<SdkQuery, "setMcpServers"> {
  setMcpServers(servers: Record<string, ClaudeMcpServerConfig>): Promise<McpSetServersResult>
}

type PendingNext = {
  readonly reject: (error: unknown) => void
  readonly resolve: (result: IteratorResult<SDKMessage, void>) => void
}

let idSequence = 0
const createQueryId = (): string => {
  idSequence = (idSequence + 1) % Number.MAX_SAFE_INTEGER
  return `claude_query_${Date.now().toString(36)}_${idSequence.toString(36)}`
}

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

const wireOptions = <Options extends ClaudeQueryOptions>(
  options: (Options & { readonly abortController?: AbortController }) | undefined
): Options | undefined => {
  if (!options) return undefined
  const { abortController: _abortController, ...serializable } = options
  return serializable as Options
}

class RemoteClaudeQuery implements ClaudeQuery {
  readonly #endpoint: ClaudeEndpoint
  readonly #messages: SDKMessage[] = []
  readonly #pending: PendingNext[] = []
  readonly #queryId: string
  readonly #started: Promise<void>

  #closed = false
  #error: Error | undefined
  #removeAbort: (() => void) | undefined
  #removeConnectionObserver: (() => void) | undefined
  #unsubscribe: (() => void) | undefined

  constructor(
    endpoint: ClaudeEndpoint,
    start: {
      readonly options?: ClaudeClientOptions
      readonly prompt: string | AsyncIterable<SDKUserMessage>
    }
  ) {
    this.#endpoint = endpoint
    this.#queryId = createQueryId()
    this.#unsubscribe = endpoint.subscribe((message) => this.#receive(message))
    this.#removeConnectionObserver = observeClaudeEndpoint(endpoint, (error) => this.#fail(error))
    this.#started = this.#start(start)
    void this.#started.catch((error) => this.#fail(error))
    if (typeof start.prompt !== "string") {
      void this.#started
        .then(() => this.#sendInput(start.prompt as AsyncIterable<SDKUserMessage>))
        .catch((error) => this.#fail(error))
    }

    const abortController = start.options?.abortController
    if (abortController) {
      const onAbort = () => this.close(abortController.signal.reason)
      abortController.signal.addEventListener("abort", onAbort, { once: true })
      this.#removeAbort = () => abortController.signal.removeEventListener("abort", onAbort)
      if (abortController.signal.aborted) onAbort()
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
    return this
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close()
  }

  next(): Promise<IteratorResult<SDKMessage, void>> {
    if (this.#messages.length > 0) {
      return Promise.resolve({ done: false, value: this.#messages.shift() as SDKMessage })
    }
    if (this.#error) return Promise.reject(this.#error)
    if (this.#closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => this.#pending.push({ reject, resolve }))
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    this.close()
    return { done: true, value: undefined }
  }

  async throw(error?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    const failure = asError(error, "Claude query iterator failed")
    this.close(failure)
    throw failure
  }

  async interrupt(): Promise<SDKControlInterruptResponse | undefined> {
    return (
      (await this.#call<SDKControlInterruptResponse | null>("interrupt", {
        queryId: this.#queryId,
      })) ?? undefined
    )
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.#call("setPermissionMode", { mode, queryId: this.#queryId })
  }

  setMcpPermissionModeOverride(
    serverName: string,
    mode: "default" | "auto" | null
  ): Promise<{ warning?: string }> {
    return this.#call("setMcpPermissionModeOverride", {
      mode,
      queryId: this.#queryId,
      serverName,
    })
  }

  async setModel(model?: string): Promise<void> {
    await this.#call("setModel", { model: model ?? null, queryId: this.#queryId })
  }

  async setMaxThinkingTokens(
    maxThinkingTokens: number | null,
    thinkingDisplay?: "summarized" | "omitted" | null
  ): Promise<void> {
    await this.#call("setMaxThinkingTokens", {
      maxThinkingTokens,
      queryId: this.#queryId,
      ...(thinkingDisplay === undefined ? {} : { thinkingDisplay }),
    })
  }

  async applyFlagSettings(settings: Parameters<SdkQuery["applyFlagSettings"]>[0]): Promise<void> {
    await this.#call("applyFlagSettings", { queryId: this.#queryId, settings })
  }

  async updateSettings(source: "localSettings", settings: Record<string, unknown>): Promise<void> {
    await this.#call("updateSettings", { queryId: this.#queryId, settings, source })
  }

  initializationResult(): Promise<SDKControlInitializeResponse> {
    return this.#call("initializationResult", { queryId: this.#queryId })
  }

  reinitialize(): Promise<SDKControlInitializeResponse> {
    return this.#call("reinitialize", { queryId: this.#queryId })
  }

  supportedCommands(): Promise<SlashCommand[]> {
    return this.#call("supportedCommands", { queryId: this.#queryId })
  }

  supportedModels(): Promise<ModelInfo[]> {
    return this.#call("supportedModels", { queryId: this.#queryId })
  }

  supportedAgents(): Promise<AgentInfo[]> {
    return this.#call("supportedAgents", { queryId: this.#queryId })
  }

  mcpServerStatus(): Promise<McpServerStatus[]> {
    return this.#call("mcpServerStatus", { queryId: this.#queryId })
  }

  getContextUsage(options?: {
    detail?: "summary" | "full"
  }): Promise<SDKControlGetContextUsageResponse> {
    return this.#call("getContextUsage", {
      ...(options === undefined ? {} : { options }),
      queryId: this.#queryId,
    })
  }

  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options?: {
    skipBehaviors?: boolean
  }): Promise<SDKControlGetUsageResponse> {
    return this.#call("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET", {
      ...(options === undefined ? {} : { options }),
      queryId: this.#queryId,
    })
  }

  readFile(
    path: string,
    options?: { maxBytes?: number; encoding?: "utf-8" | "base64" }
  ): Promise<SDKControlReadFileResponse | null> {
    return this.#call("readFile", {
      ...(options === undefined ? {} : { options }),
      path,
      queryId: this.#queryId,
    })
  }

  reloadPlugins(options?: {
    holdOnCacheImpact?: boolean
  }): Promise<SDKControlReloadPluginsResponse> {
    return this.#call("reloadPlugins", {
      ...(options === undefined ? {} : { options }),
      queryId: this.#queryId,
    })
  }

  reloadSkills(): Promise<SDKControlReloadSkillsResponse> {
    return this.#call("reloadSkills", { queryId: this.#queryId })
  }

  reloadOutputStyles(): Promise<SDKControlReloadOutputStylesResponse> {
    return this.#call("reloadOutputStyles", { queryId: this.#queryId })
  }

  accountInfo(): Promise<AccountInfo> {
    return this.#call("accountInfo", { queryId: this.#queryId })
  }

  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return this.#call("rewindFiles", {
      ...(options === undefined ? {} : { options }),
      queryId: this.#queryId,
      userMessageId,
    })
  }

  async seedReadState(path: string, mtime: number): Promise<void> {
    await this.#call("seedReadState", { mtime, path, queryId: this.#queryId })
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    await this.#call("reconnectMcpServer", { queryId: this.#queryId, serverName })
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    await this.#call("toggleMcpServer", { enabled, queryId: this.#queryId, serverName })
  }

  setMcpServers(servers: Record<string, ClaudeMcpServerConfig>): Promise<McpSetServersResult> {
    return this.#call("setMcpServers", { queryId: this.#queryId, servers })
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    await this.#started
    this.#assertOpen()
    for await (const message of stream) {
      this.#assertOpen()
      await this.#endpoint.sendInput(this.#queryId, message)
    }
    this.#assertOpen()
    await this.#endpoint.completeInput(this.#queryId)
  }

  async stopTask(taskId: string): Promise<void> {
    await this.#call("stopTask", { queryId: this.#queryId, taskId })
  }

  backgroundTasks(toolUseId?: string): Promise<boolean> {
    return this.#call("backgroundTasks", {
      queryId: this.#queryId,
      ...(toolUseId === undefined ? {} : { toolUseId }),
    })
  }

  close(reason?: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#cleanup()
    const error = reason === undefined ? undefined : asError(reason, "Claude query closed")
    this.#error = error
    for (const pending of this.#pending.splice(0)) {
      if (error) pending.reject(error)
      else pending.resolve({ done: true, value: undefined })
    }
    void this.#started
      .then(() => this.#endpoint.request("close", { queryId: this.#queryId }))
      .catch(() => undefined)
  }

  async #start(start: {
    readonly options?: ClaudeClientOptions
    readonly prompt: string | AsyncIterable<SDKUserMessage>
  }): Promise<void> {
    const prompt =
      typeof start.prompt === "string"
        ? { text: start.prompt, type: "text" as const }
        : { type: "stream" as const }
    const options = wireOptions(start.options)
    const started = await this.#endpoint.request("query", {
      ...(options === undefined ? {} : { options }),
      prompt,
      queryId: this.#queryId,
    })
    if (started.queryId !== this.#queryId) {
      throw new Error(`Claude server returned query id '${started.queryId}' for '${this.#queryId}'`)
    }
  }

  async #sendInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of stream) {
      this.#assertOpen()
      await this.#endpoint.sendInput(this.#queryId, message)
    }
    this.#assertOpen()
    await this.#endpoint.completeInput(this.#queryId)
  }

  async #call<Result>(
    method: Exclude<Parameters<ClaudeEndpoint["request"]>[0], "query">,
    params: unknown
  ): Promise<Result> {
    await this.#started
    this.#assertOpen()
    return this.#endpoint.request(method, params as never) as Promise<Result>
  }

  #assertOpen(): void {
    if (this.#error) throw this.#error
    if (this.#closed) throw new Error("Claude query is closed")
  }

  #receive(message: AgentClaudeServerMessage): void {
    if (!("queryId" in message) || message.queryId !== this.#queryId || this.#closed) return
    if (message.type === "agent.claude.query.complete.notification") {
      this.#finish()
      return
    }
    if (message.type === "agent.claude.query.error.notification") {
      const error = new Error(message.payload.message)
      error.name = message.payload.code
      if (message.payload.data !== undefined) Object.assign(error, { data: message.payload.data })
      this.#fail(error)
      return
    }
    const pending = this.#pending.shift()
    if (pending) pending.resolve({ done: false, value: message.payload })
    else this.#messages.push(message.payload)
  }

  #finish(): void {
    if (this.#closed) return
    this.#closed = true
    this.#cleanup()
    for (const pending of this.#pending.splice(0)) {
      pending.resolve({ done: true, value: undefined })
    }
  }

  #fail(value: unknown): void {
    if (this.#closed) return
    this.#error = asError(value, "Claude query failed")
    this.#closed = true
    this.#cleanup()
    for (const pending of this.#pending.splice(0)) pending.reject(this.#error)
  }

  #cleanup(): void {
    this.#removeAbort?.()
    this.#removeAbort = undefined
    this.#removeConnectionObserver?.()
    this.#removeConnectionObserver = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
  }
}

/** Claude Agent SDK-shaped facade over a borrowed Cypheria connection. */
export class ClaudeAgentSdkClient {
  constructor(private readonly endpoint: ClaudeEndpoint) {}

  query(params: {
    prompt: string | AsyncIterable<SDKUserMessage>
    options?: ClaudeClientOptions
  }): ClaudeQuery {
    return new RemoteClaudeQuery(this.endpoint, params)
  }

  listSessions(options?: ClaudeListSessionsOptions): Promise<SDKSessionInfo[]> {
    return this.endpoint.request("listSessions", options === undefined ? {} : { options })
  }

  async getSessionInfo(
    sessionId: string,
    options?: ClaudeGetSessionInfoOptions
  ): Promise<SDKSessionInfo | undefined> {
    return (
      (await this.endpoint.request("getSessionInfo", {
        ...(options === undefined ? {} : { options }),
        sessionId,
      })) ?? undefined
    )
  }

  getSessionMessages(
    sessionId: string,
    options?: ClaudeGetSessionMessagesOptions
  ): Promise<SessionMessage[]> {
    return this.endpoint.request("getSessionMessages", {
      ...(options === undefined ? {} : { options }),
      sessionId,
    })
  }

  listSubagents(sessionId: string, options?: ClaudeListSubagentsOptions): Promise<string[]> {
    return this.endpoint.request("listSubagents", {
      ...(options === undefined ? {} : { options }),
      sessionId,
    })
  }

  getSubagentMessages(
    sessionId: string,
    agentId: string,
    options?: ClaudeGetSubagentMessagesOptions
  ): Promise<SessionMessage[]> {
    return this.endpoint.request("getSubagentMessages", {
      agentId,
      ...(options === undefined ? {} : { options }),
      sessionId,
    })
  }

  async renameSession(
    sessionId: string,
    title: string,
    options?: ClaudeSessionMutationOptions
  ): Promise<void> {
    await this.endpoint.request("renameSession", {
      ...(options === undefined ? {} : { options }),
      sessionId,
      title,
    })
  }

  async tagSession(
    sessionId: string,
    tag: string | null,
    options?: ClaudeSessionMutationOptions
  ): Promise<void> {
    await this.endpoint.request("tagSession", {
      ...(options === undefined ? {} : { options }),
      sessionId,
      tag,
    })
  }

  async deleteSession(sessionId: string, options?: ClaudeSessionMutationOptions): Promise<void> {
    await this.endpoint.request("deleteSession", {
      ...(options === undefined ? {} : { options }),
      sessionId,
    })
  }

  forkSession(sessionId: string, options?: ClaudeForkSessionOptions): Promise<ForkSessionResult> {
    return this.endpoint.request("forkSession", {
      ...(options === undefined ? {} : { options }),
      sessionId,
    })
  }

  resolveSettings(options?: ClaudeResolveSettingsOptions): Promise<ResolvedSettings> {
    return this.endpoint.request("resolveSettings", options === undefined ? {} : { options })
  }
}

/** Binds the Claude Agent SDK-shaped API to a borrowed Cypheria API. */
export function client(cypheria: CypheriaApi): ClaudeAgentSdkClient {
  return new ClaudeAgentSdkClient(cypheria.agent.claude)
}

export const createClaudeAgentSdkClient = client
