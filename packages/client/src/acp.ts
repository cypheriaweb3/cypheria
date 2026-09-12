import {
  type AppOptions,
  type ClientConnectHandler,
  type ClientConnection,
  type ClientContext,
  type ClientNotificationHandler,
  type ClientNotificationHandlersByMethod,
  type ClientNotificationMethod,
  type ClientRequestHandler,
  type ClientRequestHandlersByMethod,
  type ClientRequestMethod,
  type MaybePromise,
  type ParamsParser,
  ClientApp as SdkClientApp,
} from "@agentclientprotocol/sdk"

import { type AcpEndpoint, openAcpV1Stream } from "./acp-client.js"

export type {
  AcpConnection,
  ActiveSessionMessage,
  Agent,
  AgentConnectHandler,
  AgentConnection,
  AgentHandlerContext,
  AgentNotificationHandler,
  AgentNotificationHandlersByMethod,
  AgentNotificationMethod,
  AgentNotificationParamsByMethod,
  AgentRequestHandler,
  AgentRequestHandlersByMethod,
  AgentRequestMethod,
  AgentRequestParamsByMethod,
  AgentRequestResponsesByMethod,
  AnyMessage,
  AnyNotification,
  AnyRequest,
  AnyResponse,
  AppOptions,
  Client,
  ClientConnectHandler,
  ClientConnection,
  ClientHandlerContext,
  ClientNotificationHandler,
  ClientNotificationHandlersByMethod,
  ClientNotificationMethod,
  ClientNotificationParamsByMethod,
  ClientRequestHandler,
  ClientRequestHandlersByMethod,
  ClientRequestMethod,
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
  ErrorResponse,
  JsonRpcId,
  MaybePromise,
  ParamsParser,
  Result,
  SendRequestOptions,
  Stream,
} from "@agentclientprotocol/sdk"
export {
  ActiveSession,
  AGENT_METHODS,
  AgentApp,
  AgentContext,
  agent,
  CLIENT_METHODS,
  ClientContext,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  MultiSelectItems,
  methods,
  ndJsonStream,
  PROTOCOL_METHODS,
  PROTOCOL_VERSION,
  RequestError,
  SessionBuilder,
} from "@agentclientprotocol/sdk"
export type { AcpEndpoint } from "./acp-client.js"
export type * from "./acp-schema-types.js"

/** Creates a Cypheria-backed client-side ACP v1 app. */
export function client(options?: AppOptions): ClientApp {
  return new ClientApp(options)
}

/**
 * ACP v1 client app with the official handler API and a Cypheria endpoint as its transport.
 */
export class ClientApp {
  readonly #app: SdkClientApp

  constructor(options: AppOptions = {}) {
    this.#app = new SdkClientApp(options)
  }

  connect(endpoint: AcpEndpoint): ClientConnection {
    const stream = openAcpV1Stream(endpoint)
    try {
      const connection = this.#app.connect(stream)
      void connection.closed.then(
        () => stream.close(),
        (error) => stream.close(error)
      )
      return connection
    } catch (error) {
      stream.close(error)
      throw error
    }
  }

  async connectWith<T>(
    endpoint: AcpEndpoint,
    operation: (context: ClientContext) => MaybePromise<T>
  ): Promise<T> {
    const stream = openAcpV1Stream(endpoint)
    try {
      return await this.#app.connectWith(stream, operation)
    } finally {
      stream.close()
    }
  }

  onConnect(handler: ClientConnectHandler): this {
    this.#app.onConnect(handler)
    return this
  }

  onRequest<Method extends ClientRequestMethod>(
    method: Method,
    handler: ClientRequestHandlersByMethod[Method]
  ): this
  onRequest<Params, Response>(
    method: string,
    params: ParamsParser<Params>,
    handler: ClientRequestHandler<Params, Response>
  ): this
  onRequest<Params, Response>(
    method: string,
    handlerOrParams: ClientRequestHandlersByMethod[ClientRequestMethod] | ParamsParser<Params>,
    handler?: ClientRequestHandler<Params, Response>
  ): this {
    if (handler) {
      const register = this.#app.onRequest.bind(this.#app) as (
        method: string,
        params: unknown,
        handler: unknown
      ) => unknown
      register(method, handlerOrParams, handler)
    } else {
      const register = this.#app.onRequest.bind(this.#app) as (
        method: string,
        handler: unknown
      ) => unknown
      register(method, handlerOrParams)
    }
    return this
  }

  onNotification<Method extends ClientNotificationMethod>(
    method: Method,
    handler: ClientNotificationHandlersByMethod[Method]
  ): this
  onNotification<Params>(
    method: string,
    params: ParamsParser<Params>,
    handler: ClientNotificationHandler<Params>
  ): this
  onNotification<Params>(
    method: string,
    handlerOrParams:
      | ClientNotificationHandlersByMethod[ClientNotificationMethod]
      | ParamsParser<Params>,
    handler?: ClientNotificationHandler<Params>
  ): this {
    if (handler) {
      const register = this.#app.onNotification.bind(this.#app) as (
        method: string,
        params: unknown,
        handler: unknown
      ) => unknown
      register(method, handlerOrParams, handler)
    } else {
      const register = this.#app.onNotification.bind(this.#app) as (
        method: string,
        handler: unknown
      ) => unknown
      register(method, handlerOrParams)
    }
    return this
  }
}
