import { z } from "zod"

export const CYPHERIA_PROTOCOL_VERSION = 1 as const
export const CYPHERIA_WEBSOCKET_PATH = "/api/v1/ws" as const
export const CYPHERIA_WEBSOCKET_PROTOCOL = `cypheria.v${CYPHERIA_PROTOCOL_VERSION}` as const

export const ClientKindSchema = z.enum(["cli", "desktop", "expo", "mobile", "sdk", "web"])
export type ClientKind = z.infer<typeof ClientKindSchema>

export const RequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Request id contains unsupported characters")

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
    protocolVersion: z.number().int().positive(),
  }),
})

export const ServerPingMessageSchema = z.object({
  type: z.literal("server.ping"),
  requestId: RequestIdSchema,
  payload: z
    .object({
      sentAt: z.string().datetime().optional(),
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

export const ClientMessageSchema = z.discriminatedUnion("type", [
  SessionHelloMessageSchema,
  ServerPingMessageSchema,
  ServerInfoRequestMessageSchema,
  ServerDiagnosticsRequestMessageSchema,
  RuntimeRequestMessageSchema,
  ServerLifecycleRequestMessageSchema,
  SessionGoodbyeMessageSchema,
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export const RuntimeStateSchema = z.enum(["errored", "ready", "starting", "stopped", "stopping"])

export const ServerIdentitySchema = z.object({
  hostname: z.string(),
  id: z.string(),
  protocolVersion: z.literal(CYPHERIA_PROTOCOL_VERSION),
  startedAt: z.string().datetime(),
  version: z.string(),
})
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>

export const ServerInfoSchema = ServerIdentitySchema.extend({
  connections: z.number().int().nonnegative(),
  runtimeState: RuntimeStateSchema,
  webApp: z.object({
    enabled: z.boolean(),
  }),
})
export type ServerInfo = z.infer<typeof ServerInfoSchema>

export const ServerDiagnosticsSchema = z.object({
  collectedAt: z.string().datetime(),
  connections: z.object({
    active: z.number().int().nonnegative(),
    acceptedTotal: z.number().int().nonnegative(),
    rejectedTotal: z.number().int().nonnegative(),
  }),
  memory: z.object({
    arrayBuffers: z.number().nonnegative(),
    external: z.number().nonnegative(),
    heapTotal: z.number().nonnegative(),
    heapUsed: z.number().nonnegative(),
    rss: z.number().nonnegative(),
  }),
  process: z.object({
    pid: z.number().int().positive(),
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

export const SessionReadyMessageSchema = z.object({
  type: z.literal("session.ready"),
  requestId: RequestIdSchema,
  payload: z.object({
    capabilities: z.array(z.string()),
    server: ServerIdentitySchema,
    sessionId: z.string(),
  }),
})

export const ServerPongMessageSchema = z.object({
  type: z.literal("server.pong"),
  requestId: RequestIdSchema,
  payload: z.object({
    clientSentAt: z.string().datetime().optional(),
    serverReceivedAt: z.string().datetime(),
    serverSentAt: z.string().datetime(),
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
  SessionReadyMessageSchema,
  ServerPongMessageSchema,
  ServerInfoMessageSchema,
  ServerDiagnosticsMessageSchema,
  RuntimeResponseMessageSchema,
  RuntimeEventMessageSchema,
  ServerLifecycleAcceptedMessageSchema,
  ServerErrorMessageSchema,
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>

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

export function createWebSocketProtocols(token?: string): string[] {
  const protocols: string[] = [CYPHERIA_WEBSOCKET_PROTOCOL]
  if (token) protocols.push(`cypheria.bearer.${token}`)
  return protocols
}
