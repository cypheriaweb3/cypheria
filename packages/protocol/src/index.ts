import { type DecodeOptions, decode, encode } from "cbor2"
import { z } from "zod"
import {
  AGENT_MANAGEMENT_CLIENT_SCHEMAS,
  AGENT_MANAGEMENT_SERVER_SCHEMAS,
  type AgentManagementClientMessage,
  type AgentManagementServerMessage,
} from "./agent/management.ts"
import {
  GIT_CLIENT_SCHEMAS,
  GIT_RESPONSE_TYPES,
  GIT_SERVER_SCHEMAS,
  type GitClientMessage,
  type GitServerMessage,
} from "./git.ts"
import {
  HARNESS_CLIENT_SCHEMAS,
  HARNESS_RESPONSE_TYPES,
  HARNESS_SERVER_SCHEMAS,
  type HarnessClientMessage,
  type HarnessServerMessage,
  HarnessSettingValueSchema,
} from "./harness.ts"
import {
  CODEX_HARNESS_CLIENT_SCHEMAS,
  CODEX_HARNESS_RESPONSE_TYPES,
  CODEX_HARNESS_SERVER_SCHEMAS,
  CodexAgentSettingsSchema,
  type CodexHarnessClientMessage,
  type CodexHarnessServerMessage,
} from "./harness-codex.ts"
import {
  INTEGRATION_CLIENT_SCHEMAS,
  INTEGRATION_RESPONSE_TYPES,
  INTEGRATION_SERVER_SCHEMAS,
  type IntegrationClientMessage,
  type IntegrationServerMessage,
} from "./integration.ts"
import {
  PROJECT_THREAD_CLIENT_SCHEMAS,
  PROJECT_THREAD_RESPONSE_TYPES,
  PROJECT_THREAD_SERVER_SCHEMAS,
  type ProjectThreadClientMessage,
  type ProjectThreadServerMessage,
} from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"
import {
  SCHEDULE_CLIENT_SCHEMAS,
  SCHEDULE_RESPONSE_TYPES,
  SCHEDULE_SERVER_SCHEMAS,
  type ScheduleClientMessage,
  type ScheduleServerMessage,
} from "./schedule.ts"
import {
  TERMINAL_CLIENT_SCHEMAS,
  TERMINAL_RESPONSE_TYPES,
  TERMINAL_SERVER_SCHEMAS,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "./terminal.ts"
import {
  THREAD_CLIENT_SCHEMAS,
  THREAD_RESPONSE_TYPES,
  THREAD_SERVER_SCHEMAS,
  type ThreadClientMessage,
  type ThreadServerMessage,
} from "./thread.ts"
import {
  WEB3_CLIENT_SCHEMAS,
  WEB3_RESPONSE_TYPES,
  WEB3_SERVER_SCHEMAS,
  type Web3ClientMessage,
  type Web3ServerMessage,
} from "./web3.ts"

export * from "./agent/claude.ts"
export * from "./agent/codex-app-server.ts"
export * from "./agent/management.ts"
export * from "./agent/opencode.ts"
export * from "./agent/pi.ts"
export * from "./agent/registry.ts"
export * from "./codex-ui/image-generation.ts"
export * from "./codex-ui/turn-projection.ts"
export * from "./git.ts"
export * from "./harness.ts"
export * from "./harness-codex.ts"
export * from "./integration.ts"
export * from "./project-thread.ts"
export * from "./relay.ts"
export { type RequestId, RequestIdSchema } from "./request-id.ts"
export * from "./schedule.ts"
export * from "./terminal.ts"
export * from "./thread.ts"
export * from "./thread-timeline.ts"
export * from "./web3.ts"

export const CYPHERIA_PROTOCOL_VERSION = 1 as const
export const CYPHERIA_WEBSOCKET_PATH = "/api/v1/ws" as const
export const CYPHERIA_WEBSOCKET_PROTOCOL = `cypheria.v${CYPHERIA_PROTOCOL_VERSION}` as const
const CYPHERIA_CBOR_MAX_DEPTH = 64

/** Stable capabilities a server can advertise in the `server.status.notification` message. */
export const SERVER_CAPABILITIES = {
  agentManager: "agent.manager",
  codexHarness: "harness.codex",
  harnessManagement: "harness.management",
  projectThread: "project-thread",
  schedules: "schedules",
  terminals: "terminals",
  thread: "thread",
  web3: "web3",
  integrations: "integrations",
  config: "server.config",
  diagnostics: "diagnostics",
  git: "git",
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

const createProtocolObject: NonNullable<DecodeOptions["createObject"]> = (entries) => {
  if (entries.some(([key]) => typeof key !== "string")) {
    throw new TypeError("Cypheria CBOR maps must use string keys")
  }
  return Object.fromEntries(entries.map(([key, value]) => [key as string, value]))
}

const assertProtocolValue = (
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set()
): void => {
  if (depth > CYPHERIA_CBOR_MAX_DEPTH) {
    throw new TypeError(`Cypheria CBOR exceeds maximum depth ${CYPHERIA_CBOR_MAX_DEPTH}`)
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cypheria CBOR numbers must be finite")
    return
  }
  if (value instanceof Uint8Array) return
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported Cypheria CBOR value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError("Cypheria CBOR values must not be circular")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertProtocolValue(item, depth + 1, ancestors)
      return
    }
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cypheria CBOR only supports plain objects")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Cypheria CBOR object keys must be strings")
    }
    for (const nested of Object.values(value)) {
      assertProtocolValue(nested, depth + 1, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

const prepareProtocolValue = (
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set()
): unknown => {
  if (depth > CYPHERIA_CBOR_MAX_DEPTH) {
    throw new TypeError(`Cypheria CBOR exceeds maximum depth ${CYPHERIA_CBOR_MAX_DEPTH}`)
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cypheria CBOR numbers must be finite")
    return value
  }
  if (value instanceof Uint8Array) return value
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported Cypheria CBOR value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError("Cypheria CBOR values must not be circular")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => prepareProtocolValue(item, depth + 1, ancestors))
    }
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cypheria CBOR only supports plain objects")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Cypheria CBOR object keys must be strings")
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, prepareProtocolValue(nested, depth + 1, ancestors)])
    )
  } finally {
    ancestors.delete(value)
  }
}

export const ClientKindSchema = z.enum(["desktop", "mobile", "web", "cli", "mcp", "hub"])
export type ClientKind = z.infer<typeof ClientKindSchema>

export const RuntimeMethodSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(
    /^(runtime|wallet|chain|policy|browser|dapp|audit|settings)\.[A-Za-z0-9._-]+$/,
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
    agents: z
      .object({
        codex: CodexAgentSettingsSchema,
        defaults: z.record(z.string(), z.record(z.string(), HarnessSettingValueSchema)),
      })
      .strict(),
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
    agents: z
      .object({
        codex: CodexAgentSettingsSchema.partial().strict().optional(),
        defaults: z.record(z.string(), z.record(z.string(), HarnessSettingValueSchema)).optional(),
      })
      .strict()
      .optional(),
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
  | AgentManagementClientMessage
  | IntegrationClientMessage
  | GitClientMessage
  | CodexHarnessClientMessage
  | HarnessClientMessage
  | ProjectThreadClientMessage
  | ScheduleClientMessage
  | TerminalClientMessage
  | ThreadClientMessage
  | Web3ClientMessage

export const SessionInboundMessageSchema = discriminatedUnionByType<SessionInboundMessage>([
  ServerStatusGetRequestSchema,
  ServerDiagnosticsRequestSchema,
  ServerConfigGetRequestSchema,
  ServerConfigPatchRequestSchema,
  ServerConfigReloadRequestSchema,
  ...AGENT_MANAGEMENT_CLIENT_SCHEMAS,
  ...INTEGRATION_CLIENT_SCHEMAS,
  ...GIT_CLIENT_SCHEMAS,
  ...CODEX_HARNESS_CLIENT_SCHEMAS,
  ...HARNESS_CLIENT_SCHEMAS,
  ...PROJECT_THREAD_CLIENT_SCHEMAS,
  ...SCHEDULE_CLIENT_SCHEMAS,
  ...TERMINAL_CLIENT_SCHEMAS,
  ...THREAD_CLIENT_SCHEMAS,
  ...WEB3_CLIENT_SCHEMAS,
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
  | AgentManagementServerMessage
  | IntegrationServerMessage
  | GitServerMessage
  | CodexHarnessServerMessage
  | HarnessServerMessage
  | ProjectThreadServerMessage
  | ScheduleServerMessage
  | TerminalServerMessage
  | ThreadServerMessage
  | Web3ServerMessage

export const SessionOutboundMessageSchema = discriminatedUnionByType<SessionOutboundMessage>([
  ServerStatusNotificationSchema,
  ServerStatusGetResponseSchema,
  ServerDiagnosticsResponseSchema,
  ServerConfigGetResponseSchema,
  ServerConfigPatchResponseSchema,
  ServerConfigReloadResponseSchema,
  ...AGENT_MANAGEMENT_SERVER_SCHEMAS,
  ...INTEGRATION_SERVER_SCHEMAS,
  ...GIT_SERVER_SCHEMAS,
  ...CODEX_HARNESS_SERVER_SCHEMAS,
  ...HARNESS_SERVER_SCHEMAS,
  ...PROJECT_THREAD_SERVER_SCHEMAS,
  ...SCHEDULE_SERVER_SCHEMAS,
  ...TERMINAL_SERVER_SCHEMAS,
  ...THREAD_SERVER_SCHEMAS,
  ...WEB3_SERVER_SCHEMAS,
])

export type ServerMessage = SessionOutboundMessage
export const ServerMessageSchema = SessionOutboundMessageSchema

const clientResponseTypes = new Set<string>([
  "server.status.response",
  "server.diagnostics.response",
  "server.config.get.response",
  "server.config.patch.response",
  "server.config.reload.response",
  "agent.list.response",
  "agent.add.response",
  "agent.remove.response",
  "agent.get.response",
  "agent.install.response",
  "agent.update.response",
  "agent.uninstall.response",
  "agent.enable.response",
  "agent.disable.response",
  "agent.start.response",
  "agent.stop.response",
  "agent.operation.get.response",
  "agent.operation.list.response",
  "agent.toolchain.list.response",
  "agent.toolchain.check_updates.response",
  "agent.toolchain.update.response",
  ...PROJECT_THREAD_RESPONSE_TYPES,
  ...INTEGRATION_RESPONSE_TYPES,
  ...GIT_RESPONSE_TYPES,
  ...HARNESS_RESPONSE_TYPES,
  ...CODEX_HARNESS_RESPONSE_TYPES,
  ...SCHEDULE_RESPONSE_TYPES,
  ...TERMINAL_RESPONSE_TYPES,
  ...THREAD_RESPONSE_TYPES,
  ...WEB3_RESPONSE_TYPES,
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

/** Encodes one validated Cypheria application value as deterministic CBOR bytes. */
export function encodeProtocolMessage(value: unknown): Uint8Array {
  return encode(prepareProtocolValue(value), {
    cde: true,
    rejectDuplicateKeys: true,
    rejectUndefined: true,
  })
}

/** Decodes one preferred, deterministic CBOR item and enforces the Cypheria value profile. */
export function decodeProtocolMessage(raw: Uint8Array): unknown {
  const value = decode<unknown>(raw, {
    cde: true,
    createObject: createProtocolObject,
    maxDepth: CYPHERIA_CBOR_MAX_DEPTH,
    rejectDuplicateKeys: true,
  })
  assertProtocolValue(value)
  return value
}

export function decodeClientMessage(raw: Uint8Array): ClientMessage {
  return decodeSessionInboundMessage(raw)
}

export function decodeServerMessage(raw: Uint8Array): ServerMessage {
  return decodeSessionOutboundMessage(raw)
}

export function decodeSessionInboundMessage(raw: Uint8Array): SessionInboundMessage {
  return parseSessionInboundMessage(decodeProtocolMessage(raw))
}

export function decodeSessionOutboundMessage(raw: Uint8Array): SessionOutboundMessage {
  return parseSessionOutboundMessage(decodeProtocolMessage(raw))
}

export function decodeWSInboundMessage(raw: Uint8Array): WSInboundMessage {
  return parseWSInboundMessage(decodeProtocolMessage(raw))
}

export function decodeWSOutboundMessage(raw: Uint8Array): WSOutboundMessage {
  return parseWSOutboundMessage(decodeProtocolMessage(raw))
}

export function createWebSocketProtocols(token?: string): string[] {
  const protocols: string[] = [CYPHERIA_WEBSOCKET_PROTOCOL]
  if (token) protocols.push(`cypheria.bearer.${token}`)
  return protocols
}
