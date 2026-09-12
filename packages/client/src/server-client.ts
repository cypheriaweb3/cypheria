import {
  type AcpClientWirePayload,
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_RPC,
  type AgentCodexClientNotificationMessage,
  type AgentCodexClientRequestMessage,
  type AgentCodexServerNotificationMessage,
  type AgentCodexServerRequestMessage,
  type AgentCodexServerResponseMessage,
  type ClientDescriptor,
  ClientDescriptorSchema,
  type ClientKind,
  type ClientMessage,
  type ConnectionOfferV2,
  ConnectionOfferV2Schema,
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PATH,
  createWebSocketProtocols,
  parseClientMessage,
  parseConnectionOffer,
  parseServerMessageText,
  type RequestId,
  type ServerDiagnostics,
  type ServerErrorCode,
  type ServerInfo,
  type ServerMessage,
  stringifyProtocolMessage,
} from "@cypheria/protocol"
import {
  type CodexActions,
  type CodexClientMethod,
  type CodexClientNotificationMethod,
  type CodexServerMethod,
  createCodexActions,
} from "./codex-actions.js"
import { createRelayServerTransportFactory } from "./relay-server-transport.js"
import type {
  ServerTransport,
  ServerTransportFactory,
  WebSocketFactory,
} from "./server-client-transport-types.js"
import { describeClose, describeError } from "./server-client-transport-utils.js"
import { createWebSocketTransportFactory } from "./server-client-websocket-transport.js"

export type ConnectionState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly sessionId: string; readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

export type ServerSession = Readonly<Extract<ServerMessage, { type: "session.ready" }>["payload"]>

export type ReconnectConfig = {
  readonly baseDelayMs?: number
  readonly enabled?: boolean
  readonly maxDelayMs?: number
}

export type ServerClientConfig = {
  readonly capabilities?: readonly string[]
  readonly clientId?: string
  readonly clientKind?: ClientKind
  readonly clientName?: string
  readonly clientVersion?: string
  readonly connectTimeoutMs?: number
  readonly onListenerError?: (error: Error, message: ServerMessage) => void
  readonly reconnect?: ReconnectConfig
  readonly relayOffer?: ConnectionOfferV2 | string
  readonly requestTimeoutMs?: number
  readonly token?: string
  readonly transportFactory?: ServerTransportFactory
  readonly url?: string
  readonly webSocketFactory?: WebSocketFactory
}

export type RequestOptions = {
  readonly timeoutMs?: number
}

type PendingRequest = {
  readonly expectedType: string
  readonly reject: (error: Error) => void
  readonly resolve: (message: ServerMessage) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

type ConnectCallbacks = {
  readonly reject: (error: Error) => void
  readonly resolve: () => void
}

type ServerMessageHandler = (message: ServerMessage) => void
type ConnectionHandler = (state: ConnectionState) => void

export class CypheriaServerError extends Error {
  readonly code: ServerErrorCode
  readonly requestId?: RequestId

  constructor(code: ServerErrorCode, message: string, requestId?: RequestId) {
    super(message)
    this.name = "CypheriaServerError"
    this.code = code
    this.requestId = requestId
  }
}

export class CypheriaConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CypheriaConnectionError"
  }
}

export class CypheriaProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CypheriaProtocolError"
  }
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:6768"
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

const assertDuration = (name: string, value: number | undefined, allowZero = false): void => {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || !Number.isInteger(value) || (allowZero ? value < 0 : value <= 0))
  ) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`)
  }
}

const createClientId = (): string => {
  const id =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `cypheria-client-${id}`
}

export const resolveWebSocketUrl = (input = DEFAULT_SERVER_URL): string => {
  const url = new URL(input)
  if (url.protocol === "http:") url.protocol = "ws:"
  else if (url.protocol === "https:") url.protocol = "wss:"
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Cypheria server URL must use http, https, ws, or wss")
  }
  if (url.pathname === "/" || url.pathname === "") url.pathname = CYPHERIA_WEBSOCKET_PATH
  return url.toString()
}

const messageRequestId = (message: ServerMessage): RequestId | undefined => {
  if ("requestId" in message && typeof message.requestId === "string") return message.requestId
  if (!("payload" in message) || typeof message.payload !== "object" || !message.payload) {
    return undefined
  }
  return "requestId" in message.payload && typeof message.payload.requestId === "string"
    ? message.payload.requestId
    : undefined
}

const decodeTextFrame = (data: unknown): string => {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  throw new CypheriaProtocolError("Cypheria server sent an unsupported WebSocket text frame")
}

/** Owns one versioned Cypheria server connection and executes only protocol-defined messages. */
export class ServerClient {
  readonly codex: CodexActions

  readonly #config: ServerClientConfig
  readonly #connectionHandlers = new Set<ConnectionHandler>()
  readonly #descriptor: ClientDescriptor
  readonly #messageHandlers = new Set<ServerMessageHandler>()
  readonly #pending = new Map<RequestId, PendingRequest>()
  readonly #typedHandlers = new Map<string, Set<ServerMessageHandler>>()
  readonly #transportFactory: ServerTransportFactory
  readonly #url: string

  #attempt = 0
  #connectCallbacks: ConnectCallbacks | undefined
  #connectPromise: Promise<void> | undefined
  #connectTimeout: ReturnType<typeof setTimeout> | undefined
  #helloRequestId: RequestId | undefined
  #lastError: Error | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #requestSequence = 0
  #session: ServerSession | undefined
  #shouldReconnect = false
  #state: ConnectionState = { status: "idle" }
  #transport: ServerTransport | undefined
  #transportCleanup: (() => void) | undefined

  constructor(config: ServerClientConfig = {}) {
    assertDuration("connectTimeoutMs", config.connectTimeoutMs)
    assertDuration("requestTimeoutMs", config.requestTimeoutMs)
    assertDuration("reconnect.baseDelayMs", config.reconnect?.baseDelayMs, true)
    assertDuration("reconnect.maxDelayMs", config.reconnect?.maxDelayMs, true)
    if (config.relayOffer && (config.url || config.token || config.transportFactory)) {
      throw new Error("relayOffer cannot be combined with url, token, or transportFactory")
    }
    this.#config = config
    const relayOffer =
      typeof config.relayOffer === "string"
        ? parseConnectionOffer(config.relayOffer)
        : config.relayOffer
          ? ConnectionOfferV2Schema.parse(config.relayOffer)
          : undefined
    this.#url = relayOffer ? "cypheria-relay://offer" : resolveWebSocketUrl(config.url)
    this.#descriptor = ClientDescriptorSchema.parse({
      id: config.clientId ?? createClientId(),
      kind: config.clientKind ?? "sdk",
      ...(config.clientName ? { name: config.clientName } : {}),
      ...(config.clientVersion ? { version: config.clientVersion } : {}),
    })
    const webSocketTransportFactory = createWebSocketTransportFactory(config.webSocketFactory)
    this.#transportFactory = relayOffer
      ? createRelayServerTransportFactory(relayOffer, webSocketTransportFactory)
      : (config.transportFactory ?? webSocketTransportFactory)
    parseClientMessage(this.#createHelloMessage("req:hello:config"))
    this.codex = createCodexActions({
      notify: (method, params) => this.#notifyCodex(method, params),
      request: (method, params) => this.#requestCodex(method, params),
      respond: (method, requestId, response) => this.#respondToCodex(method, requestId, response),
    })
  }

  getConnectionState(): ConnectionState {
    return this.#state
  }

  getLastError(): Error | undefined {
    return this.#lastError
  }

  getSession(): ServerSession | undefined {
    return this.#session
  }

  subscribeConnectionStatus(handler: ConnectionHandler): () => void {
    this.#connectionHandlers.add(handler)
    this.#callConnectionHandler(handler, this.#state)
    return () => this.#connectionHandlers.delete(handler)
  }

  subscribe(handler: ServerMessageHandler): () => void {
    this.#messageHandlers.add(handler)
    return () => this.#messageHandlers.delete(handler)
  }

  on<T extends ServerMessage["type"]>(
    type: T,
    handler: (message: Extract<ServerMessage, { type: T }>) => void
  ): () => void
  on(handler: ServerMessageHandler): () => void
  on(
    typeOrHandler: ServerMessage["type"] | ServerMessageHandler,
    handler?: ServerMessageHandler
  ): () => void {
    if (typeof typeOrHandler === "function") return this.subscribe(typeOrHandler)
    if (!handler) throw new Error("A Cypheria message handler is required")

    const handlers = this.#typedHandlers.get(typeOrHandler) ?? new Set<ServerMessageHandler>()
    const wrapped = handler
    handlers.add(wrapped)
    this.#typedHandlers.set(typeOrHandler, handlers)
    return () => {
      handlers.delete(wrapped)
      if (handlers.size === 0) this.#typedHandlers.delete(typeOrHandler)
    }
  }

  async connect(): Promise<void> {
    if (this.#state.status === "connected") return
    if (this.#state.status === "disposed") {
      throw new CypheriaConnectionError("Cypheria client is closed")
    }
    if (this.#connectPromise) return this.#connectPromise

    this.#shouldReconnect = true
    this.#clearReconnectTimer()
    this.#attempt += 1
    this.#setState({ attempt: this.#attempt, status: "connecting" })
    const promise = new Promise<void>((resolve, reject) => {
      this.#connectCallbacks = { reject, resolve }
    })
    this.#connectPromise = promise

    try {
      const transport = this.#transportFactory({
        protocols: this.#config.relayOffer ? [] : createWebSocketProtocols(this.#config.token),
        url: this.#url,
      })
      this.#bindTransport(transport)
    } catch (error) {
      this.#handleDisconnect(asError(error, "Failed to connect to Cypheria server"))
    }
    return promise
  }

  async ensureConnected(): Promise<void> {
    return this.connect()
  }

  async close(): Promise<void> {
    if (this.#state.status === "disposed") return
    this.#shouldReconnect = false
    this.#clearReconnectTimer()

    const transport = this.#transport
    if (this.#state.status === "connected" && transport) {
      try {
        this.#sendNow({
          requestId: this.#nextRequestId("goodbye"),
          type: "session.goodbye",
        })
      } catch {
        // Closing the transport is sufficient when goodbye cannot be sent.
      }
    }

    const error = new CypheriaConnectionError("Cypheria client closed")
    this.#clearConnectTimeout()
    this.#disposeTransport(1000, "Client closed")
    this.#rejectPending(error)
    this.#rejectConnect(error)
    this.#session = undefined
    this.#setState({ status: "disposed" })
  }

  async ping(
    sentAt = new Date().toISOString(),
    options?: RequestOptions
  ): Promise<Extract<ServerMessage, { type: "server.pong" }>["payload"]> {
    const message = await this.#request(
      {
        payload: { sentAt },
        requestId: this.#nextRequestId("ping"),
        type: "server.ping",
      },
      "server.pong",
      options
    )
    return (message as Extract<ServerMessage, { type: "server.pong" }>).payload
  }

  async getServerInfo(options?: RequestOptions): Promise<ServerInfo> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("info"), type: "server.info" },
      "server.info.result",
      options
    )
    return (message as Extract<ServerMessage, { type: "server.info.result" }>).payload
  }

  async getServerDiagnostics(options?: RequestOptions): Promise<ServerDiagnostics> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("diagnostics"), type: "server.diagnostics" },
      "server.diagnostics.result",
      options
    )
    return (message as Extract<ServerMessage, { type: "server.diagnostics.result" }>).payload
  }

  async requestRuntime<T = unknown>(
    method: Extract<ClientMessage, { type: "runtime.request" }>["payload"]["method"],
    params?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const message = await this.#request(
      {
        payload: { method, ...(params === undefined ? {} : { params }) },
        requestId: this.#nextRequestId("runtime"),
        type: "runtime.request",
      },
      "runtime.response",
      options
    )
    return (message as Extract<ServerMessage, { type: "runtime.response" }>).payload.result as T
  }

  async requestLifecycle(
    action: "restart" | "shutdown",
    reason?: string,
    options?: RequestOptions
  ): Promise<Extract<ServerMessage, { type: "server.lifecycle.accepted" }>["payload"]> {
    const message = await this.#request(
      {
        payload: reason === undefined ? {} : { reason },
        requestId: this.#nextRequestId(action),
        type: `server.${action}`,
      },
      "server.lifecycle.accepted",
      options
    )
    return (message as Extract<ServerMessage, { type: "server.lifecycle.accepted" }>).payload
  }

  async #requestCodex(method: CodexClientMethod, params?: unknown): Promise<unknown> {
    const definition = AGENT_CODEX_CLIENT_RPC[method]
    const message = await this.#request(
      {
        ...((params ?? {}) as object),
        requestId: this.#nextRequestId("codex"),
        type: definition.request,
      } as AgentCodexClientRequestMessage,
      definition.response
    )
    const { requestId: _requestId, ...result } = (
      message as Extract<ServerMessage, { payload: { requestId: RequestId } }>
    ).payload
    return result
  }

  async #notifyCodex(method: CodexClientNotificationMethod, params?: unknown): Promise<void> {
    await this.#sendWhenConnected({
      ...((params ?? {}) as object),
      type: AGENT_CODEX_CLIENT_NOTIFICATIONS[method].notification,
    } as AgentCodexClientNotificationMessage)
  }

  async #respondToCodex(
    method: CodexServerMethod,
    requestId: RequestId,
    response: unknown
  ): Promise<void> {
    await this.#sendWhenConnected({
      payload: { requestId, ...(response as object) },
      type: AGENT_CODEX_SERVER_RPC[method].response,
    } as AgentCodexServerResponseMessage)
  }

  async sendAcp(payload: AcpClientWirePayload): Promise<void> {
    await this.#sendWhenConnected({ payload, type: "agent.acp.client.message" })
  }

  #bindTransport(transport: ServerTransport): void {
    this.#disposeTransport()
    this.#transport = transport
    const removers: (() => void)[] = []
    const isCurrent = () => this.#transport === transport && this.#state.status !== "disposed"

    removers.push(
      transport.onOpen(() => {
        if (!isCurrent()) return
        const requestId = this.#nextRequestId("hello")
        this.#helloRequestId = requestId
        try {
          this.#sendNow(this.#createHelloMessage(requestId))
        } catch (error) {
          this.#handleDisconnect(asError(error, "Invalid Cypheria session hello"), 1002)
        }
      }),
      transport.onMessage((data, isBinary) => {
        if (!isCurrent()) return
        if (isBinary) {
          this.#handleDisconnect(
            new CypheriaProtocolError("Cypheria server sent an unsupported binary frame"),
            1003
          )
          return
        }
        try {
          this.#receive(decodeTextFrame(data))
        } catch (error) {
          this.#handleDisconnect(
            new CypheriaProtocolError("Invalid Cypheria server message", {
              cause: asError(error, "Invalid server message"),
            }),
            1002
          )
        }
      }),
      transport.onError((event) => {
        if (!isCurrent()) return
        this.#handleDisconnect(describeError(event), 1011)
      }),
      transport.onClose((event) => {
        if (!isCurrent()) return
        this.#handleDisconnect(new CypheriaConnectionError(describeClose(event)))
      })
    )
    this.#transportCleanup = () => {
      for (const remove of removers.splice(0)) remove()
    }

    this.#connectTimeout = setTimeout(() => {
      if (!isCurrent() || this.#state.status !== "connecting") return
      this.#handleDisconnect(
        new CypheriaConnectionError("Timed out connecting to Cypheria server"),
        1001
      )
    }, this.#config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)
  }

  #receive(raw: string): void {
    const message = parseServerMessageText(raw)
    const requestId = messageRequestId(message)

    if (message.type === "session.ready" && requestId === this.#helloRequestId) {
      this.#clearConnectTimeout()
      this.#helloRequestId = undefined
      this.#attempt = 0
      this.#lastError = undefined
      this.#session = message.payload
      this.#setState({ sessionId: message.payload.sessionId, status: "connected" })
      this.#resolveConnect()
    } else if (message.type === "server.error") {
      const error = new CypheriaServerError(
        message.payload.code,
        message.payload.message,
        message.requestId
      )
      if (message.requestId === this.#helloRequestId) {
        this.#handleDisconnect(error, 1002)
      } else if (message.requestId) {
        this.#settleError(message.requestId, error)
      }
    } else if (requestId) {
      this.#settleResponse(requestId, message)
    }

    this.#emit(message)
  }

  async #request(
    message: ClientMessage,
    expectedType: string,
    options?: RequestOptions
  ): Promise<ServerMessage> {
    const parsed = parseClientMessage(message)
    if (!("requestId" in parsed) || typeof parsed.requestId !== "string") {
      throw new CypheriaProtocolError("A correlated Cypheria request must have a request id")
    }
    const requestId = parsed.requestId
    return new Promise<ServerMessage>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.#pending.delete(requestId)
          reject(new CypheriaConnectionError(`Timed out waiting for ${expectedType}`))
        },
        options?.timeoutMs ?? this.#config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      )
      this.#pending.set(requestId, { expectedType, reject, resolve, timeout })
      void this.#sendWhenConnected(parsed).catch((error) => {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.#pending.delete(requestId)
        pending.reject(asError(error, "Failed to send Cypheria request"))
      })
    })
  }

  async #sendWhenConnected(message: ClientMessage): Promise<void> {
    const parsed = parseClientMessage(message)
    if (this.#state.status === "connected") {
      this.#sendNow(parsed)
      return
    }
    await this.ensureConnected()
    this.#sendNow(parsed)
  }

  #sendNow(message: ClientMessage): void {
    const transport = this.#transport
    if (!transport) throw new CypheriaConnectionError("Cypheria client is not connected")
    transport.send(stringifyProtocolMessage(parseClientMessage(message)))
  }

  #settleResponse(requestId: RequestId, message: ServerMessage): void {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.#pending.delete(requestId)
    if (message.type !== pending.expectedType) {
      pending.reject(
        new CypheriaProtocolError(
          `Expected ${pending.expectedType} for ${requestId}, received ${message.type}`
        )
      )
      return
    }
    pending.resolve(message)
  }

  #settleError(requestId: RequestId, error: Error): void {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.#pending.delete(requestId)
    pending.reject(error)
  }

  #emit(message: ServerMessage): void {
    for (const handler of this.#messageHandlers) this.#callMessageHandler(handler, message)
    for (const handler of this.#typedHandlers.get(message.type) ?? []) {
      this.#callMessageHandler(handler, message)
    }
  }

  #callMessageHandler(handler: ServerMessageHandler, message: ServerMessage): void {
    try {
      handler(message)
    } catch (error) {
      try {
        this.#config.onListenerError?.(asError(error, "Cypheria message listener failed"), message)
      } catch {
        // Error reporting hooks must not turn a listener failure into a protocol disconnect.
      }
    }
  }

  #callConnectionHandler(handler: ConnectionHandler, state: ConnectionState): void {
    try {
      handler(state)
    } catch {
      // Connection observers cannot break client state transitions.
    }
  }

  #setState(state: ConnectionState): void {
    this.#state = state
    for (const handler of this.#connectionHandlers) this.#callConnectionHandler(handler, state)
  }

  #handleDisconnect(error: Error, closeCode?: number): void {
    if (this.#state.status === "disposed") return
    this.#lastError = error
    this.#clearConnectTimeout()
    this.#helloRequestId = undefined
    this.#session = undefined
    this.#disposeTransport(closeCode, closeCode ? error.message.slice(0, 123) : undefined)
    this.#rejectPending(error)
    this.#rejectConnect(error)
    this.#setState({ reason: error.message, status: "disconnected" })
    this.#scheduleReconnect()
  }

  #scheduleReconnect(): void {
    if (
      !this.#shouldReconnect ||
      this.#config.reconnect?.enabled === false ||
      this.#state.status === "disposed" ||
      this.#reconnectTimer
    ) {
      return
    }
    const base = this.#config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
    const max = this.#config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS
    const delay = Math.min(max, base * 2 ** Math.max(0, this.#attempt - 1))
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      void this.connect().catch(() => undefined)
    }, delay)
  }

  #disposeTransport(code?: number, reason?: string): void {
    const transport = this.#transport
    this.#transport = undefined
    this.#transportCleanup?.()
    this.#transportCleanup = undefined
    if (transport && code !== undefined) {
      try {
        transport.close(code, reason)
      } catch {
        // The transport is already detached, so close failures are not actionable.
      }
    }
  }

  #resolveConnect(): void {
    this.#connectCallbacks?.resolve()
    this.#connectCallbacks = undefined
    this.#connectPromise = undefined
  }

  #rejectConnect(error: Error): void {
    this.#connectCallbacks?.reject(error)
    this.#connectCallbacks = undefined
    this.#connectPromise = undefined
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #clearConnectTimeout(): void {
    if (this.#connectTimeout) clearTimeout(this.#connectTimeout)
    this.#connectTimeout = undefined
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
  }

  #nextRequestId(scope: string): RequestId {
    this.#requestSequence += 1
    return `req:${scope}:${this.#requestSequence}`
  }

  #createHelloMessage(requestId: RequestId): Extract<ClientMessage, { type: "session.hello" }> {
    return {
      payload: {
        capabilities: [...(this.#config.capabilities ?? [])],
        client: this.#descriptor,
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
      },
      requestId,
      type: "session.hello",
    }
  }
}

export type {
  CodexActions,
  CodexClientMethod,
  CodexClientNotificationAction,
  CodexClientNotificationActions,
  CodexClientNotificationMethod,
  CodexClientNotificationParams,
  CodexRequestAction,
  CodexRequestActions,
  CodexRequestParams,
  CodexServerMethod,
  CodexServerResponseAction,
  CodexServerResponseActions,
} from "./codex-actions.js"
export type {
  ServerTransport,
  ServerTransportFactory,
  WebSocketFactory,
  WebSocketLike,
} from "./server-client-transport-types.js"
export {
  createWebSocketTransportFactory,
  WebSocketServerTransport,
} from "./server-client-websocket-transport.js"
export type { AgentCodexServerNotificationMessage, AgentCodexServerRequestMessage }
