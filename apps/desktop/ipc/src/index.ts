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
  codexEvent: "codex.event",
  runtimeInfoRead: "runtime.info.read",
  settingsAppearanceFontsList: "settings.appearance.fonts.list",
  settingsAppearanceRead: "settings.appearance.read",
  settingsAppearanceWrite: "settings.appearance.write",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export const EmptyPayloadSchema = z.object({}).strict()
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>

export const RuntimeInfoSchema = z
  .object({
    codex: z
      .object({
        listenUrl: z.string().url(),
        state: z.enum(["ready", "starting", "stopped", "stopping"]),
      })
      .strict()
      .optional(),
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

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const AppearanceThemeModeSchema = z.enum(["dark", "light", "system"])
export type AppearanceThemeMode = z.infer<typeof AppearanceThemeModeSchema>

export const AppearanceDiffMarkerStyleSchema = z.enum(["color", "symbols"])
export type AppearanceDiffMarkerStyle = z.infer<typeof AppearanceDiffMarkerStyleSchema>

export const AppearanceReducedMotionPreferenceSchema = z.enum(["system", "on", "off"])
export type AppearanceReducedMotionPreference = z.infer<
  typeof AppearanceReducedMotionPreferenceSchema
>

export const AppearanceCodeThemeIdSchema = z.enum([
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "proof",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
])
export type AppearanceCodeThemeId = z.infer<typeof AppearanceCodeThemeIdSchema>

export const AppearanceChromeThemeSchema = z
  .object({
    accent: HexColorSchema,
    accentSource: z.enum(["chatgpt", "custom"]).optional(),
    contrast: z.number().min(0).max(100),
    fonts: z
      .object({
        code: z.string().min(1),
        ui: z.string().min(1),
      })
      .strict(),
    ink: HexColorSchema,
    opaqueWindows: z.boolean(),
    semanticColors: z
      .object({
        diffAdded: HexColorSchema,
        diffRemoved: HexColorSchema,
        skill: HexColorSchema,
      })
      .strict(),
    surface: HexColorSchema,
  })
  .strict()
export type AppearanceChromeTheme = z.infer<typeof AppearanceChromeThemeSchema>

export const AppearanceSettingsSchema = z
  .object({
    appearanceTheme: AppearanceThemeModeSchema,
    codeFontSize: z.number().min(8).max(24),
    codeThemes: z
      .object({
        dark: AppearanceCodeThemeIdSchema,
        light: AppearanceCodeThemeIdSchema,
      })
      .strict(),
    configPath: z.string().min(1),
    diffMarkerStyle: AppearanceDiffMarkerStyleSchema,
    reducedMotionPreference: AppearanceReducedMotionPreferenceSchema,
    sansFontSize: z.number().min(11).max(16),
    themes: z
      .object({
        dark: AppearanceChromeThemeSchema,
        light: AppearanceChromeThemeSchema,
      })
      .strict(),
    useFontSmoothing: z.boolean(),
    usePointerCursors: z.boolean(),
  })
  .strict()
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export type AppearanceSettingsWrite = Pick<
  AppearanceSettings,
  | "appearanceTheme"
  | "codeFontSize"
  | "codeThemes"
  | "diffMarkerStyle"
  | "reducedMotionPreference"
  | "sansFontSize"
  | "themes"
  | "useFontSmoothing"
  | "usePointerCursors"
>

export const AppearanceFontFaceSchema = z
  .object({
    family: z.string().min(1),
    fullName: z.string().min(1).optional(),
    postscriptName: z.string().min(1).optional(),
    style: z.string().min(1).optional(),
  })
  .strict()
export type AppearanceFontFace = z.infer<typeof AppearanceFontFaceSchema>

export const AppearanceFontOptionSchema = z
  .object({
    faces: z.array(AppearanceFontFaceSchema),
    family: z.string().min(1),
    styles: z.array(z.string().min(1)),
  })
  .strict()
export type AppearanceFontOption = z.infer<typeof AppearanceFontOptionSchema>

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

export const CodexEventTypeSchema = z.enum([
  "codex.error",
  "codex.lifecycle",
  "codex.notification",
  "codex.serverRequest",
  "codex.stderr",
])
export type CodexEventType = z.infer<typeof CodexEventTypeSchema>

export const CodexLifecyclePayloadSchema = z
  .object({
    state: z.string().min(1),
  })
  .strict()
export type CodexLifecyclePayload = z.infer<typeof CodexLifecyclePayloadSchema>

export const CodexMessagePayloadSchema = z
  .object({
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict()
export type CodexMessagePayload = z.infer<typeof CodexMessagePayloadSchema>

export const CodexErrorPayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()
export type CodexErrorPayload = z.infer<typeof CodexErrorPayloadSchema>

export const CodexStderrPayloadSchema = z
  .object({
    line: z.string(),
  })
  .strict()
export type CodexStderrPayload = z.infer<typeof CodexStderrPayloadSchema>

export const CodexEventPayloadSchema = z.union([
  CodexLifecyclePayloadSchema,
  CodexMessagePayloadSchema,
  CodexErrorPayloadSchema,
  CodexStderrPayloadSchema,
])
export type CodexEventPayload = z.infer<typeof CodexEventPayloadSchema>

export const CodexEventEnvelopeSchema = IpcEventEnvelopeSchema.extend({
  event: CodexEventTypeSchema,
  namespace: z.literal("codex"),
  payload: CodexEventPayloadSchema,
}).strict()
export type CodexEventEnvelope = z.infer<typeof CodexEventEnvelopeSchema>

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

export const settingsAppearanceReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: AppearanceSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppearanceSettings>

export const settingsAppearanceWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceWrite,
  namespace: "settings",
  request: AppearanceSettingsSchema.pick({
    appearanceTheme: true,
    codeFontSize: true,
    codeThemes: true,
    diffMarkerStyle: true,
    reducedMotionPreference: true,
    sansFontSize: true,
    themes: true,
    useFontSmoothing: true,
    usePointerCursors: true,
  }),
  response: AppearanceSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<AppearanceSettingsWrite, AppearanceSettings>

export const settingsAppearanceFontsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.array(AppearanceFontOptionSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppearanceFontOption[]>

export const ipcContracts = {
  appHealthCheck: appHealthCheckContract,
  appMetadataRead: appMetadataReadContract,
  runtimeInfoRead: runtimeInfoReadContract,
  settingsAppearanceFontsList: settingsAppearanceFontsListContract,
  settingsAppearanceRead: settingsAppearanceReadContract,
  settingsAppearanceWrite: settingsAppearanceWriteContract,
} as const

export type CypheriaPreloadApi = {
  readonly app: {
    readonly platform: NodeJS.Platform
    readonly getHealth: () => Promise<AppHealthStatus>
    readonly getMetadata: () => Promise<AppMetadata>
  }
  readonly codex: {
    readonly onEvent: (handler: (event: CodexEventEnvelope) => void) => () => void
  }
  readonly runtime: {
    readonly getInfo: () => Promise<RuntimeInfo>
  }
  readonly settings: {
    readonly getAppearance: () => Promise<AppearanceSettings>
    readonly listAppearanceFonts: () => Promise<AppearanceFontOption[]>
    readonly setAppearance: (settings: AppearanceSettingsWrite) => Promise<AppearanceSettings>
  }
}
