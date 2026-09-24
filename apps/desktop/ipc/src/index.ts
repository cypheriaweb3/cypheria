import {
  dappSessionSchema,
  walletProviderRequestSchema,
  walletProviderResponseSchema,
} from "@cypheria/web3/provider"
import { z } from "zod"
import {
  type ConnectionProxySettings,
  ConnectionProxySettingsSchema,
  type ConnectionProxyTestResult,
  ConnectionProxyTestResultSchema,
} from "./connections.js"

export * from "./codex.js"
export * from "./connections.js"
export * from "./integrations.js"

export const IPC_PROTOCOL_VERSION = 1

export const ipcNamespaces = ["app", "browser", "dapp", "settings"] as const

export const IpcNamespaceSchema = z.enum(ipcNamespaces)
export type IpcNamespace = z.infer<typeof IpcNamespaceSchema>

export const CYPHERIA_IPC_CHANNELS = {
  appHealthCheck: "app.health.check",
  appMetadataRead: "app.metadata.read",
  appExternalOpen: "app.external.open",
  appDirectoryPick: "app.directory.pick",
  appSoundPick: "app.sound.pick",
  appConfigOpen: "app.config.open",
  appProjectReveal: "app.project.reveal",
  appProjectOpen: "app.project.open",
  appGitFileAction: "app.git-file.action",
  browserSessionOpen: "browser.session.open",
  dappProviderRequest: "dapp.provider.request",
  dappProviderEvent: "dapp.provider.event",
  settingsAppearanceFontsList: "settings.appearance.fonts.list",
  settingsAppearanceRead: "settings.appearance.read",
  settingsAppearanceWrite: "settings.appearance.write",
  settingsLanguageChanged: "settings.language.changed",
  settingsLanguageRead: "settings.language.read",
  settingsLanguageWrite: "settings.language.write",
  settingsWorkspaceLayoutRead: "settings.workspace-layout.read",
  settingsWorkspaceLayoutWrite: "settings.workspace-layout.write",
  settingsPreferencesRead: "settings.preferences.read",
  settingsOpenTargetsList: "settings.open-targets.list",
  settingsNotificationSoundsList: "settings.notification-sounds.list",
  settingsNotificationSoundPreview: "settings.notification-sound.preview",
  settingsPreferencesWrite: "settings.preferences.write",
  settingsPreferencesChanged: "settings.preferences.changed",
  settingsConnectionProxyRead: "settings.connection-proxy.read",
  settingsConnectionProxyTest: "settings.connection-proxy.test",
  settingsConnectionProxyWrite: "settings.connection-proxy.write",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export const EmptyPayloadSchema = z.object({}).strict()
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>

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
        codeFace: z
          .object({
            family: z.string().min(1),
            fullName: z.string().min(1).optional(),
            postscriptName: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        ui: z.string().min(1),
        uiFace: z
          .object({
            family: z.string().min(1),
            fullName: z.string().min(1).optional(),
            postscriptName: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
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
    theme: AppearanceThemeModeSchema,
    lightThemeId: AppearanceCodeThemeIdSchema,
    darkThemeId: AppearanceCodeThemeIdSchema,
    lightTheme: AppearanceChromeThemeSchema,
    darkTheme: AppearanceChromeThemeSchema,
    uiFontSize: z.number().min(11).max(16),
    codeFontSize: z.number().min(8).max(24),
    diffMarkerStyle: AppearanceDiffMarkerStyleSchema,
    reducedMotionPreference: AppearanceReducedMotionPreferenceSchema,
    useFontSmoothing: z.boolean(),
    usePointerCursors: z.boolean(),
    configPath: z.string().min(1),
  })
  .strict()
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export const AppearanceSettingsWriteSchema = AppearanceSettingsSchema.omit({ configPath: true })
export type AppearanceSettingsWrite = z.infer<typeof AppearanceSettingsWriteSchema>
export const CYPHERIA_APPEARANCE_ARGUMENT_PREFIX = "--cypheria-appearance="
export const CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX = "--cypheria-development="

export const SupportedLocaleSchema = z.enum(["en", "zh-CN"])
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>
export const LanguageLocaleSchema = z.enum([
  "sq",
  "is",
  "zh-TW",
  "zh-HK",
  "ka",
  "zh-CN",
  "mk",
  "mn",
  "my",
  "ja",
  "so",
  "hy",
  "ms",
  "bs",
  "ca",
  "cs",
  "da",
  "de",
  "et",
  "en",
  "es-ES",
  "es-419",
  "fil",
  "fr-CA",
  "fr-FR",
  "hr",
  "id",
  "it",
  "sw",
  "lv",
  "lt",
  "hu",
  "nl",
  "nb",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "sk",
  "sl",
  "fi",
  "sv",
  "vi",
  "tr",
  "el",
  "bg",
  "kk",
  "ru",
  "sr",
  "uk",
  "ur",
  "ar",
  "fa",
  "am",
  "mr",
  "hi",
  "bn",
  "pa",
  "gu",
  "ta",
  "te",
  "kn",
  "ml",
  "th",
  "ko",
])
export type LanguageLocale = z.infer<typeof LanguageLocaleSchema>
export const LanguagePreferenceSchema = z.union([z.literal("system"), LanguageLocaleSchema])
export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>
export const LanguageSettingsWriteSchema = z
  .object({ preference: LanguagePreferenceSchema })
  .strict()
export type LanguageSettingsWrite = z.infer<typeof LanguageSettingsWriteSchema>
export const LanguageSettingsSchema = LanguageSettingsWriteSchema.extend({
  configPath: z.string().min(1),
  locale: SupportedLocaleSchema,
}).strict()
export type LanguageSettings = z.infer<typeof LanguageSettingsSchema>
export const LanguageBootstrapSchema = LanguageSettingsSchema.omit({ configPath: true })
export type LanguageBootstrap = z.infer<typeof LanguageBootstrapSchema>
export const CYPHERIA_LANGUAGE_ARGUMENT_PREFIX = "--cypheria-language="

export const WorkspaceLayoutSettingsWriteSchema = z
  .object({
    defaultTerminalLocation: z.enum(["bottom", "right"]),
    showBottomPanelControl: z.boolean(),
  })
  .strict()
export type WorkspaceLayoutSettingsWrite = z.infer<typeof WorkspaceLayoutSettingsWriteSchema>
export const WorkspaceLayoutSettingsSchema = WorkspaceLayoutSettingsWriteSchema.extend({
  configPath: z.string().min(1),
}).strict()
export type WorkspaceLayoutSettings = z.infer<typeof WorkspaceLayoutSettingsSchema>

export const DesktopPreferencesWriteSchema = z
  .object({
    projectlessWorkspaceRoot: z.string().min(1).nullable(),
    openInTargetPreference: z.string().min(1),
    macMenuBarEnabled: z.boolean(),
    preventSleepWhileRunning: z.boolean(),
    pluginsEnabled: z.boolean(),
    composerPlainTextMode: z.boolean(),
    showContextWindowUsage: z.boolean(),
    composerEnterBehavior: z.enum(["enter", "cmdIfMultiline", "cmdAlways"]),
    followUpQueueMode: z.enum(["queue", "steer"]),
    hotkeyWindowHotkey: z.string().nullable(),
    hotkeyWindowProjectlessDefaultEnabled: z.boolean(),
    notificationsTurnMode: z.enum(["off", "unfocused", "always"]),
    notificationsPermissionsEnabled: z.boolean(),
    notificationsQuestionsEnabled: z.boolean(),
    notificationSound: z.string().min(1),
    notificationCustomSoundPath: z.string().min(1).nullable(),
  })
  .strict()
export type DesktopPreferencesWrite = z.infer<typeof DesktopPreferencesWriteSchema>
export const DesktopPreferencesSchema = DesktopPreferencesWriteSchema.extend({
  configPath: z.string().min(1),
}).strict()
export type DesktopPreferences = z.infer<typeof DesktopPreferencesSchema>

export const OpenTargetSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1) })
  .strict()
export type OpenTarget = z.infer<typeof OpenTargetSchema>

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

export const BrowserSessionOpenSchema = z
  .object({
    url: z.url().refine((value) => {
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(url.hostname)))
      )
    }),
  })
  .strict()
export type BrowserSessionOpen = z.infer<typeof BrowserSessionOpenSchema>

export const BrowserSessionOpenResultSchema = z
  .object({ session: dappSessionSchema, webContentsId: z.number().int().positive() })
  .strict()
export type BrowserSessionOpenResult = z.infer<typeof BrowserSessionOpenResultSchema>

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

export const appExternalOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.appExternalOpen,
  namespace: "app",
  request: z
    .object({
      url: z
        .string()
        .url()
        .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    })
    .strict(),
  response: z.object({ opened: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ url: string }, { opened: true }>

export const appDirectoryPickContract = {
  channel: CYPHERIA_IPC_CHANNELS.appDirectoryPick,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: z.object({ path: z.string().min(1).nullable() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { path: string | null }>

export const appSoundPickContract = {
  channel: CYPHERIA_IPC_CHANNELS.appSoundPick,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: z.object({ path: z.string().min(1).nullable() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { path: string | null }>

export const appConfigOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.appConfigOpen,
  namespace: "app",
  request: EmptyPayloadSchema,
  response: z.object({ opened: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { opened: true }>
export const appProjectRevealContract = {
  channel: CYPHERIA_IPC_CHANNELS.appProjectReveal,
  namespace: "app",
  request: z.object({ projectId: z.string().min(1) }).strict(),
  response: z.object({ revealed: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ projectId: string }, { revealed: true }>
export const appProjectOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.appProjectOpen,
  namespace: "app",
  request: z.object({ projectId: z.string().min(1) }).strict(),
  response: z.object({ opened: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ projectId: string }, { opened: true }>
export const appGitFileActionContract = {
  channel: CYPHERIA_IPC_CHANNELS.appGitFileAction,
  namespace: "app",
  request: z
    .object({ cwd: z.string().min(1), path: z.string().min(1), action: z.enum(["open", "save"]) })
    .strict(),
  response: z.object({ completed: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  { cwd: string; path: string; action: "open" | "save" },
  { completed: boolean }
>

export const browserSessionOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.browserSessionOpen,
  namespace: "browser",
  request: BrowserSessionOpenSchema,
  response: BrowserSessionOpenResultSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<BrowserSessionOpen, BrowserSessionOpenResult>

export const dappProviderRequestContract = {
  channel: CYPHERIA_IPC_CHANNELS.dappProviderRequest,
  namespace: "dapp",
  request: walletProviderRequestSchema,
  response: walletProviderResponseSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  z.input<typeof walletProviderRequestSchema>,
  z.output<typeof walletProviderResponseSchema>
>

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
  request: AppearanceSettingsWriteSchema,
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

export const settingsLanguageReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsLanguageRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: LanguageSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, LanguageSettings>

export const settingsLanguageWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsLanguageWrite,
  namespace: "settings",
  request: LanguageSettingsWriteSchema,
  response: LanguageSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<LanguageSettingsWrite, LanguageSettings>

export const settingsWorkspaceLayoutReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsWorkspaceLayoutRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: WorkspaceLayoutSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, WorkspaceLayoutSettings>

export const settingsWorkspaceLayoutWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsWorkspaceLayoutWrite,
  namespace: "settings",
  request: WorkspaceLayoutSettingsWriteSchema,
  response: WorkspaceLayoutSettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<WorkspaceLayoutSettingsWrite, WorkspaceLayoutSettings>

export const settingsPreferencesReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsPreferencesRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: DesktopPreferencesSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, DesktopPreferences>

export const settingsOpenTargetsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsOpenTargetsList,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.array(OpenTargetSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, OpenTarget[]>

export const settingsNotificationSoundsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsNotificationSoundsList,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.array(z.string().min(1)),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, string[]>

export const settingsNotificationSoundPreviewContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsNotificationSoundPreview,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.object({ played: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { played: boolean }>

export const settingsPreferencesWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsPreferencesWrite,
  namespace: "settings",
  request: DesktopPreferencesWriteSchema,
  response: DesktopPreferencesSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<DesktopPreferencesWrite, DesktopPreferences>

export const settingsConnectionProxyReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsConnectionProxyRead,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: ConnectionProxySettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, ConnectionProxySettings>

export const settingsConnectionProxyWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsConnectionProxyWrite,
  namespace: "settings",
  request: ConnectionProxySettingsSchema,
  response: ConnectionProxySettingsSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<ConnectionProxySettings, ConnectionProxySettings>

export const settingsConnectionProxyTestContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsConnectionProxyTest,
  namespace: "settings",
  request: ConnectionProxySettingsSchema,
  response: ConnectionProxyTestResultSchema,
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<ConnectionProxySettings, ConnectionProxyTestResult>

export const ipcContracts = {
  appDirectoryPick: appDirectoryPickContract,
  appSoundPick: appSoundPickContract,
  appExternalOpen: appExternalOpenContract,
  appHealthCheck: appHealthCheckContract,
  appMetadataRead: appMetadataReadContract,
  appConfigOpen: appConfigOpenContract,
  appProjectReveal: appProjectRevealContract,
  appProjectOpen: appProjectOpenContract,
  appGitFileAction: appGitFileActionContract,
  browserSessionOpen: browserSessionOpenContract,
  dappProviderRequest: dappProviderRequestContract,
  settingsAppearanceFontsList: settingsAppearanceFontsListContract,
  settingsAppearanceRead: settingsAppearanceReadContract,
  settingsAppearanceWrite: settingsAppearanceWriteContract,
  settingsLanguageRead: settingsLanguageReadContract,
  settingsLanguageWrite: settingsLanguageWriteContract,
  settingsWorkspaceLayoutRead: settingsWorkspaceLayoutReadContract,
  settingsWorkspaceLayoutWrite: settingsWorkspaceLayoutWriteContract,
  settingsPreferencesRead: settingsPreferencesReadContract,
  settingsOpenTargetsList: settingsOpenTargetsListContract,
  settingsNotificationSoundsList: settingsNotificationSoundsListContract,
  settingsNotificationSoundPreview: settingsNotificationSoundPreviewContract,
  settingsPreferencesWrite: settingsPreferencesWriteContract,
  settingsConnectionProxyRead: settingsConnectionProxyReadContract,
  settingsConnectionProxyTest: settingsConnectionProxyTestContract,
  settingsConnectionProxyWrite: settingsConnectionProxyWriteContract,
} as const

export type CypheriaPreloadApi = {
  readonly bootstrap: {
    readonly appearance: AppearanceSettingsWrite
    readonly development: boolean
    readonly language: LanguageBootstrap
  }
  readonly app: {
    readonly platform: NodeJS.Platform
    readonly getHealth: () => Promise<AppHealthStatus>
    readonly getMetadata: () => Promise<AppMetadata>
    readonly pickDirectory: () => Promise<{ path: string | null }>
    readonly pickSoundFile: () => Promise<{ path: string | null }>
    readonly openExternal: (url: string) => Promise<{ opened: true }>
    readonly openConfig: () => Promise<{ opened: true }>
    readonly revealProject: (projectId: string) => Promise<{ revealed: true }>
    readonly openProject: (projectId: string) => Promise<{ opened: true }>
    readonly gitFileAction: (input: {
      cwd: string
      path: string
      action: "open" | "save"
    }) => Promise<{ completed: boolean }>
  }
  readonly browser: {
    readonly openDapp: (url: string) => Promise<BrowserSessionOpenResult>
  }
  readonly settings: {
    readonly getAppearance: () => Promise<AppearanceSettings>
    readonly getConnectionProxy: () => Promise<ConnectionProxySettings>
    readonly getLanguage: () => Promise<LanguageSettings>
    readonly getWorkspaceLayout: () => Promise<WorkspaceLayoutSettings>
    readonly getPreferences: () => Promise<DesktopPreferences>
    readonly listOpenTargets: () => Promise<OpenTarget[]>
    readonly listNotificationSounds: () => Promise<string[]>
    readonly previewNotificationSound: () => Promise<{ played: boolean }>
    readonly listAppearanceFonts: () => Promise<AppearanceFontOption[]>
    readonly onLanguageChanged: (handler: (settings: LanguageSettings) => void) => () => void
    readonly onPreferencesChanged: (handler: (settings: DesktopPreferences) => void) => () => void
    readonly setAppearance: (settings: AppearanceSettingsWrite) => Promise<AppearanceSettings>
    readonly setConnectionProxy: (
      settings: ConnectionProxySettings
    ) => Promise<ConnectionProxySettings>
    readonly setLanguage: (settings: LanguageSettingsWrite) => Promise<LanguageSettings>
    readonly setWorkspaceLayout: (
      settings: WorkspaceLayoutSettingsWrite
    ) => Promise<WorkspaceLayoutSettings>
    readonly setPreferences: (settings: DesktopPreferencesWrite) => Promise<DesktopPreferences>
    readonly testConnectionProxy: (
      settings: ConnectionProxySettings
    ) => Promise<ConnectionProxyTestResult>
  }
}
