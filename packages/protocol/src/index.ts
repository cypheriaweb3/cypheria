import superjson, { type SuperJSONResult, type SuperJSONValue } from "superjson"
import { z } from "zod"
import { AgentAcpClientMessageSchema, AgentAcpServerMessageSchema } from "./agent/acp-messages.ts"
import {
  AGENT_CODEX_CLIENT_RPC,
  AgentCodexClientNotificationMessageSchema,
  AgentCodexClientRequestMessageSchema,
  AgentCodexClientResponseMessageSchema,
  AgentCodexServerNotificationMessageSchema,
  AgentCodexServerRequestMessageSchema,
  AgentCodexServerResponseMessageSchema,
} from "./agent/codex-app-server.ts"
import { RequestIdSchema } from "./request-id.ts"

export * from "./agent/acp-messages.ts"
export * from "./agent/codex-app-server.ts"
export * from "./relay.ts"
export { type RequestId, RequestIdSchema } from "./request-id.ts"

export const CYPHERIA_PROTOCOL_VERSION = 1 as const
export const CYPHERIA_WEBSOCKET_PATH = "/api/v1/ws" as const
export const CYPHERIA_WEBSOCKET_PROTOCOL = `cypheria.v${CYPHERIA_PROTOCOL_VERSION}` as const
const CYPHERIA_SUPERJSON_MARKER = "cypheria.superjson.v1" as const

/** Stable capabilities a client can advertise in `session.hello`. */
export const CLIENT_CAPABILITIES = {
  acp: "agent.acp",
  codex: "agent.codex",
  rpcErrors: "client.rpc-errors",
} as const
export type ClientCapability = (typeof CLIENT_CAPABILITIES)[keyof typeof CLIENT_CAPABILITIES]

/** Stable capabilities a server can advertise in `session.ready`. */
export const SERVER_CAPABILITIES = {
  acp: "agent.acp",
  codex: "agent.codex",
  diagnostics: "diagnostics",
  lifecycle: "server.lifecycle",
  runtimeEvents: "runtime.events",
  runtimeRequest: "runtime.request",
} as const
export type ServerCapability = (typeof SERVER_CAPABILITIES)[keyof typeof SERVER_CAPABILITIES]

/**
 * Incremental server behavior flags. Unknown names are intentionally preserved so a newer server
 * can be inspected by an older client. Add named flags as optional booleans and annotate every
 * compatibility gate with `COMPAT(name)`, its introduction version, and a removal date.
 */
export const ServerFeatureFlagsSchema = z.record(z.string().trim().min(1).max(128), z.boolean())
export type ServerFeatureFlags = z.infer<typeof ServerFeatureFlagsSchema>

type CypheriaSuperJsonEnvelope = SuperJSONResult & {
  $cypheria: typeof CYPHERIA_SUPERJSON_MARKER
  meta: NonNullable<SuperJSONResult["meta"]>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCypheriaSuperJsonEnvelope = (value: unknown): value is CypheriaSuperJsonEnvelope =>
  isRecord(value) &&
  value.$cypheria === CYPHERIA_SUPERJSON_MARKER &&
  "json" in value &&
  isRecord(value.meta)

export const ClientKindSchema = z.enum(["cli", "desktop", "expo", "mobile", "sdk", "web"])
export type ClientKind = z.infer<typeof ClientKindSchema>

export const RuntimeMethodSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(
    /^(runtime|wallet|chain|policy|browser|dapp|automation|audit|settings)\.[A-Za-z0-9._-]+$/,
    "Runtime method must use a supported namespace"
  )

export const ClientDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(128),
  kind: ClientKindSchema,
  name: z.string().trim().min(1).max(128).optional(),
  version: z.string().trim().min(1).max(64).optional(),
})
export type ClientDescriptor = z.infer<typeof ClientDescriptorSchema>

export const SessionHelloMessageSchema = z.object({
  type: z.literal("session.hello"),
  requestId: RequestIdSchema,
  payload: z.object({
    capabilities: z.array(z.string().trim().min(1).max(128)).max(128).default([]),
    client: ClientDescriptorSchema,
    protocolVersion: z.int().positive(),
  }),
})

export const ServerPingMessageSchema = z.object({
  type: z.literal("server.ping"),
  requestId: RequestIdSchema,
  payload: z
    .object({
      sentAt: z.iso.datetime().optional(),
    })
    .default({}),
})

export const ServerInfoRequestMessageSchema = z.object({
  type: z.literal("server.info"),
  requestId: RequestIdSchema,
})

export const ServerDiagnosticsRequestMessageSchema = z.object({
  type: z.literal("server.diagnostics"),
  requestId: RequestIdSchema,
})

export const RuntimeRequestMessageSchema = z.object({
  type: z.literal("runtime.request"),
  requestId: RequestIdSchema,
  payload: z.object({
    method: RuntimeMethodSchema,
    params: z.unknown().optional(),
  }),
})

export const ServerLifecycleRequestMessageSchema = z.object({
  type: z.enum(["server.restart", "server.shutdown"]),
  requestId: RequestIdSchema,
  payload: z
    .object({
      reason: z.string().trim().min(1).max(256).optional(),
    })
    .default({}),
})

export const SessionGoodbyeMessageSchema = z.object({
  type: z.literal("session.goodbye"),
  requestId: RequestIdSchema,
})

export const ClientRpcErrorCodeSchema = z.enum([
  "HANDLER_FAILED",
  "REQUEST_CANCELLED",
  "REQUEST_NOT_SUPPORTED",
])
export type ClientRpcErrorCode = z.infer<typeof ClientRpcErrorCodeSchema>

/** Terminal error response for a request initiated by the server. */
export const ClientRpcErrorMessageSchema = z.object({
  type: z.literal("client.error"),
  requestId: RequestIdSchema,
  payload: z.object({
    code: ClientRpcErrorCodeSchema,
    message: z.string().min(1),
    requestType: z.string().min(1).optional(),
  }),
})

export type ClientMessage =
  | z.infer<typeof SessionHelloMessageSchema>
  | z.infer<typeof ServerPingMessageSchema>
  | z.infer<typeof ServerInfoRequestMessageSchema>
  | z.infer<typeof ServerDiagnosticsRequestMessageSchema>
  | z.infer<typeof RuntimeRequestMessageSchema>
  | z.infer<typeof ServerLifecycleRequestMessageSchema>
  | z.infer<typeof SessionGoodbyeMessageSchema>
  | z.infer<typeof ClientRpcErrorMessageSchema>
  | z.infer<typeof AgentAcpClientMessageSchema>
  | z.infer<typeof AgentCodexClientRequestMessageSchema>
  | z.infer<typeof AgentCodexServerResponseMessageSchema>
  | z.infer<typeof AgentCodexClientNotificationMessageSchema>

// Some agent families are themselves unions/refined schemas, so they cannot satisfy Zod's
// discriminated-union option type without unsafe casts. A compiled ordinary union keeps the
// public type honest and lets Zod generate the optimized parser once for this hot boundary.
export const ClientMessageSchema: z.ZodType<ClientMessage> = z.compile(
  z.union([
    SessionHelloMessageSchema,
    ServerPingMessageSchema,
    ServerInfoRequestMessageSchema,
    ServerDiagnosticsRequestMessageSchema,
    RuntimeRequestMessageSchema,
    ServerLifecycleRequestMessageSchema,
    SessionGoodbyeMessageSchema,
    ClientRpcErrorMessageSchema,
    AgentAcpClientMessageSchema,
    AgentCodexClientRequestMessageSchema,
    AgentCodexServerResponseMessageSchema,
    AgentCodexClientNotificationMessageSchema,
  ])
)

export const RuntimeStateSchema = z.enum(["errored", "ready", "starting", "stopped", "stopping"])

export const ServerIdentitySchema = z.object({
  hostname: z.string(),
  id: z.string(),
  protocolVersion: z.literal(CYPHERIA_PROTOCOL_VERSION),
  startedAt: z.iso.datetime(),
  version: z.string(),
})
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>

export const ServerInfoSchema = z.object({
  ...ServerIdentitySchema.shape,
  connections: z.int().nonnegative(),
  runtimeState: RuntimeStateSchema,
  webApp: z.object({
    enabled: z.boolean(),
  }),
})
export type ServerInfo = z.infer<typeof ServerInfoSchema>

export const ServerDiagnosticsSchema = z.object({
  collectedAt: z.iso.datetime(),
  connections: z.object({
    active: z.int().nonnegative(),
    acceptedTotal: z.int().nonnegative(),
    rejectedTotal: z.int().nonnegative(),
  }),
  memory: z.object({
    arrayBuffers: z.number().nonnegative(),
    external: z.number().nonnegative(),
    heapTotal: z.number().nonnegative(),
    heapUsed: z.number().nonnegative(),
    rss: z.number().nonnegative(),
  }),
  process: z.object({
    pid: z.int().positive(),
    uptimeSeconds: z.number().nonnegative(),
  }),
  runtimeState: RuntimeStateSchema,
})
export type ServerDiagnostics = z.infer<typeof ServerDiagnosticsSchema>

export const KNOWN_SERVER_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "HANDLER_FAILED",
  "INTERNAL_ERROR",
  "INVALID_MESSAGE",
  "NOT_READY",
  "PROTOCOL_MISMATCH",
  "REQUEST_NOT_SUPPORTED",
] as const
export type KnownServerErrorCode = (typeof KNOWN_SERVER_ERROR_CODES)[number]
// Error codes are open-ended so newer servers do not disconnect older clients merely for adding
// a diagnostic code. Consumers can compare against KNOWN_SERVER_ERROR_CODES when needed.
export const ServerErrorCodeSchema = z.string().trim().min(1).max(128)
export type ServerErrorCode = z.infer<typeof ServerErrorCodeSchema>

export const SessionReadyMessageSchema = z.object({
  type: z.literal("session.ready"),
  requestId: RequestIdSchema,
  payload: z.object({
    capabilities: z.array(z.string()),
    features: ServerFeatureFlagsSchema.optional(),
    server: ServerIdentitySchema,
    sessionId: z.string(),
  }),
})

export const ServerPongMessageSchema = z.object({
  type: z.literal("server.pong"),
  requestId: RequestIdSchema,
  payload: z.object({
    clientSentAt: z.iso.datetime().optional(),
    serverReceivedAt: z.iso.datetime(),
    serverSentAt: z.iso.datetime(),
  }),
})

export const ServerInfoMessageSchema = z.object({
  type: z.literal("server.info.result"),
  requestId: RequestIdSchema,
  payload: ServerInfoSchema,
})

export const ServerDiagnosticsMessageSchema = z.object({
  type: z.literal("server.diagnostics.result"),
  requestId: RequestIdSchema,
  payload: ServerDiagnosticsSchema,
})

export const RuntimeResponseMessageSchema = z.object({
  type: z.literal("runtime.response"),
  requestId: RequestIdSchema,
  payload: z.object({
    result: z.unknown(),
  }),
})

export const RuntimeEventMessageSchema = z.object({
  type: z.literal("runtime.event"),
  payload: z.object({
    event: z.unknown(),
  }),
})

export const ServerLifecycleAcceptedMessageSchema = z.object({
  type: z.literal("server.lifecycle.accepted"),
  requestId: RequestIdSchema,
  payload: z.object({
    action: z.enum(["restart", "shutdown"]),
  }),
})

export const ServerErrorMessageSchema = z.object({
  type: z.literal("server.error"),
  requestId: RequestIdSchema.optional(),
  payload: z.object({
    code: ServerErrorCodeSchema,
    message: z.string(),
  }),
})

export type ServerMessage =
  | z.infer<typeof SessionReadyMessageSchema>
  | z.infer<typeof ServerPongMessageSchema>
  | z.infer<typeof ServerInfoMessageSchema>
  | z.infer<typeof ServerDiagnosticsMessageSchema>
  | z.infer<typeof RuntimeResponseMessageSchema>
  | z.infer<typeof RuntimeEventMessageSchema>
  | z.infer<typeof ServerLifecycleAcceptedMessageSchema>
  | z.infer<typeof ServerErrorMessageSchema>
  | z.infer<typeof AgentAcpServerMessageSchema>
  | z.infer<typeof AgentCodexClientResponseMessageSchema>
  | z.infer<typeof AgentCodexServerRequestMessageSchema>
  | z.infer<typeof AgentCodexServerNotificationMessageSchema>

export const ServerMessageSchema: z.ZodType<ServerMessage> = z.compile(
  z.union([
    SessionReadyMessageSchema,
    ServerPongMessageSchema,
    ServerInfoMessageSchema,
    ServerDiagnosticsMessageSchema,
    RuntimeResponseMessageSchema,
    RuntimeEventMessageSchema,
    ServerLifecycleAcceptedMessageSchema,
    ServerErrorMessageSchema,
    AgentAcpServerMessageSchema,
    AgentCodexClientResponseMessageSchema,
    AgentCodexServerRequestMessageSchema,
    AgentCodexServerNotificationMessageSchema,
  ])
)

const clientResponseTypes = new Set<string>([
  "session.ready",
  "server.pong",
  "server.info.result",
  "server.diagnostics.result",
  "runtime.response",
  "server.lifecycle.accepted",
  ...Object.values(AGENT_CODEX_CLIENT_RPC).map(({ response }) => response),
])

/** Distinguishes responses to client requests from reverse RPCs that happen to share an id. */
export const isClientResponseMessage = (message: ServerMessage): boolean =>
  clientResponseTypes.has(message.type)

export const HttpRuntimeRequestSchema = z.object({
  method: RuntimeMethodSchema,
  params: z.unknown().optional(),
})
export type HttpRuntimeRequest = z.infer<typeof HttpRuntimeRequestSchema>

export const HttpLifecycleRequestSchema = z.object({
  reason: z.string().trim().min(1).max(256).optional(),
})
export type HttpLifecycleRequest = z.infer<typeof HttpLifecycleRequestSchema>

export function parseClientMessage(value: unknown): ClientMessage {
  return ClientMessageSchema.parse(value)
}

export function parseServerMessage(value: unknown): ServerMessage {
  return ServerMessageSchema.parse(value)
}

/**
 * Encodes Cypheria protocol values as plain JSON whenever possible and adds a
 * versioned SuperJSON envelope only when values such as bigint need metadata.
 */
export function stringifyProtocolMessage(value: unknown): string {
  const serialized = superjson.serialize(value as SuperJSONValue)
  if (!serialized.meta) return JSON.stringify(serialized.json)

  return JSON.stringify({
    $cypheria: CYPHERIA_SUPERJSON_MARKER,
    ...serialized,
    meta: serialized.meta,
  } satisfies CypheriaSuperJsonEnvelope)
}

export function parseProtocolMessageText(raw: string): unknown {
  const value: unknown = JSON.parse(raw)
  if (!isCypheriaSuperJsonEnvelope(value)) return value
  return superjson.deserialize({ json: value.json, meta: value.meta })
}

export function parseClientMessageText(raw: string): ClientMessage {
  return parseClientMessage(parseProtocolMessageText(raw))
}

export function parseServerMessageText(raw: string): ServerMessage {
  return parseServerMessage(parseProtocolMessageText(raw))
}

export function createWebSocketProtocols(token?: string): string[] {
  const protocols: string[] = [CYPHERIA_WEBSOCKET_PROTOCOL]
  if (token) protocols.push(`cypheria.bearer.${token}`)
  return protocols
}
