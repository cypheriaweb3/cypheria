import superjson, { type SuperJSONResult, type SuperJSONValue } from "superjson"
import { z } from "zod"
import { AgentAcpClientMessageSchema, AgentAcpServerMessageSchema } from "./agent/acp-messages.ts"
import {
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
export { type RequestId, RequestIdSchema } from "./request-id.ts"

export const CYPHERIA_PROTOCOL_VERSION = 1 as const
export const CYPHERIA_WEBSOCKET_PATH = "/api/v1/ws" as const
export const CYPHERIA_WEBSOCKET_PROTOCOL = `cypheria.v${CYPHERIA_PROTOCOL_VERSION}` as const
const CYPHERIA_SUPERJSON_MARKER = "cypheria.superjson.v1" as const

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

export const ClientDescriptorSchema = z.strictObject({
  id: z.string().trim().min(1).max(128),
  kind: ClientKindSchema,
  name: z.string().trim().min(1).max(128).optional(),
  version: z.string().trim().min(1).max(64).optional(),
})
export type ClientDescriptor = z.infer<typeof ClientDescriptorSchema>

export const SessionHelloMessageSchema = z.strictObject({
  type: z.literal("session.hello"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    capabilities: z.array(z.string().trim().min(1).max(128)).max(128).default([]),
    client: ClientDescriptorSchema,
    protocolVersion: z.int().positive(),
  }),
})

export const ServerPingMessageSchema = z.strictObject({
  type: z.literal("server.ping"),
  requestId: RequestIdSchema,
  payload: z
    .strictObject({
      sentAt: z.iso.datetime().optional(),
    })
    .default({}),
})

export const ServerInfoRequestMessageSchema = z.strictObject({
  type: z.literal("server.info"),
  requestId: RequestIdSchema,
})

export const ServerDiagnosticsRequestMessageSchema = z.strictObject({
  type: z.literal("server.diagnostics"),
  requestId: RequestIdSchema,
})

export const RuntimeRequestMessageSchema = z.strictObject({
  type: z.literal("runtime.request"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    method: RuntimeMethodSchema,
    params: z.unknown().optional(),
  }),
})

export const ServerLifecycleRequestMessageSchema = z.strictObject({
  type: z.enum(["server.restart", "server.shutdown"]),
  requestId: RequestIdSchema,
  payload: z
    .strictObject({
      reason: z.string().trim().min(1).max(256).optional(),
    })
    .default({}),
})

export const SessionGoodbyeMessageSchema = z.strictObject({
  type: z.literal("session.goodbye"),
  requestId: RequestIdSchema,
})

export type ClientMessage =
  | z.infer<typeof SessionHelloMessageSchema>
  | z.infer<typeof ServerPingMessageSchema>
  | z.infer<typeof ServerInfoRequestMessageSchema>
  | z.infer<typeof ServerDiagnosticsRequestMessageSchema>
  | z.infer<typeof RuntimeRequestMessageSchema>
  | z.infer<typeof ServerLifecycleRequestMessageSchema>
  | z.infer<typeof SessionGoodbyeMessageSchema>
  | z.infer<typeof AgentAcpClientMessageSchema>
  | z.infer<typeof AgentCodexClientRequestMessageSchema>
  | z.infer<typeof AgentCodexServerResponseMessageSchema>
  | z.infer<typeof AgentCodexClientNotificationMessageSchema>

export const ClientMessageSchema = z.discriminatedUnion("type", [
  SessionHelloMessageSchema,
  ServerPingMessageSchema,
  ServerInfoRequestMessageSchema,
  ServerDiagnosticsRequestMessageSchema,
  RuntimeRequestMessageSchema,
  ServerLifecycleRequestMessageSchema,
  SessionGoodbyeMessageSchema,
  AgentAcpClientMessageSchema,
  AgentCodexClientRequestMessageSchema,
  AgentCodexServerResponseMessageSchema,
  AgentCodexClientNotificationMessageSchema,
] as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]) as unknown as z.ZodType<ClientMessage>

export const RuntimeStateSchema = z.enum(["errored", "ready", "starting", "stopped", "stopping"])

export const ServerIdentitySchema = z.strictObject({
  hostname: z.string(),
  id: z.string(),
  protocolVersion: z.literal(CYPHERIA_PROTOCOL_VERSION),
  startedAt: z.iso.datetime(),
  version: z.string(),
})
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>

export const ServerInfoSchema = z.strictObject({
  ...ServerIdentitySchema.shape,
  connections: z.int().nonnegative(),
  runtimeState: RuntimeStateSchema,
  webApp: z.strictObject({
    enabled: z.boolean(),
  }),
})
export type ServerInfo = z.infer<typeof ServerInfoSchema>

export const ServerDiagnosticsSchema = z.strictObject({
  collectedAt: z.iso.datetime(),
  connections: z.strictObject({
    active: z.int().nonnegative(),
    acceptedTotal: z.int().nonnegative(),
    rejectedTotal: z.int().nonnegative(),
  }),
  memory: z.strictObject({
    arrayBuffers: z.number().nonnegative(),
    external: z.number().nonnegative(),
    heapTotal: z.number().nonnegative(),
    heapUsed: z.number().nonnegative(),
    rss: z.number().nonnegative(),
  }),
  process: z.strictObject({
    pid: z.int().positive(),
    uptimeSeconds: z.number().nonnegative(),
  }),
  runtimeState: RuntimeStateSchema,
})
export type ServerDiagnostics = z.infer<typeof ServerDiagnosticsSchema>

export const ServerErrorCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "HANDLER_FAILED",
  "INTERNAL_ERROR",
  "INVALID_MESSAGE",
  "NOT_READY",
  "PROTOCOL_MISMATCH",
  "REQUEST_NOT_SUPPORTED",
])
export type ServerErrorCode = z.infer<typeof ServerErrorCodeSchema>

export const SessionReadyMessageSchema = z.strictObject({
  type: z.literal("session.ready"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    capabilities: z.array(z.string()),
    server: ServerIdentitySchema,
    sessionId: z.string(),
  }),
})

export const ServerPongMessageSchema = z.strictObject({
  type: z.literal("server.pong"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    clientSentAt: z.iso.datetime().optional(),
    serverReceivedAt: z.iso.datetime(),
    serverSentAt: z.iso.datetime(),
  }),
})

export const ServerInfoMessageSchema = z.strictObject({
  type: z.literal("server.info.result"),
  requestId: RequestIdSchema,
  payload: ServerInfoSchema,
})

export const ServerDiagnosticsMessageSchema = z.strictObject({
  type: z.literal("server.diagnostics.result"),
  requestId: RequestIdSchema,
  payload: ServerDiagnosticsSchema,
})

export const RuntimeResponseMessageSchema = z.strictObject({
  type: z.literal("runtime.response"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    result: z.unknown(),
  }),
})

export const RuntimeEventMessageSchema = z.strictObject({
  type: z.literal("runtime.event"),
  payload: z.strictObject({
    event: z.unknown(),
  }),
})

export const ServerLifecycleAcceptedMessageSchema = z.strictObject({
  type: z.literal("server.lifecycle.accepted"),
  requestId: RequestIdSchema,
  payload: z.strictObject({
    action: z.enum(["restart", "shutdown"]),
  }),
})

export const ServerErrorMessageSchema = z.strictObject({
  type: z.literal("server.error"),
  requestId: RequestIdSchema.optional(),
  payload: z.strictObject({
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
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
] as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]) as unknown as z.ZodType<ServerMessage>

export const HttpRuntimeRequestSchema = z.strictObject({
  method: RuntimeMethodSchema,
  params: z.unknown().optional(),
})
export type HttpRuntimeRequest = z.infer<typeof HttpRuntimeRequestSchema>

export const HttpLifecycleRequestSchema = z.strictObject({
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
