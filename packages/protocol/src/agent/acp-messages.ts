import {
  AGENT_METHODS as ACP_V1_AGENT_METHODS,
  CLIENT_METHODS as ACP_V1_CLIENT_METHODS,
  PROTOCOL_METHODS as ACP_V1_PROTOCOL_METHODS,
  PROTOCOL_VERSION as ACP_V1_SDK_PROTOCOL_VERSION,
  type AgentNotificationMethod as AcpV1AgentNotificationMethod,
  type AgentNotificationParamsByMethod as AcpV1AgentNotificationParamsByMethod,
  type AgentRequestMethod as AcpV1AgentRequestMethod,
  type AgentRequestParamsByMethod as AcpV1AgentRequestParamsByMethod,
  type CancelRequestNotification as AcpV1CancelRequestNotification,
  type ClientNotificationMethod as AcpV1ClientNotificationMethod,
  type ClientNotificationParamsByMethod as AcpV1ClientNotificationParamsByMethod,
  type ClientRequestMethod as AcpV1ClientRequestMethod,
  type ClientRequestParamsByMethod as AcpV1ClientRequestParamsByMethod,
  type AgentNotification as AcpV1SdkAgentNotification,
  type AgentRequest as AcpV1SdkAgentRequest,
  type AgentResponse as AcpV1SdkAgentResponse,
  type ClientNotification as AcpV1SdkClientNotification,
  type ClientRequest as AcpV1SdkClientRequest,
  type ClientResponse as AcpV1SdkClientResponse,
  type AnyMessage as AcpV1SdkMessage,
} from "@agentclientprotocol/sdk"
import {
  AGENT_METHODS as ACP_V2_AGENT_METHODS,
  CLIENT_METHODS as ACP_V2_CLIENT_METHODS,
  PROTOCOL_METHODS as ACP_V2_PROTOCOL_METHODS,
  PROTOCOL_VERSION as ACP_V2_SDK_PROTOCOL_VERSION,
  type AgentNotificationMethod as AcpV2AgentNotificationMethod,
  type AgentNotificationParamsByMethod as AcpV2AgentNotificationParamsByMethod,
  type AgentRequestMethod as AcpV2AgentRequestMethod,
  type AgentRequestParamsByMethod as AcpV2AgentRequestParamsByMethod,
  type CancelRequestNotification as AcpV2CancelRequestNotification,
  type ClientNotificationMethod as AcpV2ClientNotificationMethod,
  type ClientNotificationParamsByMethod as AcpV2ClientNotificationParamsByMethod,
  type ClientRequestMethod as AcpV2ClientRequestMethod,
  type ClientRequestParamsByMethod as AcpV2ClientRequestParamsByMethod,
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

export const ACP_V1_PROTOCOL_VERSION = ACP_V1_SDK_PROTOCOL_VERSION
export const ACP_V2_PROTOCOL_VERSION = ACP_V2_SDK_PROTOCOL_VERSION

export const AcpProtocolVersionSchema = z.literal([
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
])
export type AcpProtocolVersion = z.infer<typeof AcpProtocolVersionSchema>

type WithJsonRpc<T> = T extends unknown ? T & { jsonrpc: "2.0" } : never
type NonEmptyBatch<T> = readonly [T, ...T[]]

export type AcpV1ProtocolNotification = {
  jsonrpc: "2.0"
  method: typeof ACP_V1_PROTOCOL_METHODS.cancel_request
  params?: AcpV1CancelRequestNotification | null
}

export type AcpV2ProtocolNotification = {
  jsonrpc: "2.0"
  method: typeof ACP_V2_PROTOCOL_METHODS.cancel_request
  params?: AcpV2CancelRequestNotification | null
}

export type AcpV1ClientRequest = WithJsonRpc<AcpV1SdkClientRequest>
export type AcpV1ClientResponse = WithJsonRpc<AcpV1SdkClientResponse>
export type AcpV1ClientNotification = WithJsonRpc<AcpV1SdkClientNotification>
export type AcpV1ClientMessage =
  | AcpV1ClientRequest
  | AcpV1ClientResponse
  | AcpV1ClientNotification
  | AcpV1ProtocolNotification

export type AcpV1AgentRequest = WithJsonRpc<AcpV1SdkAgentRequest>
export type AcpV1AgentResponse = WithJsonRpc<AcpV1SdkAgentResponse>
export type AcpV1AgentNotification = WithJsonRpc<AcpV1SdkAgentNotification>
export type AcpV1AgentMessage =
  | AcpV1AgentRequest
  | AcpV1AgentResponse
  | AcpV1AgentNotification
  | AcpV1ProtocolNotification

export type AcpV1WireMessage = AcpV1SdkMessage

export type AcpV2ClientCall =
  | AcpV2ClientRequest
  | AcpV2ClientNotification
  | AcpV2ProtocolNotification
export type AcpV2ClientRequest = WithJsonRpc<AcpV2SdkClientRequest>
export type AcpV2ClientResponse = WithJsonRpc<AcpV2SdkClientResponse>
export type AcpV2ClientNotification = WithJsonRpc<AcpV2SdkClientNotification>
export type AcpV2ClientMessage = AcpV2ClientCall | AcpV2ClientResponse
export type AcpV2ClientWireMessage =
  | AcpV2ClientMessage
  | NonEmptyBatch<AcpV2ClientCall>
  | NonEmptyBatch<AcpV2ClientResponse>

export type AcpV2AgentCall = AcpV2AgentRequest | AcpV2AgentNotification | AcpV2ProtocolNotification
export type AcpV2AgentRequest = WithJsonRpc<AcpV2SdkAgentRequest>
export type AcpV2AgentResponse = WithJsonRpc<AcpV2SdkAgentResponse>
export type AcpV2AgentNotification = WithJsonRpc<AcpV2SdkAgentNotification>
export type AcpV2AgentMessage = AcpV2AgentCall | AcpV2AgentResponse
export type AcpV2AgentWireMessage =
  | AcpV2AgentMessage
  | NonEmptyBatch<AcpV2AgentCall>
  | NonEmptyBatch<AcpV2AgentResponse>

export type AcpV2WireMessage = AcpV2SdkWireMessage

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isJsonRpcId = (value: unknown): value is string | number | null =>
  value === null ||
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value))

const isAcpJsonRpcMessage = (value: unknown): value is AcpV1WireMessage => {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return false

  if ("method" in value) {
    if (typeof value.method !== "string") return false
    if ("result" in value || "error" in value) return false
    return "id" in value ? isJsonRpcId(value.id) : true
  }

  if (!Object.hasOwn(value, "id") || !isJsonRpcId(value.id)) return false
  return Object.hasOwn(value, "result") !== Object.hasOwn(value, "error")
}

type ParamsSchemas = Readonly<Record<string, z.ZodType>>
type AcpMessageKind = "notification" | "request" | "response"
type SdkParamsSchemas<Method extends string, ParamsByMethod extends Record<Method, unknown>> = {
  readonly [Name in Method]: z.ZodType<ParamsByMethod[Name]>
}

const matchesSdkSchema = (
  value: unknown,
  schema: z.ZodType,
  kind: AcpMessageKind,
  paramsSchemas?: ParamsSchemas,
  knownMethods?: ReadonlySet<string>
): boolean => {
  if (!isAcpJsonRpcMessage(value) || !schema.safeParse(value).success) return false
  const actualKind = "method" in value ? ("id" in value ? "request" : "notification") : "response"
  if (actualKind !== kind) return false
  if (!paramsSchemas || !("method" in value)) return true

  const paramsSchema = paramsSchemas[value.method]
  if (paramsSchema) return paramsSchema.safeParse(value.params).success
  return !knownMethods?.has(value.method)
}

const sdkMessageSchema = <Message>(
  schema: z.ZodType,
  kind: AcpMessageKind,
  description: string,
  paramsSchemas?: ParamsSchemas,
  knownMethods?: ReadonlySet<string>
): z.ZodType<Message> =>
  z
    .json()
    .refine(
      (value) => matchesSdkSchema(value, schema, kind, paramsSchemas, knownMethods),
      `Invalid ${description}`
    ) as unknown as z.ZodType<Message>

const acpV1AgentRequestParams = {
  [ACP_V1_AGENT_METHODS.initialize]: acpV1Zod.zInitializeRequest,
  [ACP_V1_AGENT_METHODS.authenticate]: acpV1Zod.zAuthenticateRequest,
  [ACP_V1_AGENT_METHODS.providers_list]: acpV1Zod.zListProvidersRequest,
  [ACP_V1_AGENT_METHODS.providers_set]: acpV1Zod.zSetProviderRequest,
  [ACP_V1_AGENT_METHODS.providers_disable]: acpV1Zod.zDisableProviderRequest,
  [ACP_V1_AGENT_METHODS.logout]: acpV1Zod.zLogoutRequest,
  [ACP_V1_AGENT_METHODS.session_new]: acpV1Zod.zNewSessionRequest,
  [ACP_V1_AGENT_METHODS.session_load]: acpV1Zod.zLoadSessionRequest,
  [ACP_V1_AGENT_METHODS.session_list]: acpV1Zod.zListSessionsRequest,
  [ACP_V1_AGENT_METHODS.session_delete]: acpV1Zod.zDeleteSessionRequest,
  [ACP_V1_AGENT_METHODS.session_fork]: acpV1Zod.zForkSessionRequest,
  [ACP_V1_AGENT_METHODS.session_resume]: acpV1Zod.zResumeSessionRequest,
  [ACP_V1_AGENT_METHODS.session_close]: acpV1Zod.zCloseSessionRequest,
  [ACP_V1_AGENT_METHODS.session_set_mode]: acpV1Zod.zSetSessionModeRequest,
  [ACP_V1_AGENT_METHODS.session_set_config_option]: acpV1Zod.zSetSessionConfigOptionRequest,
  [ACP_V1_AGENT_METHODS.session_prompt]: acpV1Zod.zPromptRequest,
  [ACP_V1_AGENT_METHODS.nes_start]: acpV1Zod.zStartNesRequest,
  [ACP_V1_AGENT_METHODS.nes_suggest]: acpV1Zod.zSuggestNesRequest,
  [ACP_V1_AGENT_METHODS.nes_close]: acpV1Zod.zCloseNesRequest,
} satisfies SdkParamsSchemas<AcpV1AgentRequestMethod, AcpV1AgentRequestParamsByMethod>

const acpV1AgentNotificationParams = {
  [ACP_V1_AGENT_METHODS.session_cancel]: acpV1Zod.zCancelNotification,
  [ACP_V1_AGENT_METHODS.document_did_open]: acpV1Zod.zDidOpenDocumentNotification,
  [ACP_V1_AGENT_METHODS.document_did_change]: acpV1Zod.zDidChangeDocumentNotification,
  [ACP_V1_AGENT_METHODS.document_did_close]: acpV1Zod.zDidCloseDocumentNotification,
  [ACP_V1_AGENT_METHODS.document_did_save]: acpV1Zod.zDidSaveDocumentNotification,
  [ACP_V1_AGENT_METHODS.document_did_focus]: acpV1Zod.zDidFocusDocumentNotification,
  [ACP_V1_AGENT_METHODS.nes_accept]: acpV1Zod.zAcceptNesNotification,
  [ACP_V1_AGENT_METHODS.nes_reject]: acpV1Zod.zRejectNesNotification,
} satisfies SdkParamsSchemas<AcpV1AgentNotificationMethod, AcpV1AgentNotificationParamsByMethod>

const acpV1ClientRequestParams = {
  [ACP_V1_CLIENT_METHODS.session_request_permission]: acpV1Zod.zRequestPermissionRequest,
  [ACP_V1_CLIENT_METHODS.fs_write_text_file]: acpV1Zod.zWriteTextFileRequest,
  [ACP_V1_CLIENT_METHODS.fs_read_text_file]: acpV1Zod.zReadTextFileRequest,
  [ACP_V1_CLIENT_METHODS.terminal_create]: acpV1Zod.zCreateTerminalRequest,
  [ACP_V1_CLIENT_METHODS.terminal_output]: acpV1Zod.zTerminalOutputRequest,
  [ACP_V1_CLIENT_METHODS.terminal_release]: acpV1Zod.zReleaseTerminalRequest,
  [ACP_V1_CLIENT_METHODS.terminal_wait_for_exit]: acpV1Zod.zWaitForTerminalExitRequest,
  [ACP_V1_CLIENT_METHODS.terminal_kill]: acpV1Zod.zKillTerminalRequest,
  [ACP_V1_CLIENT_METHODS.elicitation_create]: acpV1Zod.zCreateElicitationRequest,
} satisfies SdkParamsSchemas<AcpV1ClientRequestMethod, AcpV1ClientRequestParamsByMethod>

const acpV1ClientNotificationParams = {
  [ACP_V1_CLIENT_METHODS.session_update]: acpV1Zod.zSessionNotification,
  [ACP_V1_CLIENT_METHODS.elicitation_complete]: acpV1Zod.zCompleteElicitationNotification,
} satisfies SdkParamsSchemas<AcpV1ClientNotificationMethod, AcpV1ClientNotificationParamsByMethod>

const acpV2AgentRequestParams = {
  [ACP_V2_AGENT_METHODS.initialize]: acpV2Zod.zInitializeRequest.refine(
    (request) => request.protocolVersion === ACP_V2_PROTOCOL_VERSION,
    `ACP v2 initialize requires protocolVersion ${ACP_V2_PROTOCOL_VERSION}`
  ),
  [ACP_V2_AGENT_METHODS.auth_login]: acpV2Zod.zLoginAuthRequest,
  [ACP_V2_AGENT_METHODS.auth_logout]: acpV2Zod.zLogoutAuthRequest,
  [ACP_V2_AGENT_METHODS.providers_list]: acpV2Zod.zListProvidersRequest,
  [ACP_V2_AGENT_METHODS.providers_set]: acpV2Zod.zSetProviderRequest,
  [ACP_V2_AGENT_METHODS.providers_disable]: acpV2Zod.zDisableProviderRequest,
  [ACP_V2_AGENT_METHODS.session_new]: acpV2Zod.zNewSessionRequest,
  [ACP_V2_AGENT_METHODS.session_list]: acpV2Zod.zListSessionsRequest,
  [ACP_V2_AGENT_METHODS.session_delete]: acpV2Zod.zDeleteSessionRequest,
  [ACP_V2_AGENT_METHODS.session_fork]: acpV2Zod.zForkSessionRequest,
  [ACP_V2_AGENT_METHODS.session_resume]: acpV2Zod.zResumeSessionRequest,
  [ACP_V2_AGENT_METHODS.session_close]: acpV2Zod.zCloseSessionRequest,
  [ACP_V2_AGENT_METHODS.session_set_config_option]: acpV2Zod.zSetSessionConfigOptionRequest,
  [ACP_V2_AGENT_METHODS.session_prompt]: acpV2Zod.zPromptRequest,
  [ACP_V2_AGENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpRequest,
  [ACP_V2_AGENT_METHODS.nes_start]: acpV2Zod.zStartNesRequest,
  [ACP_V2_AGENT_METHODS.nes_suggest]: acpV2Zod.zSuggestNesRequest,
  [ACP_V2_AGENT_METHODS.nes_close]: acpV2Zod.zCloseNesRequest,
} satisfies SdkParamsSchemas<AcpV2AgentRequestMethod, AcpV2AgentRequestParamsByMethod>

const acpV2AgentNotificationParams = {
  [ACP_V2_AGENT_METHODS.session_cancel]: acpV2Zod.zCancelSessionNotification,
  [ACP_V2_AGENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpNotification,
  [ACP_V2_AGENT_METHODS.document_did_open]: acpV2Zod.zDidOpenDocumentNotification,
  [ACP_V2_AGENT_METHODS.document_did_change]: acpV2Zod.zDidChangeDocumentNotification,
  [ACP_V2_AGENT_METHODS.document_did_close]: acpV2Zod.zDidCloseDocumentNotification,
  [ACP_V2_AGENT_METHODS.document_did_save]: acpV2Zod.zDidSaveDocumentNotification,
  [ACP_V2_AGENT_METHODS.document_did_focus]: acpV2Zod.zDidFocusDocumentNotification,
  [ACP_V2_AGENT_METHODS.nes_accept]: acpV2Zod.zAcceptNesNotification,
  [ACP_V2_AGENT_METHODS.nes_reject]: acpV2Zod.zRejectNesNotification,
} satisfies SdkParamsSchemas<AcpV2AgentNotificationMethod, AcpV2AgentNotificationParamsByMethod>

const acpV2ClientRequestParams = {
  [ACP_V2_CLIENT_METHODS.session_request_permission]: acpV2Zod.zRequestPermissionRequest,
  [ACP_V2_CLIENT_METHODS.mcp_connect]: acpV2Zod.zConnectMcpRequest,
  [ACP_V2_CLIENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpRequest,
  [ACP_V2_CLIENT_METHODS.mcp_disconnect]: acpV2Zod.zDisconnectMcpRequest,
  [ACP_V2_CLIENT_METHODS.elicitation_create]: acpV2Zod.zCreateElicitationRequest,
} satisfies SdkParamsSchemas<AcpV2ClientRequestMethod, AcpV2ClientRequestParamsByMethod>

const acpV2ClientNotificationParams = {
  [ACP_V2_CLIENT_METHODS.session_update]: acpV2Zod.zUpdateSessionNotification,
  [ACP_V2_CLIENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpNotification,
  [ACP_V2_CLIENT_METHODS.elicitation_complete]: acpV2Zod.zCompleteElicitationNotification,
} satisfies SdkParamsSchemas<AcpV2ClientNotificationMethod, AcpV2ClientNotificationParamsByMethod>

const acpV1KnownMethods = new Set<string>([
  ...Object.values(ACP_V1_AGENT_METHODS),
  ...Object.values(ACP_V1_CLIENT_METHODS),
  ...Object.values(ACP_V1_PROTOCOL_METHODS),
])
const acpV2KnownMethods = new Set<string>([
  ...Object.values(ACP_V2_AGENT_METHODS),
  ...Object.values(ACP_V2_CLIENT_METHODS),
  ...Object.values(ACP_V2_PROTOCOL_METHODS),
])

export const AcpV1ProtocolNotificationSchema = sdkMessageSchema<AcpV1ProtocolNotification>(
  z.looseObject({
    jsonrpc: z.literal("2.0"),
    method: z.literal(ACP_V1_PROTOCOL_METHODS.cancel_request),
    params: acpV1Zod.zCancelRequestNotification.nullish(),
  }),
  "notification",
  "ACP v1 protocol notification"
)

export const AcpV1ClientRequestSchema = sdkMessageSchema<AcpV1ClientRequest>(
  acpV1Zod.zClientRequest,
  "request",
  "ACP v1 client request",
  acpV1AgentRequestParams,
  acpV1KnownMethods
)
export const AcpV1ClientResponseSchema = sdkMessageSchema<AcpV1ClientResponse>(
  acpV1Zod.zClientResponse,
  "response",
  "ACP v1 client response"
)
export const AcpV1ClientNotificationSchema = sdkMessageSchema<AcpV1ClientNotification>(
  acpV1Zod.zClientNotification,
  "notification",
  "ACP v1 client notification",
  acpV1AgentNotificationParams,
  acpV1KnownMethods
)

export const AcpV1ClientMessageSchema = z.union([
  AcpV1ClientRequestSchema,
  AcpV1ClientResponseSchema,
  AcpV1ClientNotificationSchema,
  AcpV1ProtocolNotificationSchema,
]) as z.ZodType<AcpV1ClientMessage>

export const AcpV1AgentRequestSchema = sdkMessageSchema<AcpV1AgentRequest>(
  acpV1Zod.zAgentRequest,
  "request",
  "ACP v1 agent request",
  acpV1ClientRequestParams,
  acpV1KnownMethods
)
export const AcpV1AgentResponseSchema = sdkMessageSchema<AcpV1AgentResponse>(
  acpV1Zod.zAgentResponse,
  "response",
  "ACP v1 agent response"
)
export const AcpV1AgentNotificationSchema = sdkMessageSchema<AcpV1AgentNotification>(
  acpV1Zod.zAgentNotification,
  "notification",
  "ACP v1 agent notification",
  acpV1ClientNotificationParams,
  acpV1KnownMethods
)

export const AcpV1AgentMessageSchema = z.union([
  AcpV1AgentRequestSchema,
  AcpV1AgentResponseSchema,
  AcpV1AgentNotificationSchema,
  AcpV1ProtocolNotificationSchema,
]) as z.ZodType<AcpV1AgentMessage>

export const AcpV1WireMessageSchema = z.union([
  AcpV1ClientMessageSchema,
  AcpV1AgentMessageSchema,
]) as z.ZodType<AcpV1WireMessage>

export const AcpV2ProtocolNotificationSchema = sdkMessageSchema<AcpV2ProtocolNotification>(
  acpV2Zod.zProtocolLevelNotification.extend({
    method: z.literal(ACP_V2_PROTOCOL_METHODS.cancel_request),
    params: acpV2Zod.zCancelRequestNotification.nullish(),
  }),
  "notification",
  "ACP v2 protocol notification"
)

export const AcpV2ClientRequestSchema = sdkMessageSchema<AcpV2ClientRequest>(
  acpV2Zod.zClientRequest,
  "request",
  "ACP v2 client request",
  acpV2AgentRequestParams,
  acpV2KnownMethods
)
export const AcpV2ClientResponseSchema = sdkMessageSchema<AcpV2ClientResponse>(
  acpV2Zod.zClientResponse,
  "response",
  "ACP v2 client response"
)
export const AcpV2ClientNotificationSchema = sdkMessageSchema<AcpV2ClientNotification>(
  acpV2Zod.zClientNotification,
  "notification",
  "ACP v2 client notification",
  acpV2AgentNotificationParams,
  acpV2KnownMethods
)

export const AcpV2ClientCallSchema = z.union([
  AcpV2ClientRequestSchema,
  AcpV2ClientNotificationSchema,
  AcpV2ProtocolNotificationSchema,
]) as z.ZodType<AcpV2ClientCall>
export const AcpV2ClientMessageSchema = z.union([
  AcpV2ClientCallSchema,
  AcpV2ClientResponseSchema,
]) as z.ZodType<AcpV2ClientMessage>
const AcpV2ClientCallBatchSchema = z
  .tuple([AcpV2ClientCallSchema], AcpV2ClientCallSchema)
  .refine(
    (messages) =>
      !messages.some(
        (message) => "id" in message && message.method === ACP_V2_AGENT_METHODS.initialize
      ) || messages.length === 1,
    "ACP v2 initialize must be the only entry in its batch"
  )
export const AcpV2ClientWireMessageSchema = z.union([
  AcpV2ClientMessageSchema,
  AcpV2ClientCallBatchSchema,
  z.tuple([AcpV2ClientResponseSchema], AcpV2ClientResponseSchema),
]) as z.ZodType<AcpV2ClientWireMessage>

export const AcpV2AgentRequestSchema = sdkMessageSchema<AcpV2AgentRequest>(
  acpV2Zod.zAgentRequest,
  "request",
  "ACP v2 agent request",
  acpV2ClientRequestParams,
  acpV2KnownMethods
)
export const AcpV2AgentResponseSchema = sdkMessageSchema<AcpV2AgentResponse>(
  acpV2Zod.zAgentResponse,
  "response",
  "ACP v2 agent response"
)
export const AcpV2AgentNotificationSchema = sdkMessageSchema<AcpV2AgentNotification>(
  acpV2Zod.zAgentNotification,
  "notification",
  "ACP v2 agent notification",
  acpV2ClientNotificationParams,
  acpV2KnownMethods
)

export const AcpV2AgentCallSchema = z.union([
  AcpV2AgentRequestSchema,
  AcpV2AgentNotificationSchema,
  AcpV2ProtocolNotificationSchema,
]) as z.ZodType<AcpV2AgentCall>
export const AcpV2AgentMessageSchema = z.union([
  AcpV2AgentCallSchema,
  AcpV2AgentResponseSchema,
]) as z.ZodType<AcpV2AgentMessage>
export const AcpV2AgentWireMessageSchema = z.union([
  AcpV2AgentMessageSchema,
  z.tuple([AcpV2AgentCallSchema], AcpV2AgentCallSchema),
  z.tuple([AcpV2AgentResponseSchema], AcpV2AgentResponseSchema),
]) as z.ZodType<AcpV2AgentWireMessage>

export const AcpV2WireMessageSchema = z.union([
  AcpV2ClientWireMessageSchema,
  AcpV2AgentWireMessageSchema,
]) as z.ZodType<AcpV2WireMessage>

export const AcpWirePayloadSchema = z.discriminatedUnion("protocolVersion", [
  z.strictObject({
    protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
    message: AcpV1WireMessageSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
    message: AcpV2WireMessageSchema,
  }),
])
export type AcpWirePayload = z.infer<typeof AcpWirePayloadSchema>

export const AcpClientWirePayloadSchema = z.discriminatedUnion("protocolVersion", [
  z.strictObject({
    protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
    message: AcpV1ClientMessageSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
    message: AcpV2ClientWireMessageSchema,
  }),
])
export type AcpClientWirePayload = z.infer<typeof AcpClientWirePayloadSchema>

export const AcpServerWirePayloadSchema = z.discriminatedUnion("protocolVersion", [
  z.strictObject({
    protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
    message: AcpV1AgentMessageSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
    message: AcpV2AgentWireMessageSchema,
  }),
])
export type AcpServerWirePayload = z.infer<typeof AcpServerWirePayloadSchema>

/** ACP traffic sent by a Cypheria client to the server-owned agent connection. */
export const AgentAcpClientMessageSchema = z.strictObject({
  type: z.literal("agent.acp.client.message"),
  payload: AcpClientWirePayloadSchema,
})
export type AgentAcpClientMessage = z.infer<typeof AgentAcpClientMessageSchema>

/** ACP traffic sent by the server-owned agent connection to a Cypheria client. */
export const AgentAcpServerMessageSchema = z.strictObject({
  type: z.literal("agent.acp.server.message"),
  payload: AcpServerWirePayloadSchema,
})
export type AgentAcpServerMessage = z.infer<typeof AgentAcpServerMessageSchema>
