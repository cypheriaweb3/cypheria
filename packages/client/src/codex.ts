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
} from "./codex-endpoint.js"

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

/** Typed context for calling the server-owned Codex App Server. */
export class ClientContext {
  readonly #endpoint: CodexEndpoint
  readonly #signal: AbortSignal

  /** @internal */
  constructor(endpoint: CodexEndpoint, signal: AbortSignal) {
    this.#endpoint = endpoint
    this.#signal = signal
  }

  async notify<Method extends CodexClientNotificationMethod>(
    method: Method,
    ...args: keyof CodexClientNotificationParams<Method> extends never
      ? [params?: CodexClientNotificationParams<Method>]
      : [params: CodexClientNotificationParams<Method>]
  ): Promise<void> {
    this.#signal.throwIfAborted()
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

  connect(endpoint: CodexEndpoint): ClientConnection {
    return new CodexClientConnection(this, endpoint)
  }

  async connectWith<T>(
    endpoint: CodexEndpoint,
    operation: (context: ClientContext) => MaybePromise<T>
  ): Promise<T> {
    const connection = this.connect(endpoint)
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
  readonly signal: AbortSignal

  readonly #abortController = new AbortController()
  readonly #app: ClientApp
  readonly #endpoint: CodexEndpoint
  readonly #resolveClosed: () => void
  #releaseEndpoint: (() => void) | undefined
  #unsubscribeMessages: (() => void) | undefined

  constructor(app: ClientApp, endpoint: CodexEndpoint) {
    this.#app = app
    this.#endpoint = endpoint
    this.signal = this.#abortController.signal
    this.codex = new ClientContext(endpoint, this.signal)
    let resolveClosed!: () => void
    this.closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    this.#resolveClosed = resolveClosed

    this.#releaseEndpoint = attachCodexEndpoint(endpoint, (error) => this.close(error))
    if (this.signal.aborted) {
      this.#releaseEndpoint()
      this.#releaseEndpoint = undefined
      return
    }
    try {
      this.#unsubscribeMessages = endpoint.subscribe((message) => {
        void this.#dispatch(message)
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
      this.#app.reportError(
        new Error(`No Codex client handler registered for '${method}'`),
        message
      )
      return
    }
    try {
      const response = await handler({
        codex: this.codex,
        params: requestParams(message),
        requestId: message.requestId,
        signal: this.signal,
      } as never)
      if (!this.signal.aborted) await this.#endpoint.respond(method, message.requestId, response)
    } catch (error) {
      this.#app.reportError(error, message)
    }
  }
}
