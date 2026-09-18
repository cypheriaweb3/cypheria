import superjson, { type SuperJSONResult, type SuperJSONValue } from "superjson"
import { z } from "zod"
import {
  type AgentAcpClientMessage,
  AgentAcpClientMessageSchema,
  type AgentAcpServerMessage,
  AgentAcpServerMessageSchema,
} from "./agent/acp.ts"
import {
  AGENT_CLAUDE_RPC,
  type AgentClaudeClientMessage,
  AgentClaudeClientMessageSchema,
  type AgentClaudeServerMessage,
  AgentClaudeServerMessageSchema,
} from "./agent/claude.ts"
import {
  AGENT_CODEX_CLIENT_RPC,
  type AgentCodexClientNotification,
  AgentCodexClientNotificationSchema,
  type AgentCodexClientRequest,
  AgentCodexClientRequestSchema,
  type AgentCodexClientResponse,
  AgentCodexClientResponseSchema,
  type AgentCodexServerNotification,
  AgentCodexServerNotificationSchema,
  type AgentCodexServerRequest,
  AgentCodexServerRequestSchema,
  type AgentCodexServerResponse,
  AgentCodexServerResponseSchema,
} from "./agent/codex-app-server.ts"
import {
  AGENT_MANAGEMENT_CLIENT_SCHEMAS,
  AGENT_MANAGEMENT_SERVER_SCHEMAS,
  type AgentManagementClientMessage,
  type AgentManagementServerMessage,
} from "./agent/management.ts"
import {
  AGENT_OPENCODE_CLIENT_SCHEMAS,
  AGENT_OPENCODE_SERVER_SCHEMAS,
  type AgentOpenCodeClientMessage,
  type AgentOpenCodeServerMessage,
} from "./agent/opencode.ts"
import {
  AGENT_PI_RPC,
  type AgentPiClientMessage,
  AgentPiClientMessageSchema,
  type AgentPiServerMessage,
  AgentPiServerMessageSchema,
} from "./agent/pi.ts"
import {
  PROJECT_THREAD_CLIENT_SCHEMAS,
  PROJECT_THREAD_RESPONSE_TYPES,
  PROJECT_THREAD_SERVER_SCHEMAS,
  type ProjectThreadClientMessage,
  type ProjectThreadServerMessage,
} from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

export * from "./agent/acp.ts"
export * from "./agent/claude.ts"
export * from "./agent/codex-app-server.ts"
export * from "./agent/management.ts"
export * from "./agent/opencode.ts"
export * from "./agent/pi.ts"
export * from "./agent/registry.ts"
export * from "./project-thread.ts"
export * from "./relay.ts"
export { type RequestId, RequestIdSchema } from "./request-id.ts"

export const CYPHERIA_PROTOCOL_VERSION = 2 as const
export const CYPHERIA_WEBSOCKET_PATH = "/api/v1/ws" as const
export const CYPHERIA_WEBSOCKET_PROTOCOL = `cypheria.v${CYPHERIA_PROTOCOL_VERSION}` as const
const CYPHERIA_SUPERJSON_MARKER = "cypheria.superjson.v1" as const

/** Stable capabilities a server can advertise in the `server.status.notification` message. */
export const SERVER_CAPABILITIES = {
  acp: "agent.acp",
  agentManager: "agent.manager",
  claude: "agent.claude",
  codex: "agent.codex",
  pi: "agent.pi",
  opencode: "agent.opencode",
  projectThread: "project-thread",
  config: "server.config",
  diagnostics: "diagnostics",
  status: "server.status",
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

export const ClientKindSchema = z.enum(["desktop", "mobile", "web", "cli", "mcp", "hub"])
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
  version: z.string().optional(),
})
export type ClientDescriptor = z.infer<typeof ClientDescriptorSchema>

export const ClientCapabilitiesSchema = z.record(z.string().trim().min(1).max(128), z.unknown())
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>

export const WSHelloMessageSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string().trim().min(1).max(128),
  clientType: ClientKindSchema,
  protocolVersion: z.int().positive(),
  appVersion: z.string().optional(),
  capabilities: ClientCapabilitiesSchema.optional(),
})
export type WSHelloMessage = z.infer<typeof WSHelloMessageSchema>

export const WSPingMessageSchema = z.object({ type: z.literal("ping") })
export type WSPingMessage = z.infer<typeof WSPingMessageSchema>

export const WSPongMessageSchema = z.object({ type: z.literal("pong") })
export type WSPongMessage = z.infer<typeof WSPongMessageSchema>

export const ServerStatusGetRequestSchema = z.object({
  type: z.literal("server.status.request"),
  requestId: RequestIdSchema,
})

export const ServerDiagnosticsRequestSchema = z.object({
  type: z.literal("server.diagnostics.request"),
  requestId: RequestIdSchema,
})

export const ServerConfigGetRequestSchema = z.object({
  type: z.literal("server.config.get.request"),
  requestId: RequestIdSchema,
})

export const ServerConfigReloadRequestSchema = z.object({
  type: z.literal("server.config.reload.request"),
  requestId: RequestIdSchema,
})

export const RuntimeStateSchema = z.enum(["errored", "ready", "starting", "stopped", "stopping"])

export const ServerIdentitySchema = z.object({
  hostname: z.string(),
  id: z.string(),
  protocolVersion: z.literal(CYPHERIA_PROTOCOL_VERSION),
  startedAt: z.iso.datetime(),
  version: z.string(),
})
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>

export const ServerStatusSchema = z.object({
  ...ServerIdentitySchema.shape,
  capabilities: z.array(z.string()),
  connections: z.int().nonnegative(),
  features: ServerFeatureFlagsSchema.optional(),
  runtimeState: RuntimeStateSchema,
  webApp: z.object({
    enabled: z.boolean(),
  }),
})
export type ServerStatus = z.infer<typeof ServerStatusSchema>

export const ServerDiagnosticsSchema = z.object({
  collectedAt: z.iso.datetime(),
  connections: z.object({
    active: z.int().nonnegative(),
    activeSessions: z.int().nonnegative(),
    acceptedTotal: z.int().nonnegative(),
    rejectedTotal: z.int().nonnegative(),
    resumedTotal: z.int().nonnegative().optional(),
    retained: z.int().nonnegative().optional(),
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

const OptionalRelayEndpointSchema = z.string().trim().min(1).max(2048).optional()

export const PersistedServerConfigSchema = z
  .object({
    version: z.literal(1),
    server: z
      .object({
        cors: z
          .object({
            allowedOrigins: z.array(z.string().url()).default([]),
          })
          .strict(),
        limits: z
          .object({
            maxMessageBytes: z
              .int()
              .positive()
              .max(16 * 1024 * 1024),
          })
          .strict(),
        listen: z
          .object({
            host: z.string().trim().min(1),
            port: z.int().min(0).max(65_535),
          })
          .strict(),
        relay: z
          .object({
            enabled: z.boolean(),
            endpoint: OptionalRelayEndpointSchema,
            publicEndpoint: OptionalRelayEndpointSchema,
            publicUseTls: z.boolean(),
            useTls: z.boolean(),
          })
          .strict(),
        sessions: z
          .object({
            helloTimeoutMs: z.int().positive().max(60_000),
            reconnectGraceMs: z
              .int()
              .nonnegative()
              .max(5 * 60_000),
          })
          .strict(),
        shutdownTimeoutMs: z.int().positive().max(120_000),
        webApp: z
          .object({
            directory: z.string().trim().min(1).optional(),
            enabled: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
export type PersistedServerConfig = z.infer<typeof PersistedServerConfigSchema>

export const PersistedServerConfigPatchSchema = z
  .object({
    server: z
      .object({
        cors: z
          .object({ allowedOrigins: z.array(z.string().url()).optional() })
          .strict()
          .optional(),
        limits: z
          .object({
            maxMessageBytes: z
              .int()
              .positive()
              .max(16 * 1024 * 1024)
              .optional(),
          })
          .strict()
          .optional(),
        listen: z
          .object({
            host: z.string().trim().min(1).optional(),
            port: z.int().min(0).max(65_535).optional(),
          })
          .strict()
          .optional(),
        relay: z
          .object({
            enabled: z.boolean().optional(),
            endpoint: OptionalRelayEndpointSchema,
            publicEndpoint: OptionalRelayEndpointSchema,
            publicUseTls: z.boolean().optional(),
            useTls: z.boolean().optional(),
          })
          .strict()
          .optional(),
        sessions: z
          .object({
            helloTimeoutMs: z.int().positive().max(60_000).optional(),
            reconnectGraceMs: z
              .int()
              .nonnegative()
              .max(5 * 60_000)
              .optional(),
          })
          .strict()
          .optional(),
        shutdownTimeoutMs: z.int().positive().max(120_000).optional(),
        webApp: z
          .object({
            directory: z.string().trim().min(1).optional(),
            enabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type PersistedServerConfigPatch = z.infer<typeof PersistedServerConfigPatchSchema>

export const ServerConfigSnapshotSchema = z.object({
  config: PersistedServerConfigSchema,
  overrideControlledPaths: z.array(z.string()),
  path: z.string(),
  restartRequiredPaths: z.array(z.string()),
})
export type ServerConfigSnapshot = z.infer<typeof ServerConfigSnapshotSchema>

export const ServerConfigPatchRequestSchema = z.object({
  type: z.literal("server.config.patch.request"),
  requestId: RequestIdSchema,
  payload: z.object({ patch: PersistedServerConfigPatchSchema }),
})

export const ServerOperationalStateSchema = z.object({
  config: z.object({
    path: z.string(),
    restartRequired: z.boolean(),
  }),
  connections: z.object({
    active: z.int().nonnegative(),
    activeSessions: z.int().nonnegative(),
    retained: z.int().nonnegative(),
  }),
  relay: z.object({
    connected: z.boolean(),
    enabled: z.boolean(),
  }),
  runtimeState: RuntimeStateSchema,
  worker: z.object({
    pid: z.int().positive(),
    supervisorPid: z.int().positive().optional(),
  }),
})
export type ServerOperationalState = z.infer<typeof ServerOperationalStateSchema>

const discriminatedUnionByType = <T>(schemas: readonly z.ZodType[]): z.ZodType<T> =>
  z.compile(
    z.discriminatedUnion("type", schemas as unknown as Parameters<typeof z.discriminatedUnion>[1])
  ) as z.ZodType<T>

/** A client-to-server message carried inside a top-level WebSocket `session` envelope. */
export type SessionInboundMessage =
  | z.infer<typeof ServerStatusGetRequestSchema>
  | z.infer<typeof ServerDiagnosticsRequestSchema>
  | z.infer<typeof ServerConfigGetRequestSchema>
  | z.infer<typeof ServerConfigPatchRequestSchema>
  | z.infer<typeof ServerConfigReloadRequestSchema>
  | AgentAcpClientMessage
  | AgentClaudeClientMessage
  | AgentCodexClientRequest
  | AgentCodexServerResponse
  | AgentCodexClientNotification
  | AgentPiClientMessage
  | AgentManagementClientMessage
  | AgentOpenCodeClientMessage
  | ProjectThreadClientMessage

// Nested family discriminators keep each concrete wire `type` visible while allowing ACP to use
// `protocolVersion` as its second-level discriminator for types shared by v1 and v2.
export const SessionInboundMessageSchema = discriminatedUnionByType<SessionInboundMessage>([
  ServerStatusGetRequestSchema,
  ServerDiagnosticsRequestSchema,
  ServerConfigGetRequestSchema,
  ServerConfigPatchRequestSchema,
  ServerConfigReloadRequestSchema,
  AgentAcpClientMessageSchema,
  AgentClaudeClientMessageSchema,
  AgentCodexClientRequestSchema,
  AgentCodexServerResponseSchema,
  AgentCodexClientNotificationSchema,
  AgentPiClientMessageSchema,
  ...AGENT_MANAGEMENT_CLIENT_SCHEMAS,
  ...AGENT_OPENCODE_CLIENT_SCHEMAS,
  ...PROJECT_THREAD_CLIENT_SCHEMAS,
])

export type ClientMessage = SessionInboundMessage
export const ClientMessageSchema = SessionInboundMessageSchema

/** Status notification sent after hello and whenever server status materially changes. */
export const ServerStatusNotificationSchema = z.object({
  type: z.literal("server.status.notification"),
  payload: ServerStatusSchema,
})
export type ServerStatusNotification = z.infer<typeof ServerStatusNotificationSchema>

export const ServerStatusGetResponseSchema = z.object({
  type: z.literal("server.status.response"),
  requestId: RequestIdSchema,
  payload: ServerStatusSchema,
})

export const ServerDiagnosticsResponseSchema = z.object({
  type: z.literal("server.diagnostics.response"),
  requestId: RequestIdSchema,
  payload: ServerDiagnosticsSchema,
})

export const ServerConfigGetResponseSchema = z.object({
  type: z.literal("server.config.get.response"),
  requestId: RequestIdSchema,
  payload: ServerConfigSnapshotSchema,
})

export const ServerConfigPatchResponseSchema = z.object({
  type: z.literal("server.config.patch.response"),
  requestId: RequestIdSchema,
  payload: ServerConfigSnapshotSchema,
})

export const ServerConfigReloadResponseSchema = z.object({
  type: z.literal("server.config.reload.response"),
  requestId: RequestIdSchema,
  payload: ServerConfigSnapshotSchema,
})

/** A server-to-client message carried inside a top-level WebSocket `session` envelope. */
export type SessionOutboundMessage =
  | z.infer<typeof ServerStatusNotificationSchema>
  | z.infer<typeof ServerStatusGetResponseSchema>
  | z.infer<typeof ServerDiagnosticsResponseSchema>
  | z.infer<typeof ServerConfigGetResponseSchema>
  | z.infer<typeof ServerConfigPatchResponseSchema>
  | z.infer<typeof ServerConfigReloadResponseSchema>
  | AgentAcpServerMessage
  | AgentClaudeServerMessage
  | AgentCodexClientResponse
  | AgentCodexServerRequest
  | AgentCodexServerNotification
  | AgentPiServerMessage
  | AgentManagementServerMessage
  | AgentOpenCodeServerMessage
  | ProjectThreadServerMessage

export const SessionOutboundMessageSchema = discriminatedUnionByType<SessionOutboundMessage>([
  ServerStatusNotificationSchema,
  ServerStatusGetResponseSchema,
  ServerDiagnosticsResponseSchema,
  ServerConfigGetResponseSchema,
  ServerConfigPatchResponseSchema,
  ServerConfigReloadResponseSchema,
  AgentAcpServerMessageSchema,
  AgentClaudeServerMessageSchema,
  AgentCodexClientResponseSchema,
  AgentCodexServerRequestSchema,
  AgentCodexServerNotificationSchema,
  AgentPiServerMessageSchema,
  ...AGENT_MANAGEMENT_SERVER_SCHEMAS,
  ...AGENT_OPENCODE_SERVER_SCHEMAS,
  ...PROJECT_THREAD_SERVER_SCHEMAS,
])

export type ServerMessage = SessionOutboundMessage
export const ServerMessageSchema = SessionOutboundMessageSchema

const clientResponseTypes = new Set<string>([
  "server.status.response",
  "server.diagnostics.response",
  "server.config.get.response",
  "server.config.patch.response",
  "server.config.reload.response",
  ...Object.values(AGENT_CLAUDE_RPC).map(({ response }) => response),
  ...Object.values(AGENT_CODEX_CLIENT_RPC).map(({ response }) => response),
  ...Object.values(AGENT_PI_RPC).map(({ response }) => response),
  "agent.registry.list.response",
  "agent.registry.get.response",
  "agent.registry.refresh.response",
  "agent.install.response",
  "agent.update.response",
  "agent.uninstall.response",
  "agent.enabled.set.response",
  "agent.start.response",
  "agent.stop.response",
  "agent.operation.get.response",
  "agent.operation.list.response",
  "agent.toolchain.list.response",
  "agent.toolchain.check_updates.response",
  "agent.toolchain.update.response",
  "agent.opencode.call.response",
  "agent.opencode.event.subscribe.response",
  ...PROJECT_THREAD_RESPONSE_TYPES,
])

/** Distinguishes responses to client requests from reverse RPCs that happen to share an id. */
export const isClientResponseMessage = (message: ServerMessage): boolean =>
  clientResponseTypes.has(message.type)

export const WSSessionInboundMessageSchema = z.object({
  type: z.literal("session"),
  message: SessionInboundMessageSchema,
})
export type WSSessionInboundMessage = z.infer<typeof WSSessionInboundMessageSchema>

export const WSSessionOutboundMessageSchema = z.object({
  type: z.literal("session"),
  message: SessionOutboundMessageSchema,
})
export type WSSessionOutboundMessage = z.infer<typeof WSSessionOutboundMessageSchema>

export type WSInboundMessage = WSHelloMessage | WSPingMessage | WSSessionInboundMessage
export const WSInboundMessageSchema: z.ZodType<WSInboundMessage> = z.compile(
  z.discriminatedUnion("type", [
    WSHelloMessageSchema,
    WSPingMessageSchema,
    WSSessionInboundMessageSchema,
  ])
)

export type WSOutboundMessage = WSPongMessage | WSSessionOutboundMessage
export const WSOutboundMessageSchema: z.ZodType<WSOutboundMessage> = z.compile(
  z.discriminatedUnion("type", [WSPongMessageSchema, WSSessionOutboundMessageSchema])
)

export const wrapClientSessionMessage = (message: ClientMessage): WSSessionInboundMessage => ({
  message,
  type: "session",
})

export const wrapServerSessionMessage = (message: ServerMessage): WSSessionOutboundMessage => ({
  message,
  type: "session",
})

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
  return parseSessionInboundMessage(value)
}

export function parseServerMessage(value: unknown): ServerMessage {
  return parseSessionOutboundMessage(value)
}

export function parseSessionInboundMessage(value: unknown): SessionInboundMessage {
  return SessionInboundMessageSchema.parse(value)
}

export function parseSessionOutboundMessage(value: unknown): SessionOutboundMessage {
  return SessionOutboundMessageSchema.parse(value)
}

export function parseWSInboundMessage(value: unknown): WSInboundMessage {
  return WSInboundMessageSchema.parse(value)
}

export function parseWSOutboundMessage(value: unknown): WSOutboundMessage {
  return WSOutboundMessageSchema.parse(value)
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
  return parseSessionInboundMessageText(raw)
}

export function parseServerMessageText(raw: string): ServerMessage {
  return parseSessionOutboundMessageText(raw)
}

export function parseSessionInboundMessageText(raw: string): SessionInboundMessage {
  return parseSessionInboundMessage(parseProtocolMessageText(raw))
}

export function parseSessionOutboundMessageText(raw: string): SessionOutboundMessage {
  return parseSessionOutboundMessage(parseProtocolMessageText(raw))
}

export function parseWSInboundMessageText(raw: string): WSInboundMessage {
  return parseWSInboundMessage(parseProtocolMessageText(raw))
}

export function parseWSOutboundMessageText(raw: string): WSOutboundMessage {
  return parseWSOutboundMessage(parseProtocolMessageText(raw))
}

export function createWebSocketProtocols(token?: string): string[] {
  const protocols: string[] = [CYPHERIA_WEBSOCKET_PROTOCOL]
  if (token) protocols.push(`cypheria.bearer.${token}`)
  return protocols
}
