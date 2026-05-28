import { z } from "zod"

export const IPC_PROTOCOL_VERSION = 1

export const ipcNamespaces = [
  "app",
  "runtime",
  "codex",
  "wallet",
  "chain",
  "browser",
  "dapp",
  "policy",
  "automation",
  "approval",
  "settings",
  "audit",
] as const

export const IpcNamespaceSchema = z.enum(ipcNamespaces)
export type IpcNamespace = z.infer<typeof IpcNamespaceSchema>

export const CYPHERIA_IPC_CHANNELS = {
  appHealthCheck: "app.health.check",
  appMetadataRead: "app.metadata.read",
  runtimeInfoRead: "runtime.info.read",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export const EmptyPayloadSchema = z.object({}).strict()
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>

export const RuntimeInfoSchema = z
  .object({
    codexHome: z.string().min(1),
    cypheriaHome: z.string().min(1),
    directories: z
      .object({
        automation: z.string().min(1),
        browser: z.string().min(1),
        cache: z.string().min(1),
        config: z.string().min(1),
        db: z.string().min(1),
        logs: z.string().min(1),
        vault: z.string().min(1),
      })
      .strict(),
  })
  .strict()
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>

export const AppMetadataSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .strict()
export type AppMetadata = z.infer<typeof AppMetadataSchema>

export const AppHealthStatusSchema = z
  .object({
    checkedAt: z.string().datetime(),
    protocolVersion: z.literal(IPC_PROTOCOL_VERSION),
    status: z.literal("ok"),
  })
  .strict()
export type AppHealthStatus = z.infer<typeof AppHealthStatusSchema>

export const IpcRequestEnvelopeSchema = z
  .object({
    channel: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    payload: z.unknown(),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcRequestEnvelope = z.infer<typeof IpcRequestEnvelopeSchema>

export const IpcErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_ERROR",
  "UNAVAILABLE",
  "VALIDATION_ERROR",
])
export type IpcErrorCode = z.infer<typeof IpcErrorCodeSchema>

export const IpcErrorEnvelopeSchema = z
  .object({
    correlationId: z.string().min(1).optional(),
    error: z
      .object({
        code: IpcErrorCodeSchema,
        details: z.unknown().optional(),
        message: z.string().min(1),
      })
      .strict(),
    ok: z.literal(false),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcErrorEnvelope = z.infer<typeof IpcErrorEnvelopeSchema>

export const createIpcSuccessEnvelopeSchema = <TPayload extends z.ZodType>(
  payloadSchema: TPayload
) =>
  z
    .object({
      correlationId: z.string().min(1).optional(),
      ok: z.literal(true),
      payload: payloadSchema,
      version: z.literal(IPC_PROTOCOL_VERSION),
    })
    .strict()

export type IpcSuccessEnvelope<TPayload> = {
  readonly correlationId?: string
  readonly ok: true
  readonly payload: TPayload
  readonly version: typeof IPC_PROTOCOL_VERSION
}

export type IpcResponseEnvelope<TPayload> = IpcSuccessEnvelope<TPayload> | IpcErrorEnvelope

export const IpcEventEnvelopeSchema = z
  .object({
    correlationId: z.string().min(1).optional(),
    event: z.string().min(1),
    namespace: IpcNamespaceSchema,
    payload: z.unknown(),
    timestamp: z.string().datetime(),
    version: z.literal(IPC_PROTOCOL_VERSION),
  })
  .strict()
export type IpcEventEnvelope = z.infer<typeof IpcEventEnvelopeSchema>

export type IpcContract<TRequestPayload, TResponsePayload> = {
  readonly channel: CypheriaIpcChannel
  readonly namespace: IpcNamespace
  readonly request: z.ZodType<TRequestPayload>
  readonly response: z.ZodType<TResponsePayload>
  readonly version: typeof IPC_PROTOCOL_VERSION
}

export const appMetadataReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.appMetadataRead,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: AppMetadataSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppMetadata>

export const appHealthCheckContract = {
  channel: CYPHERIA_IPC_CHANNELS.appHealthCheck,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: AppHealthStatusSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppHealthStatus>

export const runtimeInfoReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.runtimeInfoRead,
  namespace: "runtime",
  request: EmptyPayloadSchema,
  response: RuntimeInfoSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, RuntimeInfo>

export const ipcContracts = {
  appHealthCheck: appHealthCheckContract,
  appMetadataRead: appMetadataReadContract,
  runtimeInfoRead: runtimeInfoReadContract,
} as const

export type CypheriaPreloadApi = {
  readonly app: {
    readonly getHealth: () => Promise<AppHealthStatus>
    readonly getMetadata: () => Promise<AppMetadata>
  }
  readonly runtime: {
    readonly getInfo: () => Promise<RuntimeInfo>
  }
}
