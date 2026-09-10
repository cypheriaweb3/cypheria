import { randomUUID } from "node:crypto"

import {
  type ClientDescriptor,
  type ClientMessage,
  CYPHERIA_PROTOCOL_VERSION,
  parseClientMessage,
  type ServerDiagnostics,
  type ServerErrorCode,
  type ServerIdentity,
  type ServerInfo,
  type ServerMessage,
} from "@cypheria/protocol"
import { ZodError } from "zod"

export type SessionTransport = {
  close(code: number, reason: string): void
  send(data: string): void
}

export type SessionHost = {
  getDiagnostics(): ServerDiagnostics
  getIdentity(): ServerIdentity
  getInfo(): ServerInfo
  requestLifecycle(action: "restart" | "shutdown", reason?: string): void
  requestRuntime(method: string, params?: unknown): Promise<unknown>
}

export type ClientSessionOptions = {
  helloTimeoutMs: number
  host: SessionHost
  onClose?: (session: ClientSession) => void
  transport: SessionTransport
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown server error"

export class ClientSession {
  readonly id = `ses_${randomUUID()}`

  #client: ClientDescriptor | undefined
  #closed = false
  #helloTimer: NodeJS.Timeout
  #host: SessionHost
  #inFlight = new Set<string>()
  #onClose: ((session: ClientSession) => void) | undefined
  #ready = false
  #transport: SessionTransport

  constructor(options: ClientSessionOptions) {
    this.#host = options.host
    this.#onClose = options.onClose
    this.#transport = options.transport
    this.#helloTimer = setTimeout(() => {
      this.#sendError("NOT_READY", "session.hello was not received in time")
      this.close(1008, "Session hello timeout")
    }, options.helloTimeoutMs)
    this.#helloTimer.unref()
  }

  get client(): ClientDescriptor | undefined {
    return this.#client
  }

  get ready(): boolean {
    return this.#ready
  }

  send(message: ServerMessage): void {
    if (!this.#closed) this.#transport.send(JSON.stringify(message))
  }

  async receive(raw: string): Promise<void> {
    if (this.#closed) return

    let message: ClientMessage
    try {
      message = parseClientMessage(JSON.parse(raw))
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : errorMessage(error)
      this.#sendError("INVALID_MESSAGE", detail || "Invalid message")
      return
    }

    if (!this.#ready) {
      this.#acceptHello(message)
      return
    }

    if (message.type === "session.hello") {
      this.#sendError("INVALID_MESSAGE", "session.hello may only be sent once", message.requestId)
      return
    }

    if (this.#inFlight.has(message.requestId)) {
      this.#sendError("INVALID_MESSAGE", "Request id is already in flight", message.requestId)
      return
    }

    this.#inFlight.add(message.requestId)
    try {
      await this.#handleReadyMessage(message)
    } finally {
      this.#inFlight.delete(message.requestId)
    }
  }

  close(code = 1000, reason = "Session closed"): void {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#helloTimer)
    this.#transport.close(code, reason)
    this.#onClose?.(this)
  }

  transportClosed(): void {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#helloTimer)
    this.#onClose?.(this)
  }

  #acceptHello(message: ClientMessage): void {
    if (message.type !== "session.hello") {
      this.#sendError("NOT_READY", "The first message must be session.hello", message.requestId)
      this.close(1008, "Session hello required")
      return
    }

    if (message.payload.protocolVersion !== CYPHERIA_PROTOCOL_VERSION) {
      this.#sendError(
        "PROTOCOL_MISMATCH",
        `Expected protocol version ${CYPHERIA_PROTOCOL_VERSION}`,
        message.requestId
      )
      this.close(1002, "Protocol version mismatch")
      return
    }

    this.#client = message.payload.client
    this.#ready = true
    clearTimeout(this.#helloTimer)
    this.send({
      payload: {
        capabilities: ["diagnostics", "runtime.request", "runtime.events", "server.lifecycle"],
        server: this.#host.getIdentity(),
        sessionId: this.id,
      },
      requestId: message.requestId,
      type: "session.ready",
    })
  }

  async #handleReadyMessage(message: Exclude<ClientMessage, { type: "session.hello" }>) {
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
    this.send({
      payload: { code, message },
      requestId,
      type: "server.error",
    })
  }
}
