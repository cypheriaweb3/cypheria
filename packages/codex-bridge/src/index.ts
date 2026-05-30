import type {
  ClientInfo,
  ClientNotification,
  ClientRequest,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  RequestId,
  ServerNotification,
  ServerRequest,
} from "./generated/index.js"

export type {
  CodexAppServerProvider,
  CodexAppServerProviderBridge,
  CodexAppServerProviderCallSettings,
  CodexAppServerProviderOptions,
  CodexAppServerProviderSettings,
  CodexAppServerSandboxMode,
  CodexAppServerThreadMode,
} from "./ai-sdk-provider.js"
export {
  CodexAppServerAiSdkSession,
  createCodexAppServerProvider,
} from "./ai-sdk-provider.js"
export type * from "./generated/index.js"

export type CodexJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly CodexJsonValue[]
  | { readonly [key: string]: CodexJsonValue }

export type CodexRequestId = RequestId

export type CodexLifecycleState =
  | "closed"
  | "closing"
  | "errored"
  | "ready"
  | "starting"
  | "stopped"

export type CodexTransportError = {
  readonly cause?: unknown
  readonly code: "CLOSED" | "INVALID_MESSAGE" | "REQUEST_FAILED" | "SERVER_BUSY" | "TRANSPORT_ERROR"
  readonly message: string
}

export type CodexClientRequestByMethod<M extends ClientRequest["method"]> = Extract<
  ClientRequest,
  { readonly method: M }
>

export type CodexClientRequestParams<M extends ClientRequest["method"]> =
  CodexClientRequestByMethod<M>["params"]

export type CodexServerNotificationByMethod<M extends ServerNotification["method"]> = Extract<
  ServerNotification,
  { readonly method: M }
>

export type CodexServerRequestByMethod<M extends ServerRequest["method"]> = Extract<
  ServerRequest,
  { readonly method: M }
>

export type CodexAppServerSuccess = {
  readonly id: CodexRequestId
  readonly result: CodexJsonValue
}

export type CodexJsonRpcErrorObject = {
  readonly code: number
  readonly data?: CodexJsonValue
  readonly message: string
}

export type CodexAppServerError = {
  readonly error: CodexJsonRpcErrorObject
  readonly id: CodexRequestId | null
}

export type CodexAppServerResponse = CodexAppServerError | CodexAppServerSuccess
export type CodexAppServerInboundMessage =
  | CodexAppServerResponse
  | ServerNotification
  | ServerRequest
export type CodexAppServerOutboundMessage =
  | ClientNotification
  | ClientRequest
  | CodexAppServerSuccess

export type CodexAppServerRequestOptions = {
  readonly retryOnOverload?: boolean
}

export type CodexRetryOptions = {
  readonly initialDelayMs?: number
  readonly jitterRatio?: number
  readonly maxAttempts?: number
  readonly maxDelayMs?: number
}

export type CodexAppServerBridgeOptions = {
  readonly WebSocketImpl?: CodexWebSocketConstructor
  readonly capabilities?: InitializeCapabilities | null
  readonly clientInfo: ClientInfo
  readonly retry?: CodexRetryOptions
  readonly url: string | URL
}

export type CodexAppServerBridgeEventMap = {
  readonly error: CodexTransportError
  readonly lifecycle: CodexLifecycleState
  readonly notification: ServerNotification
  readonly "server-request": ServerRequest
}

export type CodexAppServerBridgeHandler<K extends keyof CodexAppServerBridgeEventMap> = (
  event: CodexAppServerBridgeEventMap[K]
) => void

export type CodexServerRequestHandler = (
  request: ServerRequest
) => CodexJsonValue | Promise<CodexJsonValue>

export type CodexWebSocketEvent = { readonly data?: unknown; readonly error?: unknown }

export type CodexWebSocketLike = {
  readonly readyState: number
  close: () => void
  send: (data: string) => void
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: CodexWebSocketEvent) => void,
    options?: { readonly once?: boolean }
  ) => void
}

export type CodexWebSocketConstructor = new (url: string) => CodexWebSocketLike

export class CodexAppServerRpcError extends Error {
  readonly code: number
  readonly data?: CodexJsonValue

  constructor(error: CodexJsonRpcErrorObject) {
    super(`Codex app-server request failed (${error.code}): ${error.message}`)
    this.name = "CodexAppServerRpcError"
    this.code = error.code
    this.data = error.data
  }
}

export class CodexAppServerBusyError extends CodexAppServerRpcError {
  constructor(error: CodexJsonRpcErrorObject) {
    super(error)
    this.name = "CodexAppServerBusyError"
  }
}

export class CodexAppServerRetryLimitError extends CodexAppServerBusyError {
  constructor(error: CodexJsonRpcErrorObject) {
    super(error)
    this.name = "CodexAppServerRetryLimitError"
  }
}

const webSocketOpen = 1
const webSocketClosing = 2
const webSocketClosed = 3

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRequestId = (value: unknown): value is CodexRequestId =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value))

const isJsonValue = (value: unknown): value is CodexJsonValue => {
  if (value === null) {
    return true
  }

  if (typeof value === "boolean" || typeof value === "string") {
    return true
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (isObject(value)) {
    return Object.values(value).every(isJsonValue)
  }

  return false
}

const isJsonRpcErrorObject = (value: unknown): value is CodexJsonRpcErrorObject =>
  isObject(value) &&
  typeof value.code === "number" &&
  Number.isFinite(value.code) &&
  typeof value.message === "string" &&
  ("data" in value ? isJsonValue(value.data) : true)

const parseAppServerMessage = (data: unknown): CodexAppServerInboundMessage | undefined => {
  if (typeof data !== "string") {
    return undefined
  }

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }

  if (!isObject(value)) {
    return undefined
  }

  if ("error" in value) {
    return (isRequestId(value.id) || value.id === null) && isJsonRpcErrorObject(value.error)
      ? (value as CodexAppServerError)
      : undefined
  }

  if ("result" in value) {
    return isRequestId(value.id) && isJsonValue(value.result)
      ? (value as CodexAppServerSuccess)
      : undefined
  }

  if (typeof value.method !== "string" || value.method.length === 0) {
    return undefined
  }

  const hasValidParams = "params" in value ? isJsonValue(value.params) : true
  if (!hasValidParams) {
    return undefined
  }

  return "id" in value
    ? isRequestId(value.id)
      ? (value as ServerRequest)
      : undefined
    : (value as ServerNotification)
}

const getDefaultWebSocketImpl = (): CodexWebSocketConstructor => {
  if (typeof WebSocket === "undefined") {
    throw new Error("No WebSocket implementation is available")
  }
  return WebSocket as unknown as CodexWebSocketConstructor
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const containsRetryLimitText = (message: string): boolean => {
  const text = message.toLowerCase()
  return text.includes("retry limit") || text.includes("too many failed attempts")
}

const isServerOverloadedData = (value: unknown): boolean => {
  if (value === "server_overloaded" || value === "serverOverloaded") {
    return true
  }

  if (Array.isArray(value)) {
    return value.some(isServerOverloadedData)
  }

  if (isObject(value)) {
    const direct = value.codex_error_info ?? value.codexErrorInfo ?? value.errorInfo
    if (direct && isServerOverloadedData(direct)) {
      return true
    }

    return Object.values(value).some(isServerOverloadedData)
  }

  return false
}

const mapRpcError = (error: CodexJsonRpcErrorObject): CodexAppServerRpcError => {
  if (error.code >= -32_099 && error.code <= -32_000) {
    if (isServerOverloadedData(error.data)) {
      return containsRetryLimitText(error.message)
        ? new CodexAppServerRetryLimitError(error)
        : new CodexAppServerBusyError(error)
    }

    if (containsRetryLimitText(error.message)) {
      return new CodexAppServerRetryLimitError(error)
    }
  }

  return new CodexAppServerRpcError(error)
}

export const isCodexAppServerRetryableError = (error: unknown): boolean =>
  error instanceof CodexAppServerBusyError ||
  (error instanceof CodexAppServerRpcError && isServerOverloadedData(error.data))

export class CodexAppServerBridge {
  readonly #capabilities: InitializeCapabilities | null
  readonly #clientInfo: ClientInfo
  readonly #listeners = new Map<keyof CodexAppServerBridgeEventMap, Set<(event: unknown) => void>>()
  readonly #pending = new Map<
    CodexRequestId,
    {
      readonly reject: (error: Error) => void
      readonly resolve: (value: CodexJsonValue) => void
    }
  >()
  readonly #retry: Required<CodexRetryOptions>
  readonly #serverRequestHandlers = new Map<ServerRequest["method"], CodexServerRequestHandler>()
  readonly #url: string
  readonly #WebSocketImpl: CodexWebSocketConstructor
  #nextId = 1
  #state: CodexLifecycleState = "stopped"
  #socket: CodexWebSocketLike | undefined

  constructor(options: CodexAppServerBridgeOptions) {
    this.#url = options.url.toString()
    this.#WebSocketImpl = options.WebSocketImpl ?? getDefaultWebSocketImpl()
    this.#clientInfo = options.clientInfo
    this.#capabilities = options.capabilities ?? null
    this.#retry = {
      initialDelayMs: options.retry?.initialDelayMs ?? 250,
      jitterRatio: options.retry?.jitterRatio ?? 0.2,
      maxAttempts: options.retry?.maxAttempts ?? 3,
      maxDelayMs: options.retry?.maxDelayMs ?? 2000,
    }
  }

  getState(): CodexLifecycleState {
    return this.#state
  }

  async connect(): Promise<InitializeResponse> {
    if (this.#state === "ready") {
      throw new Error("Codex app-server bridge is already connected")
    }

    this.#setState("starting")
    const socket = new this.#WebSocketImpl(this.#url)
    this.#socket = socket
    this.#bindSocket(socket)

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener(
        "error",
        (event) => {
          reject(new Error(`Codex app-server WebSocket failed to open: ${String(event.error)}`))
        },
        { once: true }
      )
      socket.addEventListener(
        "close",
        () => reject(new Error("Codex app-server WebSocket closed")),
        {
          once: true,
        }
      )
    })

    const response = await this.initialize()
    this.sendNotification({ method: "initialized" })
    this.#setState("ready")
    return response
  }

  async close(): Promise<void> {
    if (!this.#socket || this.#state === "closed" || this.#state === "stopped") {
      this.#setState("closed")
      return
    }

    this.#setState("closing")
    this.#socket.close()
    this.#socket = undefined
    this.#failPending(new Error("Codex app-server bridge closed"))
    this.#setState("closed")
  }

  initialize(params?: Partial<InitializeParams>): Promise<InitializeResponse> {
    return this.request<"initialize", InitializeResponse>("initialize", {
      capabilities: this.#capabilities,
      clientInfo: this.#clientInfo,
      ...params,
    })
  }

  request<M extends ClientRequest["method"], TResponse = CodexJsonValue>(
    method: M,
    params: CodexClientRequestParams<M>,
    options?: CodexAppServerRequestOptions
  ): Promise<TResponse> {
    if (options?.retryOnOverload) {
      return this.requestWithRetryOnOverload<M, TResponse>(method, params)
    }

    return this.#requestOnce<M, TResponse>(method, params)
  }

  async requestWithRetryOnOverload<M extends ClientRequest["method"], TResponse = CodexJsonValue>(
    method: M,
    params: CodexClientRequestParams<M>,
    options?: CodexRetryOptions
  ): Promise<TResponse> {
    const maxAttempts = options?.maxAttempts ?? this.#retry.maxAttempts
    if (maxAttempts < 1) {
      throw new Error("maxAttempts must be >= 1")
    }

    let delayMs = options?.initialDelayMs ?? this.#retry.initialDelayMs
    let attempt = 0

    while (true) {
      attempt += 1
      try {
        return await this.#requestOnce<M, TResponse>(method, params)
      } catch (error) {
        if (attempt >= maxAttempts || !isCodexAppServerRetryableError(error)) {
          throw error
        }

        const maxDelayMs = options?.maxDelayMs ?? this.#retry.maxDelayMs
        const jitterRatio = options?.jitterRatio ?? this.#retry.jitterRatio
        const jitter = delayMs * jitterRatio
        const waitMs = Math.max(0, Math.min(maxDelayMs, delayMs) + (Math.random() * 2 - 1) * jitter)
        await sleep(waitMs)
        delayMs = Math.min(maxDelayMs, delayMs * 2)
      }
    }
  }

  sendNotification(notification: ClientNotification): void {
    this.#send(notification)
  }

  on<K extends keyof CodexAppServerBridgeEventMap>(
    type: K,
    handler: CodexAppServerBridgeHandler<K>
  ): () => void {
    const listeners = this.#listeners.get(type) ?? new Set<(event: unknown) => void>()
    listeners.add(handler as (event: unknown) => void)
    this.#listeners.set(type, listeners)

    return () => {
      listeners.delete(handler as (event: unknown) => void)
    }
  }

  onServerRequest<M extends ServerRequest["method"]>(
    method: M,
    handler: (request: CodexServerRequestByMethod<M>) => CodexJsonValue | Promise<CodexJsonValue>
  ): () => void {
    const typedHandler = handler as CodexServerRequestHandler
    this.#serverRequestHandlers.set(method, typedHandler)
    return () => {
      if (this.#serverRequestHandlers.get(method) === typedHandler) {
        this.#serverRequestHandlers.delete(method)
      }
    }
  }

  #requestOnce<M extends ClientRequest["method"], TResponse>(
    method: M,
    params: CodexClientRequestParams<M>
  ): Promise<TResponse> {
    const id = this.#createRequestId()
    const request = { id, method, params } as CodexClientRequestByMethod<M>

    return new Promise<TResponse>((resolve, reject) => {
      this.#pending.set(id, {
        reject,
        resolve: (value) => resolve(value as TResponse),
      })

      try {
        this.#send(request)
      } catch (error) {
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  #createRequestId(): CodexRequestId {
    return `cypheria_${this.#nextId++}`
  }

  #bindSocket(socket: CodexWebSocketLike): void {
    socket.addEventListener("message", (event) => {
      this.#handleRawMessage(event.data)
    })
    socket.addEventListener("error", (event) => {
      this.#emitError({
        cause: event.error,
        code: "TRANSPORT_ERROR",
        message: "Codex app-server WebSocket error",
      })
    })
    socket.addEventListener("close", () => {
      this.#socket = undefined
      if (this.#state !== "closing" && this.#state !== "closed") {
        this.#setState("closed")
      }
      this.#failPending(new Error("Codex app-server WebSocket closed"))
    })
  }

  #handleRawMessage(data: unknown): void {
    const message = parseAppServerMessage(data)
    if (!message) {
      this.#emitError({
        code: "INVALID_MESSAGE",
        message: "Received invalid Codex app-server message",
      })
      return
    }

    if ("result" in message || "error" in message) {
      this.#handleResponse(message)
      return
    }

    if ("id" in message) {
      void this.#handleServerRequest(message)
      return
    }

    this.#emit("notification", message)
  }

  #handleResponse(response: CodexAppServerResponse): void {
    if (response.id === null) {
      this.#emitError({
        code: "REQUEST_FAILED",
        message: "Codex app-server returned an error without a request id",
      })
      return
    }

    const pending = this.#pending.get(response.id)
    if (!pending) {
      return
    }
    this.#pending.delete(response.id)

    if ("error" in response) {
      pending.reject(mapRpcError(response.error))
      return
    }

    pending.resolve(response.result)
  }

  async #handleServerRequest(request: ServerRequest): Promise<void> {
    this.#emit("server-request", request)
    const handler = this.#serverRequestHandlers.get(request.method)
    const result = handler ? await handler(request) : {}
    this.#send({ id: request.id, result })
  }

  #send(message: CodexAppServerOutboundMessage): void {
    if (!this.#socket || this.#socket.readyState !== webSocketOpen) {
      throw new Error("Codex app-server WebSocket is not open")
    }

    this.#socket.send(JSON.stringify(message))
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #setState(state: CodexLifecycleState): void {
    if (this.#state === state) {
      return
    }

    this.#state = state
    this.#emit("lifecycle", state)
  }

  #emit<K extends keyof CodexAppServerBridgeEventMap>(
    type: K,
    event: CodexAppServerBridgeEventMap[K]
  ): void {
    const listeners = this.#listeners.get(type)
    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(event)
    }
  }

  #emitError(error: CodexTransportError): void {
    this.#setState("errored")
    this.#emit("error", error)
  }
}

export const createCodexAppServerBridge = (
  options: CodexAppServerBridgeOptions
): CodexAppServerBridge => new CodexAppServerBridge(options)

export const isCodexWebSocketClosed = (socket: Pick<CodexWebSocketLike, "readyState">): boolean =>
  socket.readyState === webSocketClosing || socket.readyState === webSocketClosed
