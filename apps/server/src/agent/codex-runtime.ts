import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { createInterface } from "node:readline"
import {
  AGENT_CODEX_CLIENT_NOTIFICATION_TYPE_TO_METHOD,
  AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_RESPONSE_TYPE_TO_METHOD,
  AGENT_CODEX_SERVER_RPC,
  type AgentCodexClientNotification,
  type AgentCodexClientRequest,
  type AgentCodexClientResponse,
  AgentCodexClientResponseSchema,
  type AgentCodexServerNotification,
  AgentCodexServerNotificationSchema,
  type AgentCodexServerRequest,
  AgentCodexServerRequestSchema,
  type AgentCodexServerResponse,
  type RequestId,
} from "@cypheria/protocol"
import type { Logger } from "pino"

import type { AgentInstallReceipt } from "./agent-installer.js"
import { monitorAgentProcess } from "./agent-process-log.js"
import type { ToolchainManager } from "./toolchain-manager.js"

type CodexServerMessage =
  | AgentCodexClientResponse
  | AgentCodexServerNotification
  | AgentCodexServerRequest
type Send = (message: CodexServerMessage) => void
type RawRpc = {
  error?: unknown
  id?: RequestId
  jsonrpc: "2.0"
  method?: string
  params?: unknown
  result?: unknown
}
type ClientPending = {
  kind: "client"
  requestId: RequestId
  responseType: string
  send: Send
  sessionId: string
}
type InternalPending = {
  kind: "internal"
  reject: (error: Error) => void
  resolve: (value: Record<string, unknown>) => void
  timeout: NodeJS.Timeout
}
type Pending = ClientPending | InternalPending
type ReversePending = { rawId: RequestId; sessionId: string }

/** `threadSource` of the hidden Threads that carry extension MCP calls. */
export const MCP_EXTENSION_HOST_THREAD_SOURCE = "mcp_extension_host"

/**
 * The MCP extensions Cypheria declares to Codex, which advertises them to MCP servers: MCP Apps,
 * so servers send App metadata, and OpenAI's extended forms.
 */
export const CODEX_CLIENT_MCP_EXTENSIONS = {
  "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
  "openai/elicitation": { form: {} },
} as const

/** Receives what Codex sends for a hidden Thread: its reverse requests, such as elicitation. */
export type HiddenThreadHandler = {
  request(method: string, params: unknown): Promise<unknown>
}

const isHiddenThreadStart = (params: unknown): boolean => {
  const thread = (params as { thread?: { threadSource?: unknown } } | undefined)?.thread
  return thread?.threadSource === MCP_EXTENSION_HOST_THREAD_SOURCE
}

const paramsOf = (message: { type: string } & Record<string, unknown>): unknown => {
  const { requestId: _requestId, type: _type, ...params } = message
  return Object.keys(params).length === 0 ? undefined : params
}

const threadIdOf = (value: unknown, depth = 0): string | undefined => {
  if (!value || typeof value !== "object" || depth > 4) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const threadId = threadIdOf(item, depth + 1)
      if (threadId) return threadId
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  const direct = record.threadId ?? record.thread_id
  if (typeof direct === "string") return direct
  if (record.thread && typeof record.thread === "object") {
    const nestedId = (record.thread as Record<string, unknown>).id
    if (typeof nestedId === "string") return nestedId
  }
  for (const nested of Object.values(record)) {
    const threadId = threadIdOf(nested, depth + 1)
    if (threadId) return threadId
  }
  return undefined
}

export class CodexRuntime {
  readonly #codexHome: string
  readonly #pending = new Map<number, Pending>()
  readonly #receipt: AgentInstallReceipt
  readonly #reversePending = new Map<string, ReversePending>()
  readonly #sessions = new Map<string, Send>()
  readonly #loginResults = new Map<string, { error: string | null; success: boolean }>()
  readonly #loginWaiters = new Map<
    string,
    Array<{
      reject: (error: Error) => void
      resolve: (result: { error: string | null; success: boolean }) => void
    }>
  >()
  readonly #threadOwners = new Map<string, string>()
  readonly #hiddenThreads = new Map<string, HiddenThreadHandler>()
  readonly #toolchains: ToolchainManager
  readonly #logger: Logger | undefined
  #activeSession: string | undefined
  #process: ChildProcessWithoutNullStreams | undefined
  #sequence = 0
  #startPromise: Promise<void> | undefined

  constructor(options: {
    codexHome: string
    receipt: AgentInstallReceipt
    toolchains: ToolchainManager
    logger?: Logger
  }) {
    this.#codexHome = options.codexHome
    this.#receipt = options.receipt
    this.#toolchains = options.toolchains
    this.#logger = options.logger
  }

  get running(): boolean {
    return Boolean(this.#process)
  }

  async start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise
    if (this.#process) return
    const startPromise = this.#start()
    this.#startPromise = startPromise
    try {
      await startPromise
    } finally {
      if (this.#startPromise === startPromise) this.#startPromise = undefined
    }
  }

  async #start(): Promise<void> {
    await mkdir(this.#codexHome, { recursive: true })
    const child = spawn(this.#receipt.command, [...this.#receipt.args, "app-server"], {
      env: { ...this.#toolchains.environment(), CODEX_HOME: this.#codexHome },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#process = child
    monitorAgentProcess(child, this.#logger)
    const lines = createInterface({ input: child.stdout })
    lines.on("line", (line) => {
      try {
        this.#receive(JSON.parse(line) as RawRpc)
      } catch {
        // Codex diagnostics belong on stderr. Invalid stdout cannot cross the wire.
      }
    })
    child.once("exit", () => {
      if (this.#process === child) this.#process = undefined
      for (const pending of this.#pending.values()) {
        if (pending.kind === "internal") {
          clearTimeout(pending.timeout)
          pending.reject(new Error("Codex App Server exited before responding"))
        }
      }
      this.#pending.clear()
      this.#reversePending.clear()
      for (const waiters of this.#loginWaiters.values()) {
        for (const waiter of waiters) {
          waiter.reject(new Error("Codex App Server exited before authentication completed"))
        }
      }
      this.#loginWaiters.clear()
      lines.close()
    })
    try {
      await this.#requestStarted("initialize", {
        capabilities: {
          experimentalApi: true,
          extensions: CODEX_CLIENT_MCP_EXTENSIONS,
          requestAttestation: false,
        },
        clientInfo: { name: "cypheria", title: "Cypheria", version: "1" },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`)
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async send(
    sessionId: string,
    send: Send,
    message: AgentCodexClientRequest | AgentCodexServerResponse | AgentCodexClientNotification
  ): Promise<void> {
    await this.start()
    const child = this.#process
    if (!child) throw new Error("Codex App Server is not running")
    this.#sessions.set(sessionId, send)
    this.#activeSession = sessionId

    const requestMethod =
      AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD[
        message.type as keyof typeof AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD
      ]
    if (requestMethod) {
      const internalId = ++this.#sequence
      const definition = AGENT_CODEX_CLIENT_RPC[requestMethod]
      const params = paramsOf(message as never)
      const threadId = threadIdOf(params)
      if (threadId) this.#threadOwners.set(threadId, sessionId)
      this.#pending.set(internalId, {
        kind: "client",
        requestId: (message as AgentCodexClientRequest).requestId,
        responseType: definition.response,
        send,
        sessionId,
      })
      child.stdin.write(
        `${JSON.stringify({ id: internalId, jsonrpc: "2.0", method: requestMethod, params })}\n`
      )
      return
    }

    const responseMethod =
      AGENT_CODEX_SERVER_RESPONSE_TYPE_TO_METHOD[
        message.type as keyof typeof AGENT_CODEX_SERVER_RESPONSE_TYPE_TO_METHOD
      ]
    if (responseMethod) {
      const payload = (message as AgentCodexServerResponse).payload as {
        requestId: RequestId
      } & Record<string, unknown>
      const key = `${sessionId}:${typeof payload.requestId}:${String(payload.requestId)}`
      const pending = this.#reversePending.get(key)
      if (!pending) throw new Error(`Unknown Codex reverse request: ${String(payload.requestId)}`)
      this.#reversePending.delete(key)
      const { requestId: _requestId, ...result } = payload
      child.stdin.write(`${JSON.stringify({ id: pending.rawId, jsonrpc: "2.0", result })}\n`)
      return
    }

    const notificationMethod =
      AGENT_CODEX_CLIENT_NOTIFICATION_TYPE_TO_METHOD[
        message.type as keyof typeof AGENT_CODEX_CLIENT_NOTIFICATION_TYPE_TO_METHOD
      ]
    if (!notificationMethod) throw new Error(`Unsupported Codex client message: ${message.type}`)
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: notificationMethod, params: "payload" in message ? message.payload : undefined })}\n`
    )
  }

  async request(
    method: keyof typeof AGENT_CODEX_CLIENT_RPC,
    params?: Record<string, unknown>,
    options: { timeoutMs?: number } = {}
  ): Promise<Record<string, unknown>> {
    await this.start()
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#requestStarted(method, params, options.timeoutMs)
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
        if (!/(?:overload|temporar(?:y|ily)|server busy|try again|rate.?limit)/iu.test(message)) {
          throw error
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 3 ** attempt))
        }
      }
    }
    throw lastError
  }

  rejectReverse(sessionId: string, requestId: RequestId, message: string): void {
    const key = `${sessionId}:${typeof requestId}:${String(requestId)}`
    const pending = this.#reversePending.get(key)
    if (!pending) throw new Error(`Unknown Codex reverse request: ${String(requestId)}`)
    this.#reversePending.delete(key)
    this.#process?.stdin.write(
      `${JSON.stringify({ error: { code: -32601, message }, id: pending.rawId, jsonrpc: "2.0" })}\n`
    )
  }

  waitForLogin(
    loginId: string,
    signal: AbortSignal
  ): Promise<{ error: string | null; success: boolean }> {
    const existing = this.#loginResults.get(loginId)
    if (existing) {
      this.#loginResults.delete(loginId)
      return Promise.resolve(existing)
    }
    return new Promise((resolve, reject) => {
      const waiters = this.#loginWaiters.get(loginId) ?? []
      const finish = (result: { error: string | null; success: boolean }) => {
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      }
      const fail = (error: Error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
      const waiter = { reject: fail, resolve: finish }
      const onAbort = () => {
        const current = this.#loginWaiters.get(loginId)
        if (current)
          this.#loginWaiters.set(
            loginId,
            current.filter((candidate) => candidate !== waiter)
          )
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("Authentication cancelled")
        )
      }
      signal.addEventListener("abort", onAbort, { once: true })
      waiters.push(waiter)
      this.#loginWaiters.set(loginId, waiters)
    })
  }

  /**
   * Hides a Thread from every session: its notifications are dropped and its reverse requests go
   * to `handler`. Hidden Threads carry extension MCP calls that belong to no conversation.
   */
  hideThread(threadId: string, handler: HiddenThreadHandler): void {
    this.#hiddenThreads.set(threadId, handler)
  }

  unhideThread(threadId: string): void {
    this.#hiddenThreads.delete(threadId)
  }

  #requestStarted(
    method: keyof typeof AGENT_CODEX_CLIENT_RPC,
    params?: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<Record<string, unknown>> {
    const child = this.#process
    if (!child) throw new Error("Codex App Server is not running")
    const internalId = ++this.#sequence
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(internalId)) return
        const error = new Error(`Codex ${method} request timed out`)
        error.name = "AGENT_TIMEOUT"
        this.#logger?.warn({ method }, "Codex App Server request timed out")
        reject(error)
      }, timeoutMs).unref()
      this.#pending.set(internalId, { kind: "internal", reject, resolve, timeout })
      child.stdin.write(`${JSON.stringify({ id: internalId, jsonrpc: "2.0", method, params })}\n`)
    })
  }

  detachSession(sessionId: string): void {
    this.#sessions.delete(sessionId)
    for (const [threadId, owner] of this.#threadOwners) {
      if (owner === sessionId) this.#threadOwners.delete(threadId)
    }
    if (this.#activeSession === sessionId) this.#activeSession = this.#sessions.keys().next().value
  }

  async stop(): Promise<void> {
    const child = this.#process
    this.#process = undefined
    for (const pending of this.#pending.values()) {
      if (pending.kind === "internal") {
        clearTimeout(pending.timeout)
        pending.reject(new Error("Codex App Server stopped before responding"))
      }
    }
    this.#pending.clear()
    this.#reversePending.clear()
    this.#threadOwners.clear()
    this.#hiddenThreads.clear()
    for (const waiters of this.#loginWaiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(new Error("Codex App Server stopped before authentication completed"))
      }
    }
    this.#loginWaiters.clear()
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL")
        resolve()
      }, 5_000).unref()
      child.once("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
      child.kill("SIGTERM")
    })
  }

  #answerHidden(
    handler: HiddenThreadHandler,
    id: RequestId,
    method: string,
    params: unknown
  ): void {
    handler.request(method, params).then(
      (result) => {
        this.#process?.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", result })}\n`)
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.#process?.stdin.write(
          `${JSON.stringify({ error: { code: -32603, message }, id, jsonrpc: "2.0" })}\n`
        )
      }
    )
  }

  #receive(raw: RawRpc): void {
    if (raw.method) {
      const notificationDefinition =
        AGENT_CODEX_SERVER_NOTIFICATIONS[
          raw.method as keyof typeof AGENT_CODEX_SERVER_NOTIFICATIONS
        ]
      if (notificationDefinition) {
        const message = AgentCodexServerNotificationSchema.parse({
          ...(raw.params === undefined ? {} : { payload: raw.params }),
          type: notificationDefinition.notification,
        })
        if (message.type === "agent.codex.account.login.completed.notification") {
          const payload = message.payload
          if (payload.loginId) {
            const result = { error: payload.error, success: payload.success }
            const waiters = this.#loginWaiters.get(payload.loginId) ?? []
            if (waiters.length > 0) {
              for (const waiter of waiters) waiter.resolve(result)
              this.#loginWaiters.delete(payload.loginId)
            } else {
              this.#loginResults.set(payload.loginId, result)
            }
          }
        }
        const owner = threadIdOf(raw.params)
        if ((owner && this.#hiddenThreads.has(owner)) || isHiddenThreadStart(raw.params)) return
        const ownedSend = owner
          ? this.#sessions.get(this.#threadOwners.get(owner) ?? "")
          : undefined
        if (ownedSend) ownedSend(message)
        else for (const send of this.#sessions.values()) send(message)
        return
      }
      const requestDefinition =
        AGENT_CODEX_SERVER_RPC[raw.method as keyof typeof AGENT_CODEX_SERVER_RPC]
      const threadId = threadIdOf(raw.params)
      const hidden = threadId ? this.#hiddenThreads.get(threadId) : undefined
      if (hidden && raw.id !== undefined) {
        this.#answerHidden(hidden, raw.id, raw.method, raw.params)
        return
      }
      const sessionId = (threadId && this.#threadOwners.get(threadId)) || this.#activeSession
      const send = sessionId ? this.#sessions.get(sessionId) : undefined
      if (!requestDefinition || !send || raw.id === undefined) {
        if (raw.id !== undefined) {
          this.#process?.stdin.write(
            `${JSON.stringify({ error: { code: -32601, message: `Unsupported Codex request: ${raw.method}` }, id: raw.id, jsonrpc: "2.0" })}\n`
          )
        }
        return
      }
      const clientRequestId = `codex_reverse_${++this.#sequence}`
      this.#reversePending.set(`${sessionId}:string:${clientRequestId}`, {
        rawId: raw.id,
        sessionId: sessionId as string,
      })
      const message = AgentCodexServerRequestSchema.parse({
        ...(raw.params as object),
        requestId: clientRequestId,
        type: requestDefinition.request,
      })
      send(message)
      return
    }
    if (typeof raw.id !== "number") return
    const pending = this.#pending.get(raw.id)
    if (!pending) return
    this.#pending.delete(raw.id)
    if (raw.error !== undefined) {
      if (pending.kind === "internal") {
        clearTimeout(pending.timeout)
        const error = new Error(
          typeof raw.error === "object" && raw.error && "message" in raw.error
            ? String((raw.error as { message: unknown }).message)
            : `Codex request failed: ${JSON.stringify(raw.error)}`
        )
        error.name =
          typeof raw.error === "object" && raw.error && "code" in raw.error
            ? String((raw.error as { code: unknown }).code)
            : "CODEX_REQUEST_FAILED"
        pending.reject(error)
      }
      return
    }
    if (pending.kind === "internal") {
      clearTimeout(pending.timeout)
      pending.resolve((raw.result ?? {}) as Record<string, unknown>)
      return
    }
    const threadId = threadIdOf(raw.result)
    if (threadId) this.#threadOwners.set(threadId, pending.sessionId)
    pending.send(
      AgentCodexClientResponseSchema.parse({
        payload: { requestId: pending.requestId, ...((raw.result ?? {}) as object) },
        type: pending.responseType,
      })
    )
  }
}
