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
  type ExtensionMethod,
  type MaybePromise,
  type ParamsParser,
  ClientApp as SdkClientApp,
  type UnrecognizedMethod,
} from "@agentclientprotocol/sdk/experimental/v2"

import { openAcpV2Stream } from "./acp-client.js"
import type { CypheriaApi } from "./index.js"

export type {
  AcpConnection,
  ActiveSessionMessage,
  AgentBatchEntry,
  AgentConnectHandler,
  AgentConnection,
  AgentConnectionLifecycle,
  AgentConnectOptions,
  AgentConnector,
  AgentHandlerContext,
  AgentNotificationContext,
  AgentNotificationHandler,
  AgentNotificationHandlersByMethod,
  AgentNotificationMethod,
  AgentNotificationParamsByMethod,
  AgentRequestContext,
  AgentRequestHandler,
  AgentRequestHandlersByMethod,
  AgentRequestMethod,
  AgentRequestParamsByMethod,
  AgentRequestResponsesByMethod,
  AnyBatchCall,
  AnyBatchMessage,
  AnyBatchResponse,
  AnyCall,
  AnyMessage,
  AnyNotification,
  AnyRequest,
  AnyResponse,
  AnyWireMessage,
  AppOptions,
  BatchEntry,
  BatchNotification,
  BatchOutputs,
  BatchRequest,
  ClientBatchEntry,
  ClientConnectHandler,
  ClientConnection,
  ClientHandlerContext,
  ClientNotificationContext,
  ClientNotificationHandler,
  ClientNotificationHandlersByMethod,
  ClientNotificationMethod,
  ClientNotificationParamsByMethod,
  ClientRequestContext,
  ClientRequestHandler,
  ClientRequestHandlersByMethod,
  ClientRequestMethod,
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
  ErrorResponse,
  ExtensionMethod,
  InitializationSnapshot,
  JsonRpcId,
  MaybePromise,
  ParamsParser,
  Result,
  SendRequestOptions,
  Stream,
  UnrecognizedMethod,
  WireStream,
} from "@agentclientprotocol/sdk/experimental/v2"
export {
  ActiveSession,
  AGENT_METHODS,
  AgentApp,
  AgentContext,
  AgentProtocolRouter,
  AuthMethod,
  AvailableCommandInput,
  agent,
  agentProtocolRouter,
  batchNotification,
  batchRequest,
  CLIENT_METHODS,
  ClientContext,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  DiffChange,
  ElicitationPropertySchema,
  McpServer,
  MultiSelectItems,
  methods,
  NesSuggestion,
  ndJsonStream,
  PlanUpdateContent,
  PROTOCOL_METHODS,
  PROTOCOL_VERSION,
  ReplayFrom,
  RequestError,
  RequestPermissionOutcome,
  RequestPermissionSubject,
  SessionBuilder,
  SessionConfigOption,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  StateUpdate,
  ToolCallContent,
} from "@agentclientprotocol/sdk/experimental/v2"
export type { AcpEndpoint } from "./acp-client.js"
export type * from "./acp-v2-schema-types.js"

/** Creates a Cypheria-backed client-side ACP v2 app. */
export function client(options?: AppOptions): ClientApp {
  return new ClientApp(options)
}

/**
 * Draft ACP v2 client app with the official handler API over a borrowed Cypheria API.
 */
export class ClientApp {
  readonly #app: SdkClientApp

  constructor(options: AppOptions = {}) {
    this.#app = new SdkClientApp(options)
  }

  connect(cypheria: CypheriaApi): ClientConnection {
    const stream = openAcpV2Stream(cypheria.agent.acp)
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
    cypheria: CypheriaApi,
    operation: (context: ClientContext) => MaybePromise<T>
  ): Promise<T> {
    const stream = openAcpV2Stream(cypheria.agent.acp)
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
    method: ExtensionMethod,
    params: ParamsParser<Params>,
    handler: ClientRequestHandler<Params, Response>
  ): this
  onRequest<Params, Response, const Method extends string = never>(
    method: UnrecognizedMethod<Method>,
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
    method: ExtensionMethod,
    params: ParamsParser<Params>,
    handler: ClientNotificationHandler<Params>
  ): this
  onNotification<Params, const Method extends string = never>(
    method: UnrecognizedMethod<Method>,
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
