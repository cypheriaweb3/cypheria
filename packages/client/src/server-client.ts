import {
  type AgentManagementClientMessage,
  type AgentManagementServerMessage,
  type ClientCapabilities,
  type ClientDescriptor,
  ClientDescriptorSchema,
  type ClientKind,
  type ClientMessage,
  type ConnectionOfferV2,
  ConnectionOfferV2Schema,
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PATH,
  createWebSocketProtocols,
  type IntegrationClientMessage,
  type IntegrationServerMessage,
  isClientResponseMessage,
  type PersistedServerConfigPatch,
  type ProjectThreadClientMessage,
  type ProjectThreadServerMessage,
  parseClientMessage,
  parseConnectionOffer,
  parseWSInboundMessage,
  parseWSOutboundMessageText,
  type RequestId,
  type ScheduleClientMessage,
  type ScheduleServerMessage,
  SERVER_CAPABILITIES,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerMessage,
  type ServerStatus,
  stringifyProtocolMessage,
  type ThreadClientMessage,
  type ThreadServerMessage,
  type Web3ClientMessage,
  type Web3ServerMessage,
  type WSInboundMessage,
  wrapClientSessionMessage,
} from "@cypheria/protocol"
import { assertRequestTimeout, type RequestOptions } from "./request-options.js"
import { createRelayServerTransportFactory } from "./server-client-relay-e2ee-transport.js"
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
  | { readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

export type ServerSession = Readonly<
  Extract<ServerMessage, { type: "server.status.notification" }>["payload"]
>

export type ReconnectConfig = {
  readonly baseDelayMs?: number
  readonly enabled?: boolean
  readonly maxDelayMs?: number
}

export type ServerClientConfig = {
  readonly appVersion?: string
  readonly capabilities?: ClientCapabilities
  readonly clientId?: string
  readonly clientType?: ClientKind
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

type PendingRequest = {
  readonly abortSend: (reason?: unknown) => void
  readonly cleanup: () => void
  readonly expectedType: string
  readonly reject: (error: Error) => void
  readonly resolve: (message: ServerMessage) => void
}

type PendingPing = {
  readonly cleanup: () => void
  readonly reject: (error: Error) => void
  readonly resolve: () => void
}

type ConnectCallbacks = {
  readonly reject: (error: Error) => void
  readonly resolve: () => void
}

type ServerMessageHandler = (message: ServerMessage) => void
type ConnectionHandler = (state: ConnectionState) => void

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

export class CypheriaTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CypheriaTimeoutError"
  }
}

export class CypheriaCapabilityError extends Error {
  readonly capability: string

  constructor(capability: string) {
    super(`Cypheria server does not advertise the '${capability}' capability`)
    this.name = "CypheriaCapabilityError"
    this.capability = capability
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
  readonly #config: ServerClientConfig
  readonly #connectionHandlers = new Set<ConnectionHandler>()
  readonly #descriptor: ClientDescriptor
  readonly #messageHandlers = new Set<ServerMessageHandler>()
  readonly #pending = new Map<RequestId, PendingRequest>()
  readonly #pendingPings = new Set<PendingPing>()
  readonly #typedHandlers = new Map<string, Set<ServerMessageHandler>>()
  readonly #transportFactory: ServerTransportFactory
  readonly #url: string

  #attempt = 0
  #connectCallbacks: ConnectCallbacks | undefined
  #connectPromise: Promise<void> | undefined
  #connectTimeout: ReturnType<typeof setTimeout> | undefined
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
      kind: config.clientType ?? "cli",
      ...(config.appVersion ? { version: config.appVersion } : {}),
    })
    const webSocketTransportFactory = createWebSocketTransportFactory(config.webSocketFactory)
    this.#transportFactory = relayOffer
      ? createRelayServerTransportFactory(relayOffer, webSocketTransportFactory)
      : (config.transportFactory ?? webSocketTransportFactory)
    parseWSInboundMessage(this.#createHelloMessage())
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

  supports(capability: string): boolean {
    return this.#session?.capabilities.includes(capability) ?? false
  }

  supportsFeature(feature: string): boolean {
    return this.#session?.features?.[feature] === true
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

    const error = new CypheriaConnectionError("Cypheria client closed")
    this.#clearConnectTimeout()
    this.#disposeTransport(1000, "Client closed")
    this.#rejectPending(error)
    this.#rejectPings(error)
    this.#rejectConnect(error)
    this.#session = undefined
    this.#setState({ status: "disposed" })
  }

  async ping(options?: RequestOptions): Promise<void> {
    assertRequestTimeout(options?.timeoutMs)
    if (this.#state.status !== "connected") await this.ensureConnected()
    return new Promise<void>((resolve, reject) => {
      let pending: PendingPing
      const cleanup = (): void => {
        clearTimeout(timeout)
        options?.signal?.removeEventListener("abort", onAbort)
        this.#pendingPings.delete(pending)
      }
      const onAbort = (): void => {
        cleanup()
        reject(asError(options?.signal?.reason, "Ping was aborted"))
      }
      const timeout = setTimeout(
        () => {
          cleanup()
          reject(new CypheriaTimeoutError("Timed out waiting for pong"))
        },
        options?.timeoutMs ?? this.#config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      )
      pending = { cleanup, reject, resolve }
      this.#pendingPings.add(pending)
      options?.signal?.addEventListener("abort", onAbort, { once: true })
      if (options?.signal?.aborted) {
        onAbort()
        return
      }
      void this.#sendEnvelopeValidated({ type: "ping" }).catch((error) => {
        cleanup()
        reject(asError(error, "Failed to send Cypheria ping"))
      })
    })
  }

  async getServerStatus(options?: RequestOptions): Promise<ServerStatus> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("status"), type: "server.status.request" },
      "server.status.response",
      options
    )
    return (message as Extract<ServerMessage, { type: "server.status.response" }>).payload
  }

  async getServerDiagnostics(options?: RequestOptions): Promise<ServerDiagnostics> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("diagnostics"), type: "server.diagnostics.request" },
      "server.diagnostics.response",
      options,
      SERVER_CAPABILITIES.diagnostics
    )
    return (message as Extract<ServerMessage, { type: "server.diagnostics.response" }>).payload
  }

  async getServerConfig(options?: RequestOptions): Promise<ServerConfigSnapshot> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("config"), type: "server.config.get.request" },
      "server.config.get.response",
      options,
      SERVER_CAPABILITIES.config
    )
    return (message as Extract<ServerMessage, { type: "server.config.get.response" }>).payload
  }

  async patchServerConfig(
    patch: PersistedServerConfigPatch,
    options?: RequestOptions
  ): Promise<ServerConfigSnapshot> {
    const message = await this.#request(
      {
        payload: { patch },
        requestId: this.#nextRequestId("config-patch"),
        type: "server.config.patch.request",
      },
      "server.config.patch.response",
      options,
      SERVER_CAPABILITIES.config
    )
    return (message as Extract<ServerMessage, { type: "server.config.patch.response" }>).payload
  }

  async reloadServerConfig(options?: RequestOptions): Promise<ServerConfigSnapshot> {
    const message = await this.#request(
      { requestId: this.#nextRequestId("config-reload"), type: "server.config.reload.request" },
      "server.config.reload.response",
      options,
      SERVER_CAPABILITIES.config
    )
    return (message as Extract<ServerMessage, { type: "server.config.reload.response" }>).payload
  }

  async requestAgentManagement(
    type: AgentManagementClientMessage["type"],
    payload?: unknown,
    options?: RequestOptions
  ): Promise<AgentManagementServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        ...(payload === undefined ? {} : { payload }),
        requestId: this.#nextRequestId("agent-manager"),
        type,
      } as AgentManagementClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.agentManager
    )
    return message as AgentManagementServerMessage
  }

  async requestProjectThread(
    type: ProjectThreadClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<ProjectThreadServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        payload,
        requestId: this.#nextRequestId("project-thread"),
        type,
      } as ProjectThreadClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.projectThread
    )
    return message as ProjectThreadServerMessage
  }

  async requestIntegration(
    type: IntegrationClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<IntegrationServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        payload,
        requestId: this.#nextRequestId("integration"),
        type,
      } as IntegrationClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.integrations
    )
    return message as IntegrationServerMessage
  }

  async requestSchedule(
    type: ScheduleClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<ScheduleServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        payload,
        requestId: this.#nextRequestId("schedule"),
        type,
      } as ScheduleClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.schedules
    )
    return message as ScheduleServerMessage
  }

  async requestThread(
    type: ThreadClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<ThreadServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        payload,
        requestId: this.#nextRequestId("thread"),
        type,
      } as ThreadClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.projectThread
    )
    return message as ThreadServerMessage
  }

  async requestWeb3(
    type: Web3ClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<Web3ServerMessage> {
    const expectedType = type.replace(/\.request$/, ".response")
    const message = await this.#request(
      {
        payload,
        requestId: this.#nextRequestId("web3"),
        type,
      } as Web3ClientMessage,
      expectedType,
      options,
      SERVER_CAPABILITIES.web3
    )
    return message as Web3ServerMessage
  }

  #bindTransport(transport: ServerTransport): void {
    this.#disposeTransport()
    this.#transport = transport
    const removers: (() => void)[] = []
    const isCurrent = () => this.#transport === transport && this.#state.status !== "disposed"

    removers.push(
      transport.onOpen(() => {
        if (!isCurrent()) return
        void this.#sendEnvelopeValidated(this.#createHelloMessage()).catch((error) => {
          this.#handleDisconnect(asError(error, "Invalid Cypheria hello"), 1002)
        })
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
    const envelope = parseWSOutboundMessageText(raw)
    if (envelope.type === "pong") {
      const pending = this.#pendingPings.values().next().value
      if (pending) {
        pending.cleanup()
        pending.resolve()
      }
      return
    }
    const message = envelope.message
    const requestId = messageRequestId(message)

    if (message.type === "server.status.notification") {
      this.#clearConnectTimeout()
      this.#attempt = 0
      this.#lastError = undefined
      this.#session = message.payload
      this.#setState({ status: "connected" })
      this.#resolveConnect()
    } else if (requestId && isClientResponseMessage(message)) {
      this.#settleResponse(requestId, message)
    }

    this.#emit(message)
  }

  async #request(
    message: ClientMessage,
    expectedType: string,
    options?: RequestOptions,
    requiredCapability?: string
  ): Promise<ServerMessage> {
    assertRequestTimeout(options?.timeoutMs)
    const parsed = parseClientMessage(message)
    if (!("requestId" in parsed) || typeof parsed.requestId !== "string") {
      throw new CypheriaProtocolError("A correlated Cypheria request must have a request id")
    }
    const requestId = parsed.requestId
    return new Promise<ServerMessage>((resolve, reject) => {
      const sendController = new AbortController()
      const cleanup = (): void => {
        clearTimeout(timeout)
        options?.signal?.removeEventListener("abort", onAbort)
        sendController.abort()
      }
      const onAbort = (): void => {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        this.#pending.delete(requestId)
        const error = asError(options?.signal?.reason, `Request ${requestId} was aborted`)
        pending.abortSend(error)
        pending.cleanup()
        pending.reject(error)
      }
      const timeout = setTimeout(
        () => {
          const pending = this.#pending.get(requestId)
          if (!pending) return
          this.#pending.delete(requestId)
          const error = new CypheriaTimeoutError(`Timed out waiting for ${expectedType}`)
          pending.abortSend(error)
          pending.cleanup()
          pending.reject(error)
        },
        options?.timeoutMs ?? this.#config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      )
      this.#pending.set(requestId, {
        abortSend: (reason) => sendController.abort(reason),
        cleanup,
        expectedType,
        reject,
        resolve,
      })
      options?.signal?.addEventListener("abort", onAbort, { once: true })
      if (options?.signal?.aborted) {
        onAbort()
        return
      }
      const signal = options?.signal
        ? AbortSignal.any([sendController.signal, options.signal])
        : sendController.signal
      void this.#sendParsedWhenConnected(parsed, signal, requiredCapability).catch((error) => {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        pending.cleanup()
        this.#pending.delete(requestId)
        pending.reject(asError(error, "Failed to send Cypheria request"))
      })
    })
  }

  async #sendParsedWhenConnected(
    message: ClientMessage,
    signal?: AbortSignal,
    requiredCapability?: string
  ): Promise<void> {
    if (signal?.aborted) throw asError(signal.reason, "Cypheria send was aborted")
    if (this.#state.status === "connected") {
      if (requiredCapability && !this.supports(requiredCapability)) {
        throw new CypheriaCapabilityError(requiredCapability)
      }
      await this.#sendValidated(message)
      return
    }
    await this.ensureConnected()
    if (signal?.aborted) throw asError(signal.reason, "Cypheria send was aborted")
    if (requiredCapability && !this.supports(requiredCapability)) {
      throw new CypheriaCapabilityError(requiredCapability)
    }
    await this.#sendValidated(message)
  }

  async #sendValidated(message: ClientMessage): Promise<void> {
    return this.#sendEnvelopeValidated(wrapClientSessionMessage(message))
  }

  async #sendEnvelopeValidated(message: WSInboundMessage): Promise<void> {
    const transport = this.#transport
    if (!transport) throw new CypheriaConnectionError("Cypheria client is not connected")
    await transport.send(stringifyProtocolMessage(parseWSInboundMessage(message)))
  }

  #settleResponse(requestId: RequestId, message: ServerMessage): void {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    pending.cleanup()
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
    this.#session = undefined
    this.#disposeTransport(closeCode, closeCode ? error.message.slice(0, 123) : undefined)
    this.#rejectPending(error)
    this.#rejectPings(error)
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
      pending.abortSend(error)
      pending.cleanup()
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #rejectPings(error: Error): void {
    for (const pending of [...this.#pendingPings]) {
      pending.cleanup()
      pending.reject(error)
    }
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

  #createHelloMessage(): Extract<WSInboundMessage, { type: "hello" }> {
    return {
      clientId: this.#descriptor.id,
      clientType: this.#descriptor.kind,
      protocolVersion: CYPHERIA_PROTOCOL_VERSION,
      ...(this.#descriptor.version ? { appVersion: this.#descriptor.version } : {}),
      ...(this.#config.capabilities ? { capabilities: this.#config.capabilities } : {}),
      type: "hello",
    }
  }
}

export type { RequestOptions } from "./request-options.js"
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
