import type { CodexClientResponseMap, CodexServerRequestResponseMap } from "@cypheria/protocol"
import {
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_REQUEST_TYPE_TO_METHOD,
  AGENT_CODEX_SERVER_RPC,
  type AgentCodexServerNotificationMessage,
  type AgentCodexServerRequestMessage,
  type RequestId as CypheriaRequestId,
} from "@cypheria/protocol"

import {
  attachCodexEndpoint,
  type CodexClientMethod,
  type CodexClientNotificationMethod,
  type CodexClientNotificationParams,
  type CodexEndpoint,
  type CodexRequestOptions,
  type CodexRequestParams,
  type CodexServerMessage,
  type CodexServerMethod,
  type CodexServerNotificationMethod,
  type CodexServerNotificationParams,
  type CodexServerRequestParams,
  respondCodexError,
} from "./codex-endpoint.js"
import type { CypheriaApi } from "./index.js"

export type {
  AgentCodexClientNotificationMessage,
  AgentCodexClientRequestMessage,
  AgentCodexClientResponseMessage,
  AgentCodexServerNotificationMessage,
  AgentCodexServerRequestMessage,
  AgentCodexServerResponseMessage,
  CodexClientResponseMap,
  CodexServerRequestResponseMap,
} from "@cypheria/protocol"
export {
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_RPC,
} from "@cypheria/protocol"
export type * from "@cypheria/protocol/codex-types"
export type {
  CodexClientMethod,
  CodexClientNotificationMethod,
  CodexClientNotificationParams,
  CodexEndpoint,
  CodexRequestOptions,
  CodexRequestParams,
  CodexServerMethod,
  CodexServerNotificationMethod,
  CodexServerNotificationParams,
  CodexServerRequestParams,
} from "./codex-endpoint.js"

export type MaybePromise<T> = T | PromiseLike<T>

export type CodexInitializationSnapshot = Readonly<{
  request: CodexRequestParams<"initialize">
  response: CodexClientResponseMap["initialize"]
}>

export type CodexInitializationState = "idle" | "initializing" | "initialized" | "failed" | "closed"

export type AppOptions = {
  readonly name?: string
  readonly onHandlerError?: (error: Error, message?: CodexServerMessage) => void
}

export type ClientRequestContext<Method extends CodexServerMethod> = {
  readonly codex: ClientContext
  readonly params: CodexServerRequestParams<Method>
  readonly requestId: CypheriaRequestId
  readonly signal: AbortSignal
}

export type ClientNotificationContext<Method extends CodexServerNotificationMethod> = {
  readonly codex: ClientContext
  readonly params: CodexServerNotificationParams<Method>
  readonly signal: AbortSignal
}

export type ClientRequestHandler<Method extends CodexServerMethod> = (
  context: ClientRequestContext<Method>
) => MaybePromise<CodexServerRequestResponseMap[Method]>

export type ClientNotificationHandler<Method extends CodexServerNotificationMethod> = (
  context: ClientNotificationContext<Method>
) => MaybePromise<void>

export type ClientConnectHandler = (connection: ClientConnection) => MaybePromise<void>

export interface ClientConnection {
  readonly closed: Promise<void>
  readonly codex: ClientContext
  readonly initialized: Promise<CodexInitializationSnapshot>
  readonly signal: AbortSignal
  close(error?: unknown): void
}

const identityMethods = <Registry extends Readonly<Record<string, unknown>>>(
  registry: Registry
): { readonly [Method in keyof Registry]: Method } =>
  Object.fromEntries(Object.keys(registry).map((method) => [method, method])) as {
    readonly [Method in keyof Registry]: Method
  }

/** Method-name constants grouped by the side that implements them. */
export const methods = {
  client: {
    notification: identityMethods(AGENT_CODEX_SERVER_NOTIFICATIONS),
    request: identityMethods(AGENT_CODEX_SERVER_RPC),
  },
  server: {
    notification: identityMethods(AGENT_CODEX_CLIENT_NOTIFICATIONS),
    request: identityMethods(AGENT_CODEX_CLIENT_RPC),
  },
} as const

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

const requestParams = (message: AgentCodexServerRequestMessage): Record<string, unknown> => {
  const { requestId: _requestId, type: _type, ...params } = message
  return params
}

const notificationParams = (
  message: AgentCodexServerNotificationMessage
): Record<string, unknown> => ("payload" in message ? message.payload : {})

const raceWithAbort = <T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(asError(signal.reason, "Codex client connection closed"))
    signal.addEventListener("abort", onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
    if (signal.aborted) onAbort()
  })

class CodexInitialization {
  readonly initialized: Promise<CodexInitializationSnapshot>
  #operation: Promise<CodexClientResponseMap["initialize"]> | undefined
  #reject!: (error: Error) => void
  #resolve!: (snapshot: CodexInitializationSnapshot) => void
  #snapshot: CodexInitializationSnapshot | undefined
  #state: CodexInitializationState = "idle"

  constructor(
    private readonly endpoint: CodexEndpoint,
    private readonly signal: AbortSignal
  ) {
    this.initialized = new Promise<CodexInitializationSnapshot>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    // The lifecycle promise remains safe when a caller only uses `closed`.
    void this.initialized.catch(() => undefined)
  }

  get state(): CodexInitializationState {
    return this.#state
  }

  initialize(
    params: CodexRequestParams<"initialize">,
    options?: CodexRequestOptions
  ): Promise<CodexClientResponseMap["initialize"]> {
    if (this.#snapshot) return Promise.resolve(this.#snapshot.response)
    if (this.#operation) return this.#operation
    if (this.#state === "closed" || this.#state === "failed") {
      throw new Error(`Codex client cannot initialize from state '${this.#state}'`)
    }

    this.#state = "initializing"
    const signal = options?.signal ? AbortSignal.any([this.signal, options.signal]) : this.signal
    this.#operation = (async () => {
      try {
        const response = await this.endpoint.request("initialize", params, { ...options, signal })
        signal.throwIfAborted()
        await this.endpoint.notify("initialized")
        const snapshot = { request: params, response } as const
        this.#snapshot = snapshot
        this.#state = "initialized"
        this.#resolve(snapshot)
        return response
      } catch (error) {
        const failure = asError(error, "Codex initialization failed")
        this.#state = this.signal.aborted ? "closed" : "failed"
        this.#reject(failure)
        throw failure
      }
    })()
    return this.#operation
  }

  assertInitialized(): void {
    if (this.#state !== "initialized") {
      throw new Error("Codex client must be initialized before using this method")
    }
  }

  close(error?: unknown): void {
    if (this.#state === "initialized" || this.#state === "failed" || this.#state === "closed") {
      return
    }
    this.#state = "closed"
    this.#reject(asError(error, "Codex client connection closed before initialization"))
  }
}

/** Typed context for calling the server-owned Codex App Server. */
export class ClientContext {
  readonly #endpoint: CodexEndpoint
  readonly #initialization: CodexInitialization
  readonly #signal: AbortSignal

  /** @internal */
  constructor(endpoint: CodexEndpoint, signal: AbortSignal, initialization: CodexInitialization) {
    this.#endpoint = endpoint
    this.#signal = signal
    this.#initialization = initialization
  }

  get initializationState(): CodexInitializationState {
    return this.#initialization.state
  }

  initialize(
    params: CodexRequestParams<"initialize">,
    options?: CodexRequestOptions
  ): Promise<CodexClientResponseMap["initialize"]> {
    this.#signal.throwIfAborted()
    return this.#initialization.initialize(params, options)
  }

  async notify<Method extends CodexClientNotificationMethod>(
    method: Method,
    ...args: keyof CodexClientNotificationParams<Method> extends never
      ? [params?: CodexClientNotificationParams<Method>]
      : [params: CodexClientNotificationParams<Method>]
  ): Promise<void> {
    this.#signal.throwIfAborted()
    if (method === "initialized") {
      throw new Error("The initialized notification is sent automatically by codex.initialize()")
    }
    this.#initialization.assertInitialized()
    return this.#endpoint.notify(method, args[0] as never)
  }

  async request<Method extends CodexClientMethod>(
    method: Method,
    ...args: keyof CodexRequestParams<Method> extends never
      ? [params?: CodexRequestParams<Method>, options?: CodexRequestOptions]
      : [params: CodexRequestParams<Method>, options?: CodexRequestOptions]
  ): Promise<CodexClientResponseMap[Method]> {
    this.#signal.throwIfAborted()
    const options = args[1]
    if (method === "initialize") {
      return this.#initialization.initialize(args[0] as never, options) as Promise<
        CodexClientResponseMap[Method]
      >
    }
    this.#initialization.assertInitialized()
    const signal = options?.signal ? AbortSignal.any([this.#signal, options.signal]) : this.#signal
    return this.#endpoint.request(method, args[0] as never, { ...options, signal })
  }
}

/** Creates a client-side Codex app. */
export function client(options?: AppOptions): ClientApp {
  return new ClientApp(options)
}

/** Fluent client-side handler registry backed by one Cypheria Codex endpoint. */
export class ClientApp {
  readonly #connectHandlers: ClientConnectHandler[] = []
  readonly #notificationHandlers = new Map<
    string,
    ClientNotificationHandler<CodexServerNotificationMethod>
  >()
  readonly #options: AppOptions
  readonly #requestHandlers = new Map<string, ClientRequestHandler<CodexServerMethod>>()

  constructor(options: AppOptions = {}) {
    this.#options = options
  }

  connect(cypheria: CypheriaApi): ClientConnection {
    return new CodexClientConnection(this, cypheria.agent.codex)
  }

  async connectWith<T>(
    cypheria: CypheriaApi,
    operation: (context: ClientContext) => MaybePromise<T>
  ): Promise<T> {
    const connection = this.connect(cypheria)
    try {
      return await operation(connection.codex)
    } finally {
      connection.close()
    }
  }

  onConnect(handler: ClientConnectHandler): this {
    this.#connectHandlers.push(handler)
    return this
  }

  onRequest<Method extends CodexServerMethod>(
    method: Method,
    handler: ClientRequestHandler<Method>
  ): this {
    this.#requestHandlers.set(method, handler as unknown as ClientRequestHandler<CodexServerMethod>)
    return this
  }

  onNotification<Method extends CodexServerNotificationMethod>(
    method: Method,
    handler: ClientNotificationHandler<Method>
  ): this {
    this.#notificationHandlers.set(
      method,
      handler as unknown as ClientNotificationHandler<CodexServerNotificationMethod>
    )
    return this
  }

  /** @internal */
  connectHandlers(): readonly ClientConnectHandler[] {
    return this.#connectHandlers
  }

  /** @internal */
  notificationHandler(
    method: CodexServerNotificationMethod
  ): ClientNotificationHandler<CodexServerNotificationMethod> | undefined {
    return this.#notificationHandlers.get(method)
  }

  /** @internal */
  requestHandler(method: CodexServerMethod): ClientRequestHandler<CodexServerMethod> | undefined {
    return this.#requestHandlers.get(method)
  }

  /** @internal */
  reportError(error: unknown, message?: CodexServerMessage): void {
    try {
      this.#options.onHandlerError?.(
        asError(error, `${this.#options.name ?? "Codex"} handler failed`),
        message
      )
    } catch {
      // Error observers must not break message dispatch.
    }
  }
}

class CodexClientConnection implements ClientConnection {
  readonly closed: Promise<void>
  readonly codex: ClientContext
  readonly initialized: Promise<CodexInitializationSnapshot>
  readonly signal: AbortSignal

  readonly #abortController = new AbortController()
  readonly #app: ClientApp
  readonly #endpoint: CodexEndpoint
  readonly #initialization: CodexInitialization
  readonly #resolveClosed: () => void
  #releaseEndpoint: (() => void) | undefined
  #transportAvailable = true
  #unsubscribeMessages: (() => void) | undefined

  constructor(app: ClientApp, endpoint: CodexEndpoint) {
    this.#app = app
    this.#endpoint = endpoint
    this.signal = this.#abortController.signal
    this.#initialization = new CodexInitialization(endpoint, this.signal)
    this.initialized = this.#initialization.initialized
    this.codex = new ClientContext(endpoint, this.signal, this.#initialization)
    let resolveClosed!: () => void
    this.closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    this.#resolveClosed = resolveClosed

    this.#releaseEndpoint = attachCodexEndpoint(endpoint, (error) => {
      this.#transportAvailable = false
      this.close(error)
    })
    if (this.signal.aborted) {
      this.#releaseEndpoint()
      this.#releaseEndpoint = undefined
      return
    }
    try {
      this.#unsubscribeMessages = endpoint.subscribe((message) => {
        void this.#dispatch(message).catch((error) => app.reportError(error, message))
      })
      for (const handler of app.connectHandlers()) {
        let result: MaybePromise<void>
        try {
          result = handler(this)
        } catch (error) {
          app.reportError(error)
          this.close(error)
          throw error
        }
        void Promise.resolve(result).catch((error) => {
          app.reportError(error)
          this.close(error)
        })
      }
    } catch (error) {
      this.close(error)
      throw error
    }
  }

  close(error?: unknown): void {
    if (this.signal.aborted) return
    this.#initialization.close(error)
    this.#abortController.abort(error)
    this.#unsubscribeMessages?.()
    this.#unsubscribeMessages = undefined
    this.#releaseEndpoint?.()
    this.#releaseEndpoint = undefined
    this.#resolveClosed()
  }

  async #dispatch(message: CodexServerMessage): Promise<void> {
    if (this.signal.aborted) return
    const requestMethod = (
      AGENT_CODEX_SERVER_REQUEST_TYPE_TO_METHOD as Partial<Record<string, CodexServerMethod>>
    )[message.type]
    if (requestMethod) {
      await this.#dispatchRequest(message as AgentCodexServerRequestMessage, requestMethod)
      return
    }
    const method = (
      AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD as Partial<
        Record<string, CodexServerNotificationMethod>
      >
    )[message.type]
    if (!method) return
    const handler = this.#app.notificationHandler(method)
    if (!handler) return
    try {
      await handler({
        codex: this.codex,
        params: notificationParams(message as AgentCodexServerNotificationMessage),
        signal: this.signal,
      } as never)
    } catch (error) {
      this.#app.reportError(error, message)
    }
  }

  async #dispatchRequest(
    message: AgentCodexServerRequestMessage,
    method: CodexServerMethod
  ): Promise<void> {
    const handler = this.#app.requestHandler(method)
    if (!handler) {
      const error = new Error(`No Codex client handler registered for '${method}'`)
      this.#app.reportError(error, message)
      await respondCodexError(this.#endpoint, message.requestId, {
        code: "REQUEST_NOT_SUPPORTED",
        message: error.message,
        requestType: message.type,
      })
      return
    }
    try {
      const response = await raceWithAbort(
        Promise.resolve(
          handler({
            codex: this.codex,
            params: requestParams(message),
            requestId: message.requestId,
            signal: this.signal,
          } as never)
        ),
        this.signal
      )
      await this.#endpoint.respond(method, message.requestId, response)
    } catch (error) {
      this.#app.reportError(error, message)
      // A lost transport cannot receive the terminal cancellation and must not be reconnected just
      // to deliver a stale reverse-RPC response. A logical ClientApp close keeps the borrowed
      // Cypheria transport alive, so it can still terminate the server request explicitly.
      if (this.signal.aborted && !this.#transportAvailable) return
      await respondCodexError(this.#endpoint, message.requestId, {
        code: this.signal.aborted ? "REQUEST_CANCELLED" : "HANDLER_FAILED",
        message: asError(error, "Codex client handler failed").message,
        requestType: message.type,
      })
    }
  }
}
