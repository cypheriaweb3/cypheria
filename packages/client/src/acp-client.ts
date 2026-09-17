import type * as AcpV1 from "@agentclientprotocol/sdk"
import type * as AcpV2 from "@agentclientprotocol/sdk/experimental/v2"
import {
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
  type AcpV1AgentMessage,
  type AcpV1ClientMessage,
  type AcpV2AgentWireMessage,
  type AcpV2ClientWireMessage,
  AGENT_ACP_V1_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V1_CLIENT_RESPONSE_TYPE_TO_METHOD,
  AGENT_ACP_V1_CLIENT_RPC,
  AGENT_ACP_V1_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  AGENT_ACP_V1_SERVER_REQUEST_TYPE_TO_METHOD,
  AGENT_ACP_V1_SERVER_RPC,
  AGENT_ACP_V2_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V2_CLIENT_RESPONSE_TYPE_TO_METHOD,
  AGENT_ACP_V2_CLIENT_RPC,
  AGENT_ACP_V2_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  AGENT_ACP_V2_SERVER_REQUEST_TYPE_TO_METHOD,
  AGENT_ACP_V2_SERVER_RPC,
  type AgentAcpClientMessage,
  AgentAcpClientMessageSchema,
  type AgentAcpServerMessage,
  type RegistryAgentId,
} from "@cypheria/protocol"

export type AcpTransportState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

/** Logical ACP messages sent over one Cypheria server connection. */
export interface AcpEndpoint {
  readonly agent: RegistryAgentId
  send(message: AgentAcpClientMessage): Promise<void>
  subscribe(handler: (message: AgentAcpServerMessage) => void): () => void
}

interface AcpEndpointTransport {
  send(message: AgentAcpClientMessage): Promise<void>
  subscribe(handler: (message: AgentAcpServerMessage) => void): () => void
  subscribeConnectionStatus?(handler: (state: AcpTransportState) => void): () => void
}

type BridgeStream<OutgoingMessage, IncomingMessage> = {
  readonly readable: ReadableStream<IncomingMessage>
  readonly writable: WritableStream<OutgoingMessage>
  close(error?: unknown): void
}

type JsonRpcId = string | number | null
type RawMessage = {
  readonly error?: unknown
  readonly id?: JsonRpcId
  readonly jsonrpc: "2.0"
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
}
type LogicalMessage = AgentAcpClientMessage | AgentAcpServerMessage
type RpcDefinitions = Readonly<
  Record<string, { readonly request: string; readonly response: string }>
>
type NotificationDefinitions = Readonly<Record<string, { readonly notification: string }>>

type CodecDefinition = {
  readonly batchType?: string
  readonly cancelMethod: string
  readonly cancelType: string
  readonly clientNotifications: NotificationDefinitions
  readonly clientResponseTypeToMethod: Readonly<Record<string, string>>
  readonly clientRpc: RpcDefinitions
  readonly extensionNotificationType: string
  readonly extensionRequestType: string
  readonly extensionResponseType: string
  readonly serverNotificationTypeToMethod: Readonly<Record<string, string>>
  readonly serverRequestTypeToMethod: Readonly<Record<string, string>>
  readonly serverRpc: RpcDefinitions
}

const codecDefinitions: Record<1 | 2, CodecDefinition> = {
  1: {
    cancelMethod: "$/cancel_request",
    cancelType: "agent.acp.cancel_request.notification",
    clientNotifications: AGENT_ACP_V1_CLIENT_NOTIFICATIONS,
    clientResponseTypeToMethod: AGENT_ACP_V1_CLIENT_RESPONSE_TYPE_TO_METHOD,
    clientRpc: AGENT_ACP_V1_CLIENT_RPC,
    extensionNotificationType: "agent.acp.extension.notification",
    extensionRequestType: "agent.acp.extension.request",
    extensionResponseType: "agent.acp.extension.response",
    serverNotificationTypeToMethod: AGENT_ACP_V1_SERVER_NOTIFICATION_TYPE_TO_METHOD,
    serverRequestTypeToMethod: AGENT_ACP_V1_SERVER_REQUEST_TYPE_TO_METHOD,
    serverRpc: AGENT_ACP_V1_SERVER_RPC,
  },
  2: {
    batchType: "agent.acp.batch",
    cancelMethod: "$/cancel_request",
    cancelType: "agent.acp.cancel_request.notification",
    clientNotifications: AGENT_ACP_V2_CLIENT_NOTIFICATIONS,
    clientResponseTypeToMethod: AGENT_ACP_V2_CLIENT_RESPONSE_TYPE_TO_METHOD,
    clientRpc: AGENT_ACP_V2_CLIENT_RPC,
    extensionNotificationType: "agent.acp.extension.notification",
    extensionRequestType: "agent.acp.extension.request",
    extensionResponseType: "agent.acp.extension.response",
    serverNotificationTypeToMethod: AGENT_ACP_V2_SERVER_NOTIFICATION_TYPE_TO_METHOD,
    serverRequestTypeToMethod: AGENT_ACP_V2_SERVER_REQUEST_TYPE_TO_METHOD,
    serverRpc: AGENT_ACP_V2_SERVER_RPC,
  },
}

const endpointTransports = new WeakMap<AcpEndpoint, AcpEndpointTransport>()
const activeStreams = new WeakMap<AcpEndpoint, symbol>()

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requestIdKey = (id: JsonRpcId): string => `${typeof id}:${String(id)}`

const responsePayload = (message: RawMessage): Record<string, unknown> => {
  if (Object.hasOwn(message, "result")) return { requestId: message.id, result: message.result }
  if (Object.hasOwn(message, "error")) return { error: message.error, requestId: message.id }
  throw new TypeError("ACP response must contain result or error")
}

const rawResponse = (payload: unknown): RawMessage => {
  if (!isRecord(payload) || !("requestId" in payload)) {
    throw new TypeError("ACP logical response is missing requestId")
  }
  const { requestId, ...result } = payload
  return { id: requestId as JsonRpcId, jsonrpc: "2.0", ...result }
}

const createLogicalCodec = (version: 1 | 2, agent: RegistryAgentId) => {
  const definition = codecDefinitions[version]
  const inboundResponseTypes = new Map<string, string>()

  const encodeSingle = (message: RawMessage): AgentAcpClientMessage => {
    if (message.method !== undefined) {
      if (message.id !== undefined || Object.hasOwn(message, "id")) {
        const rpc = definition.clientRpc[message.method]
        if (rpc) {
          const params = isRecord(message.params) ? message.params : {}
          const logicalProtocolVersion =
            message.method === "initialize" && "protocolVersion" in params
              ? params.protocolVersion
              : version
          return AgentAcpClientMessageSchema.parse({
            ...params,
            agent,
            protocolVersion: logicalProtocolVersion,
            requestId: message.id,
            type: rpc.request,
          })
        }
        return AgentAcpClientMessageSchema.parse({
          agent,
          payload: {
            method: message.method,
            ...(message.params === undefined ? {} : { params: message.params }),
          },
          protocolVersion: version,
          requestId: message.id,
          type: definition.extensionRequestType,
        })
      }

      if (message.method === definition.cancelMethod) {
        return AgentAcpClientMessageSchema.parse({
          agent,
          payload: message.params,
          protocolVersion: version,
          type: definition.cancelType,
        })
      }
      const notification = definition.clientNotifications[message.method]
      if (notification) {
        return AgentAcpClientMessageSchema.parse({
          agent,
          payload: message.params,
          protocolVersion: version,
          type: notification.notification,
        })
      }
      return AgentAcpClientMessageSchema.parse({
        agent,
        payload: {
          method: message.method,
          ...(message.params === undefined ? {} : { params: message.params }),
        },
        protocolVersion: version,
        type: definition.extensionNotificationType,
      })
    }

    const responseId = message.id
    if (responseId === undefined) throw new TypeError("ACP response is missing id")
    const responseType = inboundResponseTypes.get(requestIdKey(responseId))
    if (!responseType)
      throw new TypeError(`ACP response has no matching inbound request: ${String(responseId)}`)
    inboundResponseTypes.delete(requestIdKey(responseId))
    return AgentAcpClientMessageSchema.parse({
      agent,
      payload: responsePayload(message),
      protocolVersion: version,
      type: responseType,
    })
  }

  const encode = (wire: unknown): AgentAcpClientMessage => {
    if (Array.isArray(wire)) {
      if (!definition.batchType) throw new TypeError("ACP v1 does not support JSON-RPC batches")
      return AgentAcpClientMessageSchema.parse({
        agent,
        payload: { messages: wire.map((message) => encodeSingle(message as RawMessage)) },
        protocolVersion: version,
        type: definition.batchType,
      })
    }
    return encodeSingle(wire as RawMessage)
  }

  const decodeSingle = (message: LogicalMessage): RawMessage => {
    const type = message.type
    if (type === definition.cancelType) {
      return {
        jsonrpc: "2.0",
        method: definition.cancelMethod,
        params: (message as { payload: unknown }).payload,
      }
    }
    if (type === definition.extensionRequestType) {
      const extension = message as {
        payload: { method: string; params?: unknown }
        requestId: JsonRpcId
      }
      inboundResponseTypes.set(requestIdKey(extension.requestId), definition.extensionResponseType)
      return {
        id: extension.requestId,
        jsonrpc: "2.0",
        method: extension.payload.method,
        ...(extension.payload.params === undefined ? {} : { params: extension.payload.params }),
      }
    }
    if (type === definition.extensionNotificationType) {
      const extension = message as { payload: { method: string; params?: unknown } }
      return {
        jsonrpc: "2.0",
        method: extension.payload.method,
        ...(extension.payload.params === undefined ? {} : { params: extension.payload.params }),
      }
    }
    if (type === definition.extensionResponseType) {
      return rawResponse((message as { payload: unknown }).payload)
    }

    const requestMethod = definition.serverRequestTypeToMethod[type]
    if (requestMethod) {
      const rpc = definition.serverRpc[requestMethod]
      if (!rpc) throw new TypeError(`Unknown ACP server request method: ${requestMethod}`)
      const request = message as { requestId: JsonRpcId; type: string } & Record<string, unknown>
      const { agent: _agent, protocolVersion, requestId, type: _type, ...params } = request
      const rawParams = requestMethod === "initialize" ? { ...params, protocolVersion } : params
      inboundResponseTypes.set(requestIdKey(requestId), rpc.response)
      return { id: requestId, jsonrpc: "2.0", method: requestMethod, params: rawParams }
    }
    if (definition.clientResponseTypeToMethod[type]) {
      return rawResponse((message as { payload: unknown }).payload)
    }
    const notificationMethod = definition.serverNotificationTypeToMethod[type]
    if (notificationMethod) {
      return {
        jsonrpc: "2.0",
        method: notificationMethod,
        params: (message as { payload: unknown }).payload,
      }
    }
    throw new TypeError(`Unsupported ACP v${version} logical message type: ${type}`)
  }

  const decode = (message: AgentAcpServerMessage): unknown => {
    if (message.type === definition.batchType) {
      return (message as { payload: { messages: LogicalMessage[] } }).payload.messages.map(
        decodeSingle
      )
    }
    return decodeSingle(message)
  }

  return { clear: () => inboundResponseTypes.clear(), decode, encode }
}

/** @internal Creates a stable public endpoint while retaining private lifecycle hooks. */
export const createAcpEndpoint = (
  agent: RegistryAgentId,
  transport: AcpEndpointTransport
): AcpEndpoint => {
  const endpoint: AcpEndpoint = {
    agent,
    send: (message) => transport.send(message),
    subscribe: (handler) => transport.subscribe(handler),
  }
  endpointTransports.set(endpoint, transport)
  return endpoint
}

const createBridgeStream = <OutgoingMessage, IncomingMessage>(
  endpoint: AcpEndpoint,
  protocolVersion: 1 | 2,
  onClose: () => void
): BridgeStream<OutgoingMessage, IncomingMessage> => {
  const transport: AcpEndpointTransport = endpointTransports.get(endpoint) ?? endpoint
  const codec = createLogicalCodec(protocolVersion, endpoint.agent)
  let active = true
  let controller: ReadableStreamDefaultController<IncomingMessage> | undefined
  let unsubscribeMessages: (() => void) | undefined
  let unsubscribeStatus: (() => void) | undefined

  const cleanup = (): void => {
    if (!active) return
    active = false
    codec.clear()
    unsubscribeMessages?.()
    unsubscribeMessages = undefined
    unsubscribeStatus?.()
    unsubscribeStatus = undefined
    onClose()
  }

  const terminate = (error?: unknown): void => {
    if (!active) return
    const readableController = controller
    cleanup()
    if (!readableController) return
    try {
      if (error === undefined) readableController.close()
      else readableController.error(error)
    } catch {
      // The ACP connection may already have cancelled its reader.
    }
  }

  const readable = new ReadableStream<IncomingMessage>({
    start(readableController) {
      controller = readableController
      const removeMessages = transport.subscribe((message) => {
        if (
          !active ||
          message.protocolVersion !== protocolVersion ||
          message.agent !== endpoint.agent
        )
          return
        try {
          readableController.enqueue(codec.decode(message) as IncomingMessage)
        } catch (error) {
          terminate(error)
        }
      })
      if (active) unsubscribeMessages = removeMessages
      else removeMessages()

      const removeStatus = transport.subscribeConnectionStatus?.((state) => {
        if (state.status === "disconnected") {
          terminate(new Error(`Cypheria connection disconnected: ${state.reason}`))
        } else if (state.status === "disposed") {
          terminate(new Error("Cypheria client closed"))
        }
      })
      if (active) unsubscribeStatus = removeStatus
      else removeStatus?.()
    },
    cancel() {
      cleanup()
    },
  })

  const writable = new WritableStream<OutgoingMessage>({
    async write(message) {
      if (!active) throw new Error("Cypheria ACP connection is closed")
      try {
        await transport.send(codec.encode(message))
      } catch (error) {
        const failure = asError(error, "Failed to send Cypheria ACP message")
        terminate(failure)
        throw failure
      }
    },
    close() {
      terminate()
    },
    abort(reason) {
      terminate(reason)
    },
  })

  return { close: terminate, readable, writable }
}

const openStream = <Stream extends { close(error?: unknown): void }>(
  endpoint: AcpEndpoint,
  create: (onClose: () => void) => Stream
): Stream => {
  if (activeStreams.has(endpoint)) {
    throw new Error("This Cypheria ACP endpoint already has an active connection")
  }
  const token = Symbol("cypheria-acp-connection")
  activeStreams.set(endpoint, token)
  try {
    return create(() => {
      if (activeStreams.get(endpoint) === token) activeStreams.delete(endpoint)
    })
  } catch (error) {
    if (activeStreams.get(endpoint) === token) activeStreams.delete(endpoint)
    throw error
  }
}

/** @internal Opens the SDK's stable stream behind a Cypheria ACP endpoint. */
export const openAcpV1Stream = (
  endpoint: AcpEndpoint
): AcpV1.Stream & BridgeStream<AcpV1ClientMessage, AcpV1AgentMessage> =>
  openStream(endpoint, (onClose) =>
    createBridgeStream<AcpV1ClientMessage, AcpV1AgentMessage>(
      endpoint,
      ACP_V1_PROTOCOL_VERSION,
      onClose
    )
  )

/** @internal Opens the SDK's draft-v2 stream behind a Cypheria ACP endpoint. */
export const openAcpV2Stream = (
  endpoint: AcpEndpoint
): AcpV2.Stream & BridgeStream<AcpV2ClientWireMessage, AcpV2AgentWireMessage> =>
  openStream(endpoint, (onClose) =>
    createBridgeStream<AcpV2ClientWireMessage, AcpV2AgentWireMessage>(
      endpoint,
      ACP_V2_PROTOCOL_VERSION,
      onClose
    )
  )
