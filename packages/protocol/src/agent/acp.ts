import {
  PROTOCOL_VERSION as ACP_V1_SDK_PROTOCOL_VERSION,
  type AgentNotification as AcpV1SdkAgentNotification,
  type AgentRequest as AcpV1SdkAgentRequest,
  type AgentResponse as AcpV1SdkAgentResponse,
  type ClientNotification as AcpV1SdkClientNotification,
  type ClientRequest as AcpV1SdkClientRequest,
  type ClientResponse as AcpV1SdkClientResponse,
  type AnyMessage as AcpV1SdkMessage,
} from "@agentclientprotocol/sdk"
import {
  PROTOCOL_VERSION as ACP_V2_SDK_PROTOCOL_VERSION,
  type AgentNotification as AcpV2SdkAgentNotification,
  type AgentRequest as AcpV2SdkAgentRequest,
  type AgentResponse as AcpV2SdkAgentResponse,
  type ClientNotification as AcpV2SdkClientNotification,
  type ClientRequest as AcpV2SdkClientRequest,
  type ClientResponse as AcpV2SdkClientResponse,
  type AnyWireMessage as AcpV2SdkWireMessage,
} from "@agentclientprotocol/sdk/experimental/v2"
import * as acpV2Zod from "@agentclientprotocol/sdk/experimental/v2/zod"
import * as acpV1Zod from "@agentclientprotocol/sdk/zod"
import { z } from "zod"
import {
  AGENT_ACP_V1_CLIENT_NOTIFICATION_SCHEMAS,
  AGENT_ACP_V1_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V1_CLIENT_REQUEST_SCHEMAS,
  AGENT_ACP_V1_CLIENT_RESPONSE_SCHEMAS,
  AGENT_ACP_V1_CLIENT_RPC,
  AGENT_ACP_V1_SERVER_NOTIFICATION_SCHEMAS,
  AGENT_ACP_V1_SERVER_NOTIFICATIONS,
  AGENT_ACP_V1_SERVER_REQUEST_SCHEMAS,
  AGENT_ACP_V1_SERVER_RESPONSE_SCHEMAS,
  AGENT_ACP_V1_SERVER_RPC,
  AGENT_ACP_V2_CLIENT_NOTIFICATION_SCHEMAS,
  AGENT_ACP_V2_CLIENT_NOTIFICATIONS,
  AGENT_ACP_V2_CLIENT_REQUEST_SCHEMAS,
  AGENT_ACP_V2_CLIENT_RESPONSE_SCHEMAS,
  AGENT_ACP_V2_CLIENT_RPC,
  AGENT_ACP_V2_SERVER_NOTIFICATION_SCHEMAS,
  AGENT_ACP_V2_SERVER_NOTIFICATIONS,
  AGENT_ACP_V2_SERVER_REQUEST_SCHEMAS,
  AGENT_ACP_V2_SERVER_RESPONSE_SCHEMAS,
  AGENT_ACP_V2_SERVER_RPC,
  type AgentAcpV1ClientNotification,
  type AgentAcpV1ClientRequest,
  type AgentAcpV1ClientResponse,
  type AgentAcpV1ServerNotification,
  type AgentAcpV1ServerRequest,
  type AgentAcpV1ServerResponse,
  type AgentAcpV2ClientNotification,
  type AgentAcpV2ClientRequest,
  type AgentAcpV2ClientResponse,
  type AgentAcpV2ServerNotification,
  type AgentAcpV2ServerRequest,
  type AgentAcpV2ServerResponse,
} from "../generated/acp/messages.ts"
import {
  AcpJsonRpcIdSchema,
  acpDiscriminatedUnion,
  acpResponseSchema,
} from "./acp-schema-registry.ts"
import { RegistryAgentIdSchema } from "./registry.ts"

export * from "../generated/acp/messages.ts"
export { AcpErrorResponseSchema, AcpJsonRpcIdSchema } from "./acp-schema-registry.ts"

export const ACP_V1_PROTOCOL_VERSION = ACP_V1_SDK_PROTOCOL_VERSION
export const ACP_V2_PROTOCOL_VERSION = ACP_V2_SDK_PROTOCOL_VERSION
export const ACP_PREFERRED_PROTOCOL_VERSION = ACP_V2_PROTOCOL_VERSION

export const AcpProtocolVersionSchema = z.literal([
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
])
export type AcpProtocolVersion = z.infer<typeof AcpProtocolVersionSchema>

export type AcpNegotiatedInitializeResult =
  | {
      protocolVersion: typeof ACP_V1_PROTOCOL_VERSION
      result: z.output<typeof acpV1Zod.zInitializeResponse>
    }
  | {
      protocolVersion: typeof ACP_V2_PROTOCOL_VERSION
      result: z.output<typeof acpV2Zod.zInitializeResponse>
    }

export const parseAcpNegotiatedInitializeResult = (
  value: unknown
): AcpNegotiatedInitializeResult => {
  const protocolVersion =
    value && typeof value === "object" && "protocolVersion" in value
      ? (value as { protocolVersion?: unknown }).protocolVersion
      : undefined
  if (protocolVersion === ACP_V1_PROTOCOL_VERSION) {
    return { protocolVersion, result: acpV1Zod.zInitializeResponse.parse(value) }
  }
  if (protocolVersion === ACP_V2_PROTOCOL_VERSION) {
    return { protocolVersion, result: acpV2Zod.zInitializeResponse.parse(value) }
  }
  throw new Error(`Unsupported ACP protocol version negotiated: ${String(protocolVersion)}`)
}

type WithJsonRpc<T> = T extends unknown ? T & { jsonrpc: "2.0" } : never

// These aliases describe the raw ACP SDK stream on either side of the logical-message adapter.
export type AcpV1ClientRequest = WithJsonRpc<AcpV1SdkClientRequest>
export type AcpV1ClientResponse = WithJsonRpc<AcpV1SdkClientResponse>
export type AcpV1ClientNotification = WithJsonRpc<AcpV1SdkClientNotification>
export type AcpV1ClientMessage = AcpV1SdkMessage
export type AcpV1AgentRequest = WithJsonRpc<AcpV1SdkAgentRequest>
export type AcpV1AgentResponse = WithJsonRpc<AcpV1SdkAgentResponse>
export type AcpV1AgentNotification = WithJsonRpc<AcpV1SdkAgentNotification>
export type AcpV1AgentMessage = AcpV1SdkMessage
export type AcpV1WireMessage = AcpV1SdkMessage

export type AcpV2ClientRequest = WithJsonRpc<AcpV2SdkClientRequest>
export type AcpV2ClientResponse = WithJsonRpc<AcpV2SdkClientResponse>
export type AcpV2ClientNotification = WithJsonRpc<AcpV2SdkClientNotification>
export type AcpV2ClientMessage = AcpV2SdkWireMessage
export type AcpV2ClientWireMessage = AcpV2SdkWireMessage
export type AcpV2AgentRequest = WithJsonRpc<AcpV2SdkAgentRequest>
export type AcpV2AgentResponse = WithJsonRpc<AcpV2SdkAgentResponse>
export type AcpV2AgentNotification = WithJsonRpc<AcpV2SdkAgentNotification>
export type AcpV2AgentMessage = AcpV2SdkWireMessage
export type AcpV2AgentWireMessage = AcpV2SdkWireMessage
export type AcpV2WireMessage = AcpV2SdkWireMessage

const methodByType = <T extends Record<string, Record<K, string>>, K extends string>(
  record: T,
  key: K
): Record<T[keyof T][K], keyof T & string> =>
  Object.fromEntries(
    Object.entries(record).map(([method, definition]) => [definition[key], method])
  ) as Record<T[keyof T][K], keyof T & string>

const notificationTypeByMethod = <T extends Record<string, { notification: string }>>(
  record: T
): { readonly [Method in keyof T]: T[Method]["notification"] } =>
  Object.fromEntries(
    Object.entries(record).map(([method, definition]) => [method, definition.notification])
  ) as { readonly [Method in keyof T]: T[Method]["notification"] }

export const AGENT_ACP_LOGICAL_CODECS = {
  1: {
    clientNotificationByType: methodByType(AGENT_ACP_V1_CLIENT_NOTIFICATIONS, "notification"),
    clientRequestByType: methodByType(AGENT_ACP_V1_CLIENT_RPC, "request"),
    clientRpc: AGENT_ACP_V1_CLIENT_RPC,
    serverNotificationByMethod: notificationTypeByMethod(AGENT_ACP_V1_SERVER_NOTIFICATIONS),
    serverResponseByType: methodByType(AGENT_ACP_V1_SERVER_RPC, "response"),
    serverRpc: AGENT_ACP_V1_SERVER_RPC,
  },
  2: {
    clientNotificationByType: methodByType(AGENT_ACP_V2_CLIENT_NOTIFICATIONS, "notification"),
    clientRequestByType: methodByType(AGENT_ACP_V2_CLIENT_RPC, "request"),
    clientRpc: AGENT_ACP_V2_CLIENT_RPC,
    serverNotificationByMethod: notificationTypeByMethod(AGENT_ACP_V2_SERVER_NOTIFICATIONS),
    serverResponseByType: methodByType(AGENT_ACP_V2_SERVER_RPC, "response"),
    serverRpc: AGENT_ACP_V2_SERVER_RPC,
  },
} as const

export type AcpLogicalCodec = {
  readonly clientNotificationByType: Readonly<Record<string, string>>
  readonly clientRequestByType: Readonly<Record<string, string>>
  readonly clientRpc: Readonly<Record<string, { readonly response: string }>>
  readonly serverNotificationByMethod: Readonly<Record<string, string>>
  readonly serverResponseByType: Readonly<Record<string, string>>
  readonly serverRpc: Readonly<Record<string, { readonly request: string }>>
}

export const getAcpLogicalCodec = (protocolVersion: AcpProtocolVersion): AcpLogicalCodec =>
  AGENT_ACP_LOGICAL_CODECS[protocolVersion] as unknown as AcpLogicalCodec

export const AGENT_ACP_V1_CLIENT_RESPONSE_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V1_CLIENT_RPC,
  "response"
)
export const AGENT_ACP_V1_SERVER_REQUEST_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V1_SERVER_RPC,
  "request"
)
export const AGENT_ACP_V1_SERVER_NOTIFICATION_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V1_SERVER_NOTIFICATIONS,
  "notification"
)
export const AGENT_ACP_V2_CLIENT_RESPONSE_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V2_CLIENT_RPC,
  "response"
)
export const AGENT_ACP_V2_SERVER_REQUEST_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V2_SERVER_RPC,
  "request"
)
export const AGENT_ACP_V2_SERVER_NOTIFICATION_TYPE_TO_METHOD = methodByType(
  AGENT_ACP_V2_SERVER_NOTIFICATIONS,
  "notification"
)

const extensionPayloadSchema = z.object({
  method: z.string().startsWith("_"),
  params: z.json().optional(),
})

const extensionRequestSchema = <const ProtocolVersion extends 1 | 2, const Type extends string>(
  protocolVersion: ProtocolVersion,
  type: Type
) =>
  z.object({
    agent: RegistryAgentIdSchema,
    payload: extensionPayloadSchema,
    protocolVersion: z.literal(protocolVersion),
    requestId: AcpJsonRpcIdSchema,
    type: z.literal(type),
  })

const extensionNotificationSchema = <
  const ProtocolVersion extends 1 | 2,
  const Type extends string,
>(
  protocolVersion: ProtocolVersion,
  type: Type
) =>
  z.object({
    agent: RegistryAgentIdSchema,
    payload: extensionPayloadSchema,
    protocolVersion: z.literal(protocolVersion),
    type: z.literal(type),
  })

export const AgentAcpV1ExtensionRequestSchema = extensionRequestSchema(
  1,
  "agent.acp.extension.request"
)
export const AgentAcpV1ExtensionResponseSchema = acpResponseSchema(
  1,
  "agent.acp.extension.response",
  z.json(),
  false
)
export const AgentAcpV1ExtensionNotificationSchema = extensionNotificationSchema(
  1,
  "agent.acp.extension.notification"
)
export const AgentAcpV2ExtensionRequestSchema = extensionRequestSchema(
  2,
  "agent.acp.extension.request"
)
export const AgentAcpV2ExtensionResponseSchema = acpResponseSchema(
  2,
  "agent.acp.extension.response",
  z.json(),
  false
)
export const AgentAcpV2ExtensionNotificationSchema = extensionNotificationSchema(
  2,
  "agent.acp.extension.notification"
)

export type AgentAcpV1ExtensionRequest = z.infer<typeof AgentAcpV1ExtensionRequestSchema>
export type AgentAcpV1ExtensionResponse = z.infer<typeof AgentAcpV1ExtensionResponseSchema>
export type AgentAcpV1ExtensionNotification = z.infer<typeof AgentAcpV1ExtensionNotificationSchema>
export type AgentAcpV2ExtensionRequest = z.infer<typeof AgentAcpV2ExtensionRequestSchema>
export type AgentAcpV2ExtensionResponse = z.infer<typeof AgentAcpV2ExtensionResponseSchema>
export type AgentAcpV2ExtensionNotification = z.infer<typeof AgentAcpV2ExtensionNotificationSchema>

export const AgentAcpV1CancelRequestNotificationSchema = z.object({
  agent: RegistryAgentIdSchema,
  payload: acpV1Zod.zCancelRequestNotification,
  protocolVersion: z.literal(1),
  type: z.literal("agent.acp.cancel_request.notification"),
})
export const AgentAcpV2CancelRequestNotificationSchema = z.object({
  agent: RegistryAgentIdSchema,
  payload: acpV2Zod.zCancelRequestNotification,
  protocolVersion: z.literal(2),
  type: z.literal("agent.acp.cancel_request.notification"),
})
export type AgentAcpV1CancelRequestNotification = z.infer<
  typeof AgentAcpV1CancelRequestNotificationSchema
>
export type AgentAcpV2CancelRequestNotification = z.infer<
  typeof AgentAcpV2CancelRequestNotificationSchema
>

type AgentAcpV1ClientSingleMessage =
  | AgentAcpV1ClientRequest
  | AgentAcpV1ClientResponse
  | AgentAcpV1ClientNotification
  | AgentAcpV1CancelRequestNotification
  | AgentAcpV1ExtensionRequest
  | AgentAcpV1ExtensionResponse
  | AgentAcpV1ExtensionNotification
type AgentAcpV1ServerSingleMessage =
  | AgentAcpV1ServerRequest
  | AgentAcpV1ServerResponse
  | AgentAcpV1ServerNotification
  | AgentAcpV1CancelRequestNotification
  | AgentAcpV1ExtensionRequest
  | AgentAcpV1ExtensionResponse
  | AgentAcpV1ExtensionNotification
type AgentAcpV2ClientSingleMessage =
  | AgentAcpV2ClientRequest
  | AgentAcpV2ClientResponse
  | AgentAcpV2ClientNotification
  | AgentAcpV2CancelRequestNotification
  | AgentAcpV2ExtensionRequest
  | AgentAcpV2ExtensionResponse
  | AgentAcpV2ExtensionNotification
type AgentAcpV2ServerSingleMessage =
  | AgentAcpV2ServerRequest
  | AgentAcpV2ServerResponse
  | AgentAcpV2ServerNotification
  | AgentAcpV2CancelRequestNotification
  | AgentAcpV2ExtensionRequest
  | AgentAcpV2ExtensionResponse
  | AgentAcpV2ExtensionNotification

const AGENT_ACP_V1_CLIENT_SINGLE_SCHEMAS = [
  ...Object.values(AGENT_ACP_V1_CLIENT_REQUEST_SCHEMAS),
  ...Object.values(AGENT_ACP_V1_CLIENT_RESPONSE_SCHEMAS),
  ...Object.values(AGENT_ACP_V1_CLIENT_NOTIFICATION_SCHEMAS),
  AgentAcpV1CancelRequestNotificationSchema,
  AgentAcpV1ExtensionRequestSchema,
  AgentAcpV1ExtensionResponseSchema,
  AgentAcpV1ExtensionNotificationSchema,
] as const
const AGENT_ACP_V1_SERVER_SINGLE_SCHEMAS = [
  ...Object.values(AGENT_ACP_V1_SERVER_REQUEST_SCHEMAS),
  ...Object.values(AGENT_ACP_V1_SERVER_RESPONSE_SCHEMAS),
  ...Object.values(AGENT_ACP_V1_SERVER_NOTIFICATION_SCHEMAS),
  AgentAcpV1CancelRequestNotificationSchema,
  AgentAcpV1ExtensionRequestSchema,
  AgentAcpV1ExtensionResponseSchema,
  AgentAcpV1ExtensionNotificationSchema,
] as const
const AGENT_ACP_V2_CLIENT_SINGLE_SCHEMAS = [
  ...Object.values(AGENT_ACP_V2_CLIENT_REQUEST_SCHEMAS),
  ...Object.values(AGENT_ACP_V2_CLIENT_RESPONSE_SCHEMAS),
  ...Object.values(AGENT_ACP_V2_CLIENT_NOTIFICATION_SCHEMAS),
  AgentAcpV2CancelRequestNotificationSchema,
  AgentAcpV2ExtensionRequestSchema,
  AgentAcpV2ExtensionResponseSchema,
  AgentAcpV2ExtensionNotificationSchema,
] as const
const AGENT_ACP_V2_SERVER_SINGLE_SCHEMAS = [
  ...Object.values(AGENT_ACP_V2_SERVER_REQUEST_SCHEMAS),
  ...Object.values(AGENT_ACP_V2_SERVER_RESPONSE_SCHEMAS),
  ...Object.values(AGENT_ACP_V2_SERVER_NOTIFICATION_SCHEMAS),
  AgentAcpV2CancelRequestNotificationSchema,
  AgentAcpV2ExtensionRequestSchema,
  AgentAcpV2ExtensionResponseSchema,
  AgentAcpV2ExtensionNotificationSchema,
] as const

export const AgentAcpV1ClientSingleMessageSchema =
  acpDiscriminatedUnion<AgentAcpV1ClientSingleMessage>("type", AGENT_ACP_V1_CLIENT_SINGLE_SCHEMAS)
export const AgentAcpV1ServerSingleMessageSchema =
  acpDiscriminatedUnion<AgentAcpV1ServerSingleMessage>("type", AGENT_ACP_V1_SERVER_SINGLE_SCHEMAS)
export const AgentAcpV2ClientSingleMessageSchema =
  acpDiscriminatedUnion<AgentAcpV2ClientSingleMessage>("type", AGENT_ACP_V2_CLIENT_SINGLE_SCHEMAS)
export const AgentAcpV2ServerSingleMessageSchema =
  acpDiscriminatedUnion<AgentAcpV2ServerSingleMessage>("type", AGENT_ACP_V2_SERVER_SINGLE_SCHEMAS)

const acpBatchMessagesSchema = <const Type extends string, Message>(
  type: Type,
  messageSchema: z.ZodType<Message>,
  initializeType: string
) =>
  z
    .object({
      agent: RegistryAgentIdSchema,
      payload: z
        .object({ messages: z.array(messageSchema).nonempty() })
        .superRefine(({ messages }, context) => {
          const agents = new Set(messages.map((message) => (message as { agent: string }).agent))
          if (agents.size !== 1) {
            context.addIssue({ code: "custom", message: "ACP batch entries must use one agent" })
          }
          const responseCount = messages.filter((message) =>
            (message as { type: string }).type.endsWith(".response")
          ).length
          if (responseCount > 0 && responseCount !== messages.length) {
            context.addIssue({
              code: "custom",
              message: "ACP batch cannot mix calls and responses",
            })
          }
          if (
            messages.some((message) => (message as { type: string }).type === initializeType) &&
            messages.length !== 1
          ) {
            context.addIssue({
              code: "custom",
              message: "ACP initialize must be the only entry in its batch",
            })
          }
        }),
      protocolVersion: z.literal(2),
      type: z.literal(type),
    })
    .superRefine(({ agent, payload }, context) => {
      if (payload.messages.some((message) => (message as { agent: string }).agent !== agent)) {
        context.addIssue({ code: "custom", message: "ACP batch agent must match every entry" })
      }
    })

export const AgentAcpV2ClientBatchMessagesSchema = acpBatchMessagesSchema(
  "agent.acp.batch",
  AgentAcpV2ClientSingleMessageSchema,
  AGENT_ACP_V2_CLIENT_RPC.initialize.request
)
export const AgentAcpV2ServerBatchMessagesSchema = acpBatchMessagesSchema(
  "agent.acp.batch",
  AgentAcpV2ServerSingleMessageSchema,
  AGENT_ACP_V2_CLIENT_RPC.initialize.response
)
export type AgentAcpV2ClientBatchMessages = z.infer<typeof AgentAcpV2ClientBatchMessagesSchema>
export type AgentAcpV2ServerBatchMessages = z.infer<typeof AgentAcpV2ServerBatchMessagesSchema>

export type AgentAcpClientMessage =
  | AgentAcpV1ClientSingleMessage
  | AgentAcpV2ClientSingleMessage
  | AgentAcpV2ClientBatchMessages
export type AgentAcpServerMessage =
  | AgentAcpV1ServerSingleMessage
  | AgentAcpV2ServerSingleMessage
  | AgentAcpV2ServerBatchMessages

type AgentAcpV2ClientMessage = AgentAcpV2ClientSingleMessage | AgentAcpV2ClientBatchMessages
type AgentAcpV2ServerMessage = AgentAcpV2ServerSingleMessage | AgentAcpV2ServerBatchMessages

export const AgentAcpV2ClientMessageSchema = acpDiscriminatedUnion<AgentAcpV2ClientMessage>(
  "type",
  [AgentAcpV2ClientSingleMessageSchema, AgentAcpV2ClientBatchMessagesSchema]
)
export const AgentAcpV2ServerMessageSchema = acpDiscriminatedUnion<AgentAcpV2ServerMessage>(
  "type",
  [AgentAcpV2ServerSingleMessageSchema, AgentAcpV2ServerBatchMessagesSchema]
)

export const AgentAcpClientMessageSchema = acpDiscriminatedUnion<AgentAcpClientMessage>(
  "protocolVersion",
  [AgentAcpV1ClientSingleMessageSchema, AgentAcpV2ClientMessageSchema]
)
export const AgentAcpServerMessageSchema = acpDiscriminatedUnion<AgentAcpServerMessage>(
  "protocolVersion",
  [AgentAcpV1ServerSingleMessageSchema, AgentAcpV2ServerMessageSchema]
)

/** Narrows an adapter message to one of the direct ACP server messages. */
export const isAgentAcpServerMessage = (message: unknown): message is AgentAcpServerMessage =>
  AgentAcpServerMessageSchema.safeParse(message).success
