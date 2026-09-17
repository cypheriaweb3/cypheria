import { randomUUID } from "node:crypto"

import {
  type ClientCapabilities,
  type ClientDescriptor,
  type ClientMessage,
  type PersistedServerConfigPatch,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerMessage,
  type ServerStatus,
  stringifyProtocolMessage,
  type WSHelloMessage,
  wrapServerSessionMessage,
} from "@cypheria/protocol"

export type SessionTransport = {
  close(code: number, reason: string): void
  send(data: string): void
}

export type SessionHost = {
  closeAgentSession?(sessionId: string): void
  getConfig(): ServerConfigSnapshot
  getDiagnostics(): ServerDiagnostics
  getStatus(): ServerStatus
  patchConfig(patch: PersistedServerConfigPatch): Promise<ServerConfigSnapshot>
  reloadConfig(): Promise<ServerConfigSnapshot>
  handleAgentMessage?(
    message: ClientMessage,
    sessionId: string,
    source: SessionTransport,
    send: (message: ServerMessage) => void
  ): Promise<boolean>
}

export type ClientSessionOptions = {
  hello: WSHelloMessage
  host: SessionHost
  onClose?: (session: ClientSession) => void
  onDetach?: (session: ClientSession) => void
  principalId: string
  reconnectGraceMs: number
}

type SessionSource = {
  capabilities: ClientCapabilities
  inFlight: Set<string>
}

const correlatedRequestId = (message: object): string | undefined => {
  if ("requestId" in message && typeof message.requestId === "string") return message.requestId
  if (!("payload" in message) || typeof message.payload !== "object" || message.payload === null) {
    return undefined
  }
  return "requestId" in message.payload && typeof message.payload.requestId === "string"
    ? message.payload.requestId
    : undefined
}

const descriptorFromHello = (hello: WSHelloMessage): ClientDescriptor => ({
  id: hello.clientId,
  kind: hello.clientType,
  ...(hello.appVersion ? { version: hello.appVersion } : {}),
})

export class ClientSession {
  readonly id = `ses_${randomUUID()}`
  readonly principalId: string
  readonly reconnectGraceMs: number

  #client: ClientDescriptor
  #closed = false
  #host: SessionHost
  #onClose: ((session: ClientSession) => void) | undefined
  #onDetach: ((session: ClientSession) => void) | undefined
  readonly #sources = new Map<SessionTransport, SessionSource>()

  constructor(options: ClientSessionOptions) {
    this.#client = descriptorFromHello(options.hello)
    this.#host = options.host
    this.#onClose = options.onClose
    this.#onDetach = options.onDetach
    this.principalId = options.principalId
    this.reconnectGraceMs = options.reconnectGraceMs
  }

  get attached(): boolean {
    return this.#sources.size > 0
  }

  get client(): ClientDescriptor {
    return this.#client
  }

  get transportCount(): number {
    return this.#sources.size
  }

  attach(transport: SessionTransport, hello: WSHelloMessage): void {
    if (this.#closed) throw new Error("Cannot attach a closed client session")
    this.#client = descriptorFromHello(hello)
    this.#sources.set(transport, {
      capabilities: hello.capabilities ?? {},
      inFlight: new Set(),
    })
    this.sendTo(transport, {
      payload: this.#host.getStatus(),
      type: "server.status.notification",
    })
  }

  supports(capability: string, source?: SessionTransport): boolean {
    if (source) return this.#sources.get(source)?.capabilities[capability] === true
    for (const state of this.#sources.values()) {
      if (state.capabilities[capability] === true) return true
    }
    return false
  }

  send(message: ServerMessage): void {
    for (const transport of this.#sources.keys()) this.sendTo(transport, message)
  }

  sendTo(transport: SessionTransport, message: ServerMessage): void {
    if (!this.#closed && this.#sources.has(transport)) {
      transport.send(stringifyProtocolMessage(wrapServerSessionMessage(message)))
    }
  }

  async receive(message: ClientMessage, source: SessionTransport): Promise<void> {
    if (this.#closed) return
    const sourceState = this.#sources.get(source)
    if (!sourceState) return
    const messageRequestId = correlatedRequestId(message)
    if (messageRequestId && sourceState.inFlight.has(messageRequestId)) {
      source.close(1008, "Request id is already in flight")
      return
    }
    if (messageRequestId) sourceState.inFlight.add(messageRequestId)
    try {
      await this.#handleMessage(message, source)
    } catch (error) {
      source.close(1011, error instanceof Error ? error.message.slice(0, 123) : "Request failed")
    } finally {
      if (messageRequestId) sourceState.inFlight.delete(messageRequestId)
    }
  }

  close(code = 1000, reason = "Session closed"): void {
    if (this.#closed) return
    this.#closed = true
    const transports = [...this.#sources.keys()]
    this.#sources.clear()
    for (const transport of transports) transport.close(code, reason)
    this.#host.closeAgentSession?.(this.id)
    this.#onClose?.(this)
  }

  transportClosed(transport: SessionTransport): void {
    if (this.#closed || !this.#sources.delete(transport)) return
    if (this.#sources.size === 0) this.#onDetach?.(this)
  }

  async #handleMessage(message: ClientMessage, source: SessionTransport): Promise<void> {
    switch (message.type) {
      case "server.status.request":
        this.sendTo(source, {
          payload: this.#host.getStatus(),
          requestId: message.requestId,
          type: "server.status.response",
        })
        break
      case "server.diagnostics.request":
        this.sendTo(source, {
          payload: this.#host.getDiagnostics(),
          requestId: message.requestId,
          type: "server.diagnostics.response",
        })
        break
      case "server.config.get.request":
        this.sendTo(source, {
          payload: this.#host.getConfig(),
          requestId: message.requestId,
          type: "server.config.get.response",
        })
        break
      case "server.config.patch.request":
        this.sendTo(source, {
          payload: await this.#host.patchConfig(message.payload.patch),
          requestId: message.requestId,
          type: "server.config.patch.response",
        })
        break
      case "server.config.reload.request":
        this.sendTo(source, {
          payload: await this.#host.reloadConfig(),
          requestId: message.requestId,
          type: "server.config.reload.response",
        })
        break
      default:
        if (
          !this.#host.handleAgentMessage ||
          !(await this.#host.handleAgentMessage(message, this.id, source, (response) =>
            this.sendTo(source, response)
          ))
        ) {
          source.close(1003, `Message type is not handled by the server: ${message.type}`)
        }
        break
    }
  }
}
