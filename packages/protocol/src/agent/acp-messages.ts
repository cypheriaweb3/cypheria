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

// ACP v1 and v2 have independent protocol-version constants. Keeping the SDK values as the
// source of truth prevents Cypheria's envelope discriminator from drifting from the ACP payload.
export const ACP_V1_PROTOCOL_VERSION = ACP_V1_SDK_PROTOCOL_VERSION
export const ACP_V2_PROTOCOL_VERSION = ACP_V2_SDK_PROTOCOL_VERSION

/** The ACP version carried by the outer Cypheria wire envelope. */
export const AcpProtocolVersionSchema = z.literal([
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
])
// `z.infer` derives the TypeScript union from the runtime schema, so adding a supported version to
// the schema updates validation and static narrowing together.
export type AcpProtocolVersion = z.infer<typeof AcpProtocolVersionSchema>

/**
 * Adds the JSON-RPC version marker to every member of an SDK union.
 *
 * `T extends unknown ? ... : never` intentionally makes this a distributive conditional type. If
 * `T` is `RequestA | RequestB`, the result is `(RequestA & JsonRpc) | (RequestB & JsonRpc)`, so each
 * method-specific member keeps its own discriminants and params type.
 */
type WithJsonRpc<T> = T extends unknown ? T & { jsonrpc: "2.0" } : never

/** A variadic tuple representing a JSON-RPC batch with at least one entry. */
type NonEmptyBatch<T> = readonly [T, ...T[]]

// Cancellation is a protocol-level notification rather than an agent- or client-owned method.
// Define it explicitly so it can legally travel in either direction.
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

// Stable ACP v1 only permits one JSON-RPC message per wire frame. The names below describe the
// sender: `AcpV1ClientRequest` is sent by a Cypheria client to the server-owned agent, while
// `AcpV1AgentRequest` travels in the reverse direction.
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

/** Direction-neutral ACP v1 message, primarily useful for generic tooling and diagnostics. */
export type AcpV1WireMessage = AcpV1SdkMessage

// Draft ACP v2 distinguishes a "call" (request or notification) from a response. A wire frame can
// contain one message, a non-empty call batch, or a non-empty response batch. Calls and responses
// are deliberately not mixed in the same typed batch.
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

/** Direction-neutral ACP v2 message, including the SDK's batch-capable wire forms. */
export type AcpV2WireMessage = AcpV2SdkWireMessage

/** Narrows an unknown JSON value to a non-array object before property inspection. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** JSON-RPC permits string, finite-number, and null ids; booleans and non-finite numbers are invalid. */
const isJsonRpcId = (value: unknown): value is string | number | null =>
  value === null ||
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value))

/**
 * Performs the JSON-RPC shape checks shared by all ACP message schemas.
 *
 * A value with `method` is a request when it also has `id`, otherwise it is a notification. A
 * value without `method` is a response and must contain exactly one of `result` and `error`.
 */
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

/** Loose runtime lookup used after a message's method string has been inspected. */
type ParamsSchemas = Readonly<Record<string, z.ZodType>>

/** The three JSON-RPC shapes that must remain distinct even when SDK schemas are permissive. */
type AcpMessageKind = "notification" | "request" | "response"

/**
 * Compile-time contract for a complete method-to-params-schema table.
 *
 * The mapped type requires one entry for every SDK method in `Method`. Indexing
 * `ParamsByMethod[Name]` also checks that each Zod schema parses the exact params type associated
 * with that method. The `satisfies` expressions below validate the tables without widening their
 * useful literal keys.
 */
type SdkParamsSchemas<Method extends string, ParamsByMethod extends Record<Method, unknown>> = {
  readonly [Name in Method]: z.ZodType<ParamsByMethod[Name]>
}

/**
 * Combines JSON-RPC shape checks with Cypheria's method-aware validation.
 *
 * Requests and notifications skip the SDK's broad, uncorrelated params union and validate only the
 * schema selected by `method`; this avoids traversing large/high-frequency payloads twice.
 * Responses retain the SDK response schema because their result/error shape cannot be selected by
 * a method. Unknown extension methods remain legal; a known method found in the wrong direction is
 * rejected instead of being mistaken for an extension.
 */
const matchesSdkSchema = (
  value: unknown,
  schema: z.ZodType | undefined,
  kind: AcpMessageKind,
  paramsSchemas?: ParamsSchemas,
  knownMethods?: ReadonlySet<string>
): boolean => {
  if (!isAcpJsonRpcMessage(value) || (schema && !schema.safeParse(value).success)) return false
  const actualKind = "method" in value ? ("id" in value ? "request" : "notification") : "response"
  if (actualKind !== kind) return false
  if (!paramsSchemas || !("method" in value)) return true

  const paramsSchema = paramsSchemas[value.method]
  if (paramsSchema) return paramsSchema.safeParse(value.params).success
  return !knownMethods?.has(value.method)
}

/**
 * Wraps the predicate above as a typed Zod schema.
 *
 * `z.json()` first excludes non-JSON values such as `undefined`, functions, and `bigint`. The final
 * cast is necessary because `refine()` cannot express the full generic `Message` type to
 * TypeScript, even though `matchesSdkSchema` enforces it at runtime.
 */
const sdkMessageSchema = <Message>(
  schema: z.ZodType | undefined,
  kind: AcpMessageKind,
  description: string,
  paramsSchemas?: ParamsSchemas,
  knownMethods?: ReadonlySet<string>
): z.ZodType<Message> =>
  z.compile(
    z
      .json()
      .refine(
        (value) => matchesSdkSchema(value, schema, kind, paramsSchemas, knownMethods),
        `Invalid ${description}`
      )
  ) as unknown as z.ZodType<Message>

// Requests sent by a client target agent methods, so this table is keyed by AGENT_METHODS. The
// mapped `satisfies` type guarantees that no official v1 request method is missing or mismatched.
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

// Notifications sent by a client also target agent methods, but use the notification catalog.
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

// Requests sent by the agent target capabilities implemented by the client.
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

// Notifications sent by the agent target client-side notification handlers.
const acpV1ClientNotificationParams = {
  [ACP_V1_CLIENT_METHODS.session_update]: acpV1Zod.zSessionNotification,
  [ACP_V1_CLIENT_METHODS.elicitation_complete]: acpV1Zod.zCompleteElicitationNotification,
} satisfies SdkParamsSchemas<AcpV1ClientNotificationMethod, AcpV1ClientNotificationParamsByMethod>

// The v2 tables repeat the same directional method-to-params relationship for the draft catalog.
// Initialize receives one extra check because the generated request schema accepts a wider version
// shape than this v2-only entry point should allow.
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

/** Complete params schemas for v2 notifications sent from client to agent. */
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

/** Complete params schemas for v2 requests sent from agent to client. */
const acpV2ClientRequestParams = {
  [ACP_V2_CLIENT_METHODS.session_request_permission]: acpV2Zod.zRequestPermissionRequest,
  [ACP_V2_CLIENT_METHODS.mcp_connect]: acpV2Zod.zConnectMcpRequest,
  [ACP_V2_CLIENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpRequest,
  [ACP_V2_CLIENT_METHODS.mcp_disconnect]: acpV2Zod.zDisconnectMcpRequest,
  [ACP_V2_CLIENT_METHODS.elicitation_create]: acpV2Zod.zCreateElicitationRequest,
} satisfies SdkParamsSchemas<AcpV2ClientRequestMethod, AcpV2ClientRequestParamsByMethod>

/** Complete params schemas for v2 notifications sent from agent to client. */
const acpV2ClientNotificationParams = {
  [ACP_V2_CLIENT_METHODS.session_update]: acpV2Zod.zUpdateSessionNotification,
  [ACP_V2_CLIENT_METHODS.mcp_message]: acpV2Zod.zMessageMcpNotification,
  [ACP_V2_CLIENT_METHODS.elicitation_complete]: acpV2Zod.zCompleteElicitationNotification,
} satisfies SdkParamsSchemas<AcpV2ClientNotificationMethod, AcpV2ClientNotificationParamsByMethod>

// These sets cover methods from both directions plus protocol-level methods. They let
// `matchesSdkSchema` distinguish a legitimate unknown extension from a known method used with the
// wrong sender or JSON-RPC kind.
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

// Protocol-level cancellation is validated separately because it is valid in both directions and
// therefore does not belong exclusively to either the agent or client method tables.
export const AcpV1ProtocolNotificationSchema = sdkMessageSchema<AcpV1ProtocolNotification>(
  undefined,
  "notification",
  "ACP v1 protocol notification",
  { [ACP_V1_PROTOCOL_METHODS.cancel_request]: acpV1Zod.zCancelRequestNotification.nullish() },
  new Set([ACP_V1_PROTOCOL_METHODS.cancel_request])
)

// "Client" schemas below mean messages whose sender is the Cypheria client. Consequently, client
// requests and notifications validate params against the agent-side method catalogs.
export const AcpV1ClientRequestSchema = sdkMessageSchema<AcpV1ClientRequest>(
  undefined,
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
  undefined,
  "notification",
  "ACP v1 client notification",
  acpV1AgentNotificationParams,
  acpV1KnownMethods
)

// `sdkMessageSchema` already guarantees each member's runtime shape. The cast records the precise
// union for TypeScript because Zod cannot recover the generic refinement's discriminated members.
export const AcpV1ClientMessageSchema = z.union([
  AcpV1ClientRequestSchema,
  AcpV1ClientResponseSchema,
  AcpV1ClientNotificationSchema,
  AcpV1ProtocolNotificationSchema,
]) as z.ZodType<AcpV1ClientMessage>

// "Agent" schemas mean messages emitted by the server-owned agent. Its calls therefore use the
// client-side method catalogs, i.e. capabilities that the Cypheria client must implement.
export const AcpV1AgentRequestSchema = sdkMessageSchema<AcpV1AgentRequest>(
  undefined,
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
  undefined,
  "notification",
  "ACP v1 agent notification",
  acpV1ClientNotificationParams,
  acpV1KnownMethods
)

/** Every valid single ACP v1 message emitted by the agent. */
export const AcpV1AgentMessageSchema = z.union([
  AcpV1AgentRequestSchema,
  AcpV1AgentResponseSchema,
  AcpV1AgentNotificationSchema,
  AcpV1ProtocolNotificationSchema,
]) as z.ZodType<AcpV1AgentMessage>

/** Direction-neutral v1 schema; directional boundaries should prefer the schemas above. */
export const AcpV1WireMessageSchema = z.union([
  AcpV1ClientMessageSchema,
  AcpV1AgentMessageSchema,
]) as z.ZodType<AcpV1WireMessage>

// V2 exposes a generated protocol-notification base schema, then narrows it to the only currently
// supported protocol method and its method-specific params.
export const AcpV2ProtocolNotificationSchema = sdkMessageSchema<AcpV2ProtocolNotification>(
  undefined,
  "notification",
  "ACP v2 protocol notification",
  { [ACP_V2_PROTOCOL_METHODS.cancel_request]: acpV2Zod.zCancelRequestNotification.nullish() },
  new Set([ACP_V2_PROTOCOL_METHODS.cancel_request])
)

// As in v1, client-emitted calls are checked against agent method params. Responses need no method
// lookup because JSON-RPC correlates their result/error shape through `id` at the connection layer.
export const AcpV2ClientRequestSchema = sdkMessageSchema<AcpV2ClientRequest>(
  undefined,
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
  undefined,
  "notification",
  "ACP v2 client notification",
  acpV2AgentNotificationParams,
  acpV2KnownMethods
)

/** A client-emitted v2 call: request, notification, or bidirectional protocol notification. */
export const AcpV2ClientCallSchema = z.union([
  AcpV2ClientRequestSchema,
  AcpV2ClientNotificationSchema,
  AcpV2ProtocolNotificationSchema,
]) as z.ZodType<AcpV2ClientCall>

/** One non-batched v2 message emitted by the client. */
export const AcpV2ClientMessageSchema = z.union([
  AcpV2ClientCallSchema,
  AcpV2ClientResponseSchema,
]) as z.ZodType<AcpV2ClientMessage>

// `z.tuple([head], rest)` mirrors NonEmptyBatch<T>: one required first entry followed by zero or
// more entries of the same type. Initialize must remain a singleton because it establishes the
// connection's protocol state before any other request can be interpreted safely.
const AcpV2ClientCallBatchSchema = z
  .tuple([AcpV2ClientCallSchema], AcpV2ClientCallSchema)
  .refine(
    (messages) =>
      !messages.some(
        (message) => "id" in message && message.method === ACP_V2_AGENT_METHODS.initialize
      ) || messages.length === 1,
    "ACP v2 initialize must be the only entry in its batch"
  )

// A v2 client wire frame is either one message, a non-empty call batch, or a non-empty response
// batch. Keeping call and response batches separate matches `AcpV2ClientWireMessage` above.
export const AcpV2ClientWireMessageSchema = z.union([
  AcpV2ClientMessageSchema,
  AcpV2ClientCallBatchSchema,
  z.tuple([AcpV2ClientResponseSchema], AcpV2ClientResponseSchema),
]) as z.ZodType<AcpV2ClientWireMessage>

// Agent-emitted calls are the mirror image: their params must match client-side capabilities.
export const AcpV2AgentRequestSchema = sdkMessageSchema<AcpV2AgentRequest>(
  undefined,
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
  undefined,
  "notification",
  "ACP v2 agent notification",
  acpV2ClientNotificationParams,
  acpV2KnownMethods
)

/** An agent-emitted v2 call: request, notification, or protocol notification. */
export const AcpV2AgentCallSchema = z.union([
  AcpV2AgentRequestSchema,
  AcpV2AgentNotificationSchema,
  AcpV2ProtocolNotificationSchema,
]) as z.ZodType<AcpV2AgentCall>

/** One non-batched v2 message emitted by the agent. */
export const AcpV2AgentMessageSchema = z.union([
  AcpV2AgentCallSchema,
  AcpV2AgentResponseSchema,
]) as z.ZodType<AcpV2AgentMessage>

// The agent-side wire union has the same three alternatives as the client side. No initialize
// singleton refinement is needed here because initialize is a client-to-agent request.
export const AcpV2AgentWireMessageSchema = z.union([
  AcpV2AgentMessageSchema,
  z.tuple([AcpV2AgentCallSchema], AcpV2AgentCallSchema),
  z.tuple([AcpV2AgentResponseSchema], AcpV2AgentResponseSchema),
]) as z.ZodType<AcpV2AgentWireMessage>

/** Direction-neutral v2 schema, including both batch directions. */
export const AcpV2WireMessageSchema = z.union([
  AcpV2ClientWireMessageSchema,
  AcpV2AgentWireMessageSchema,
]) as z.ZodType<AcpV2WireMessage>

// This broad envelope is useful when direction is not yet known. `protocolVersion` is a true
// discriminator: once narrowed to 1 or 2, TypeScript and Zod select the matching message family.
export const AcpWirePayloadSchema = z.compile(
  z.discriminatedUnion("protocolVersion", [
    z.object({
      protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
      message: AcpV1WireMessageSchema,
    }),
    z.object({
      protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
      message: AcpV2WireMessageSchema,
    }),
  ])
)
// The remaining payload/message aliases use the same pattern: infer the public TypeScript type
// directly from its boundary schema rather than maintaining a second handwritten union.
export type AcpWirePayload = z.infer<typeof AcpWirePayloadSchema>

// Use this envelope at client-to-server boundaries. Unlike AcpWirePayloadSchema, it cannot accept
// an agent-originated request or notification, even if that message is otherwise valid ACP.
export const AcpClientWirePayloadSchema = z.compile(
  z.discriminatedUnion("protocolVersion", [
    z.object({
      protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
      message: AcpV1ClientMessageSchema,
    }),
    z.object({
      protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
      message: AcpV2ClientWireMessageSchema,
    }),
  ])
)
export type AcpClientWirePayload = z.infer<typeof AcpClientWirePayloadSchema>

// Mirror of AcpClientWirePayloadSchema for server-to-client traffic emitted by the hosted agent.
export const AcpServerWirePayloadSchema = z.compile(
  z.discriminatedUnion("protocolVersion", [
    z.object({
      protocolVersion: z.literal(ACP_V1_PROTOCOL_VERSION),
      message: AcpV1AgentMessageSchema,
    }),
    z.object({
      protocolVersion: z.literal(ACP_V2_PROTOCOL_VERSION),
      message: AcpV2AgentWireMessageSchema,
    }),
  ])
)
export type AcpServerWirePayload = z.infer<typeof AcpServerWirePayloadSchema>

/**
 * Top-level Cypheria protocol message carrying ACP traffic from a client to the server-owned agent.
 * The outer `type` routes the message; the nested `protocolVersion` selects ACP v1 or v2.
 */
export const AgentAcpClientMessageSchema = z.object({
  type: z.literal("agent.acp.client.message"),
  payload: AcpClientWirePayloadSchema,
})
export type AgentAcpClientMessage = z.infer<typeof AgentAcpClientMessageSchema>

/**
 * Top-level Cypheria protocol message carrying ACP traffic from the server-owned agent to a client.
 * It is intentionally directional, so client-originated ACP calls cannot pass this boundary.
 */
export const AgentAcpServerMessageSchema = z.object({
  type: z.literal("agent.acp.server.message"),
  payload: AcpServerWirePayloadSchema,
})
export type AgentAcpServerMessage = z.infer<typeof AgentAcpServerMessageSchema>
