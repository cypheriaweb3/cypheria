import { mkdir } from "node:fs/promises"
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk"
import {
  type AgentClaudeClientMessage,
  type AgentClaudeClientRequest,
  type AgentClaudeServerMessage,
  AgentClaudeServerMessageSchema,
  getAgentClaudeRpcDefinition,
  wrapClaudeSdkMessage,
} from "@cypheria/protocol"

import type { AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

class InputStream implements AsyncIterable<SDKUserMessage> {
  readonly #values: SDKUserMessage[] = []
  readonly #waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = []
  #done = false

  push(value: SDKUserMessage): void {
    if (this.#done) throw new Error("Claude input stream is complete")
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.#values.push(value)
  }

  complete(): void {
    if (this.#done) return
    this.#done = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage, void> {
    while (true) {
      const value = this.#values.shift()
      if (value) yield value
      else if (this.#done) return
      else {
        const next = await new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
          this.#waiters.push(resolve)
        )
        if (next.done) return
        yield next.value
      }
    }
  }
}

type QueryState = { input?: InputStream; query: Query }

export type ClaudePermissionRequest = {
  readonly blockedPath?: string
  readonly decisionReason?: string
  readonly description?: string
  readonly displayName?: string
  readonly input: Record<string, unknown>
  readonly requestId: string
  readonly signal: AbortSignal
  readonly suggestions?: PermissionUpdate[]
  readonly suppressAlwaysAllowRule?: boolean
  readonly title?: string
  readonly toolName: string
  readonly toolUseID: string
}

export type ClaudePermissionHandler = (
  request: ClaudePermissionRequest
) => Promise<PermissionResult | null>

const errorPayload = (error: unknown) => ({
  code: error instanceof Error && error.name ? error.name : "CLAUDE_SDK_ERROR",
  message: error instanceof Error ? error.message : String(error),
})

export class ClaudeSessionRuntime {
  readonly #home: string
  readonly #queries = new Map<string, QueryState>()
  readonly #receipt: AgentInstallReceipt
  readonly #requestPermission: ClaudePermissionHandler | undefined
  readonly #send: (message: AgentClaudeServerMessage) => void
  readonly #toolchains: ToolchainManager

  constructor(options: {
    home: string
    receipt: AgentInstallReceipt
    requestPermission?: ClaudePermissionHandler
    send: (message: AgentClaudeServerMessage) => void
    toolchains: ToolchainManager
  }) {
    this.#home = options.home
    this.#receipt = options.receipt
    this.#requestPermission = options.requestPermission
    this.#send = options.send
    this.#toolchains = options.toolchains
  }

  get running(): boolean {
    return this.#queries.size > 0
  }

  async start(): Promise<void> {
    await mkdir(this.#home, { recursive: true })
  }

  async discover(): Promise<{
    account: Awaited<ReturnType<Query["accountInfo"]>>
    models: Awaited<ReturnType<Query["supportedModels"]>>
  }> {
    await this.start()
    const executable = this.#receipt.args[0] ?? this.#receipt.command
    if (!executable) throw new Error("Managed Claude CLI entry point is unavailable")
    const query = ClaudeSdk.query({
      options: {
        env: {
          ...this.#toolchains.environment(),
          CLAUDE_CONFIG_DIR: this.#home,
        },
        pathToClaudeCodeExecutable: executable,
      },
      prompt: "",
    })
    try {
      const [account, models] = await Promise.all([query.accountInfo(), query.supportedModels()])
      return { account, models }
    } finally {
      query.close()
    }
  }

  async send(message: AgentClaudeClientMessage): Promise<void> {
    await this.start()
    if (message.type === "agent.claude.query.input.notification") {
      const state = this.#queries.get(message.queryId)
      if (!state?.input) throw new Error(`Claude query ${message.queryId} has no input stream`)
      state.input.push(message.payload)
      return
    }
    if (message.type === "agent.claude.query.input.complete.notification") {
      const state = this.#queries.get(message.queryId)
      if (!state?.input) throw new Error(`Claude query ${message.queryId} has no input stream`)
      state.input.complete()
      return
    }
    await this.#request(message)
  }

  async stop(): Promise<void> {
    for (const state of this.#queries.values()) {
      state.input?.complete()
      state.query.close()
    }
    this.#queries.clear()
  }

  async #request(message: AgentClaudeClientRequest): Promise<void> {
    const definition = getAgentClaudeRpcDefinition(message)
    const {
      requestId,
      type: _type,
      ...params
    } = message as AgentClaudeClientRequest & Record<string, unknown>
    try {
      let result: unknown
      if (definition.method === "query") {
        result = await this.#startQuery(params)
      } else if (definition.scope === "sdk") {
        result = await this.#callSdk(definition.method, params)
      } else {
        const queryId = params.queryId as string
        const state = this.#queries.get(queryId)
        if (!state) throw new Error(`Claude query ${queryId} was not found`)
        result = await this.#callQuery(state.query, definition.method, params)
        if (definition.method === "close") {
          state.input?.complete()
          this.#queries.delete(queryId)
        }
      }
      this.#send(
        definition.responseSchema.parse({
          payload: { requestId, ...(result === undefined ? {} : { result }) },
          type: definition.response,
        })
      )
    } catch (error) {
      this.#send(
        AgentClaudeServerMessageSchema.parse({
          payload: { error: errorPayload(error), requestId },
          type: definition.response,
        })
      )
    }
  }

  async #startQuery(params: Record<string, unknown>): Promise<{ queryId: string }> {
    const queryId = params.queryId as string
    if (this.#queries.has(queryId)) throw new Error(`Claude query ${queryId} already exists`)
    const prompt = params.prompt as { text?: string; type: "stream" | "text" }
    const input = prompt.type === "stream" ? new InputStream() : undefined
    const executable = this.#receipt.args[0] ?? this.#receipt.command
    if (!executable) throw new Error("Managed Claude CLI entry point is unavailable")
    const suppliedOptions = (params.options ?? {}) as Record<string, unknown>
    const canUseTool: CanUseTool | undefined = this.#requestPermission
      ? (toolName, toolInput, options) =>
          this.#requestPermission?.({
            ...options,
            input: toolInput,
            toolName,
          }) ?? Promise.resolve(null)
      : undefined
    const query = ClaudeSdk.query({
      options: {
        ...suppliedOptions,
        ...(canUseTool ? { canUseTool } : {}),
        env: {
          ...this.#toolchains.environment(),
          CLAUDE_CONFIG_DIR: this.#home,
          ...((suppliedOptions.env ?? {}) as Record<string, string>),
        },
        pathToClaudeCodeExecutable: executable,
      },
      prompt: input ?? prompt.text ?? "",
    })
    this.#queries.set(queryId, { input, query })
    void this.#pump(queryId, query)
    return { queryId }
  }

  async #pump(queryId: string, query: Query): Promise<void> {
    try {
      for await (const message of query) this.#send(wrapClaudeSdkMessage(queryId, message))
      this.#send({ queryId, type: "agent.claude.query.complete.notification" })
    } catch (error) {
      this.#send({
        payload: errorPayload(error),
        queryId,
        type: "agent.claude.query.error.notification",
      })
    } finally {
      this.#queries.delete(queryId)
    }
  }

  #callSdk(method: string, params: Record<string, unknown>): Promise<unknown> {
    const sdk = ClaudeSdk as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    const fn = sdk[method]
    if (!fn) throw new Error(`Unsupported Claude SDK method: ${method}`)
    const options = params.options
    switch (method) {
      case "listSessions":
      case "resolveSettings":
        return fn(options)
      case "getSessionInfo":
      case "getSessionMessages":
      case "listSubagents":
      case "deleteSession":
      case "forkSession":
        return fn(params.sessionId, options)
      case "getSubagentMessages":
        return fn(params.sessionId, params.agentId, options)
      case "renameSession":
        return fn(params.sessionId, params.title, options)
      case "tagSession":
        return fn(params.sessionId, params.tag, options)
      default:
        throw new Error(`Unsupported Claude SDK method: ${method}`)
    }
  }

  #callQuery(query: Query, method: string, params: Record<string, unknown>): Promise<unknown> {
    const fn = (query as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
    if (!fn) throw new Error(`Unsupported Claude Query method: ${method}`)
    const args: unknown[] = (() => {
      switch (method) {
        case "setPermissionMode":
          return [params.mode]
        case "setMcpPermissionModeOverride":
          return [params.serverName, params.mode]
        case "setModel":
          return [params.model ?? undefined]
        case "setMaxThinkingTokens":
          return [params.maxThinkingTokens, params.thinkingDisplay]
        case "applyFlagSettings":
          return [params.settings]
        case "updateSettings":
          return [params.source, params.settings]
        case "getContextUsage":
        case "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET":
        case "reloadPlugins":
          return [params.options]
        case "readFile":
          return [params.path, params.options]
        case "rewindFiles":
          return [params.userMessageId, params.options]
        case "seedReadState":
          return [params.path, params.mtime]
        case "reconnectMcpServer":
          return [params.serverName]
        case "toggleMcpServer":
          return [params.serverName, params.enabled]
        case "setMcpServers":
          return [params.servers]
        case "stopTask":
          return [params.taskId]
        case "backgroundTasks":
          return [params.toolUseId]
        default:
          return []
      }
    })()
    return Promise.resolve(fn.apply(query, args))
  }
}
