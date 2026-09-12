import { randomUUID } from "node:crypto"

import {
  type ClientDescriptor,
  type ClientMessage,
  type PersistedServerConfigPatch,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerErrorCode,
  type ServerIdentity,
  type ServerInfo,
  type ServerMessage,
  type ServerOperationalState,
  stringifyProtocolMessage,
} from "@cypheria/protocol"

export type SessionTransport = {
  close(code: number, reason: string): void
  send(data: string): void
}

export type SessionHost = {
  getConfig(): ServerConfigSnapshot
  getDiagnostics(): ServerDiagnostics
  getIdentity(): ServerIdentity
  getInfo(): ServerInfo
  getSessionCapabilities(): string[]
  getState(): ServerOperationalState
  patchConfig(patch: PersistedServerConfigPatch): Promise<ServerConfigSnapshot>
  reloadConfig(): Promise<ServerConfigSnapshot>
  requestLifecycle(action: "restart" | "shutdown", reason?: string): void
  requestRuntime(method: string, params?: unknown): Promise<unknown>
}

export type ClientSessionOptions = {
  client: ClientDescriptor
  host: SessionHost
  onClose?: (session: ClientSession) => void
  onDetach?: (session: ClientSession) => void
  reconnectGraceMs: number
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown server error"

const correlatedRequestId = (message: object): string | undefined => {
  if ("requestId" in message && typeof message.requestId === "string") return message.requestId
  if (!("payload" in message) || typeof message.payload !== "object" || message.payload === null) {
    return undefined
  }
  return "requestId" in message.payload && typeof message.payload.requestId === "string"
    ? message.payload.requestId
    : undefined
}

export class ClientSession {
  readonly client: ClientDescriptor
  readonly id = `ses_${randomUUID()}`
  readonly reconnectGraceMs: number

  #closed = false
  #host: SessionHost
  #inFlight = new Set<string>()
  #onClose: ((session: ClientSession) => void) | undefined
  #onDetach: ((session: ClientSession) => void) | undefined
  #transport: SessionTransport | undefined

  constructor(options: ClientSessionOptions) {
    this.client = options.client
    this.#host = options.host
    this.#onClose = options.onClose
    this.#onDetach = options.onDetach
    this.reconnectGraceMs = options.reconnectGraceMs
  }

  get attached(): boolean {
    return this.#transport !== undefined
  }

  attach(transport: SessionTransport, requestId: string, resumed: boolean): void {
    if (this.#closed) throw new Error("Cannot attach a closed client session")
    const previous = this.#transport
    this.#transport = transport
    if (previous && previous !== transport) previous.close(1012, "Session resumed elsewhere")
    this.send({
      payload: {
        capabilities: this.#host.getSessionCapabilities(),
        reconnectGraceMs: this.reconnectGraceMs,
        resumed,
        server: this.#host.getIdentity(),
        sessionId: this.id,
      },
      requestId,
      type: "session.ready",
    })
  }

  send(message: ServerMessage): void {
    if (!this.#closed && this.#transport) {
      this.#transport.send(stringifyProtocolMessage(message))
    }
  }

  async receive(message: Exclude<ClientMessage, { type: "session.hello" }>): Promise<void> {
    if (this.#closed || !this.#transport) return
    const messageRequestId = correlatedRequestId(message)
    if (messageRequestId && this.#inFlight.has(messageRequestId)) {
      this.#sendError("INVALID_MESSAGE", "Request id is already in flight", messageRequestId)
      return
    }
    if (messageRequestId) this.#inFlight.add(messageRequestId)
    try {
      await this.#handleMessage(message)
    } finally {
      if (messageRequestId) this.#inFlight.delete(messageRequestId)
    }
  }

  close(code = 1000, reason = "Session closed"): void {
    if (this.#closed) return
    this.#closed = true
    const transport = this.#transport
    this.#transport = undefined
    transport?.close(code, reason)
    this.#onClose?.(this)
  }

  transportClosed(transport: SessionTransport): void {
    if (this.#closed || this.#transport !== transport) return
    this.#transport = undefined
    this.#onDetach?.(this)
  }

  async #handleMessage(message: Exclude<ClientMessage, { type: "session.hello" }>): Promise<void> {
    switch (message.type) {
      case "server.ping": {
        const receivedAt = new Date().toISOString()
        this.send({
          payload: {
            clientSentAt: message.payload.sentAt,
            serverReceivedAt: receivedAt,
            serverSentAt: new Date().toISOString(),
          },
          requestId: message.requestId,
          type: "server.pong",
        })
        break
      }
      case "server.info":
        this.send({
          payload: this.#host.getInfo(),
          requestId: message.requestId,
          type: "server.info.result",
        })
        break
      case "server.diagnostics":
        this.send({
          payload: this.#host.getDiagnostics(),
          requestId: message.requestId,
          type: "server.diagnostics.result",
        })
        break
      case "server.config.get":
        this.send({
          payload: this.#host.getConfig(),
          requestId: message.requestId,
          type: "server.config.result",
        })
        break
      case "server.config.patch":
        await this.#handleConfigChange(message.requestId, () =>
          this.#host.patchConfig(message.payload.patch)
        )
        break
      case "server.config.reload":
        await this.#handleConfigChange(message.requestId, () => this.#host.reloadConfig())
        break
      case "server.state":
        this.send({
          payload: this.#host.getState(),
          requestId: message.requestId,
          type: "server.state.result",
        })
        break
      case "runtime.request":
        await this.#handleRuntimeRequest(message)
        break
      case "server.restart":
      case "server.shutdown": {
        const action = message.type === "server.restart" ? "restart" : "shutdown"
        this.send({
          payload: { action },
          requestId: message.requestId,
          type: "server.lifecycle.accepted",
        })
        queueMicrotask(() => this.#host.requestLifecycle(action, message.payload.reason))
        break
      }
      case "session.goodbye":
        this.close(1000, "Client disconnected")
        break
      default:
        this.#sendError(
          "REQUEST_NOT_SUPPORTED",
          `Message type is not handled by the server: ${message.type}`,
          correlatedRequestId(message)
        )
        break
    }
  }

  async #handleConfigChange(
    requestId: string,
    change: () => Promise<ServerConfigSnapshot>
  ): Promise<void> {
    try {
      this.send({ payload: await change(), requestId, type: "server.config.result" })
    } catch (error) {
      this.#sendError("HANDLER_FAILED", errorMessage(error), requestId)
    }
  }

  async #handleRuntimeRequest(
    message: Extract<ClientMessage, { type: "runtime.request" }>
  ): Promise<void> {
    try {
      const result = await this.#host.requestRuntime(message.payload.method, message.payload.params)
      this.send({
        payload: { result: result ?? null },
        requestId: message.requestId,
        type: "runtime.response",
      })
    } catch (error) {
      this.#sendError("HANDLER_FAILED", errorMessage(error), message.requestId)
    }
  }

  #sendError(code: ServerErrorCode, message: string, requestId?: string): void {
    this.send({ payload: { code, message }, requestId, type: "server.error" })
  }
}
