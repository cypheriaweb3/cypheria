import {
  dappSessionSchema,
  walletProviderRequestSchema,
  walletProviderResponseSchema,
} from "@cypheria/web3/provider"
import { z } from "zod"

export * from "./codex.js"
export * from "./integrations.js"

export const IPC_PROTOCOL_VERSION = 1

export const ipcNamespaces = ["app", "browser", "dapp", "settings", "storage"] as const

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
  settingsOpenTargetsList: "settings.open-targets.list",
  settingsNotificationSoundsList: "settings.notification-sounds.list",
  settingsNotificationSoundPreview: "settings.notification-sound.preview",
  storageAttachmentDelete: "storage.attachment.delete",
  storageAttachmentCopyFile: "storage.attachment.copy-file",
  storageAttachmentList: "storage.attachment.list",
  storageAttachmentListPage: "storage.attachment.list-page",
  storageAttachmentRead: "storage.attachment.read",
  storageAttachmentStat: "storage.attachment.stat",
  storageAttachmentWrite: "storage.attachment.write",
  storageKeyValueChanged: "storage.key-value.changed",
  storageKeyValueGet: "storage.key-value.get",
  storageKeyValueListPage: "storage.key-value.list-page",
  storageKeyValueRemove: "storage.key-value.remove",
  storageKeyValueSet: "storage.key-value.set",
  storageReplicaApply: "storage.replica.apply",
  storageReplicaClear: "storage.replica.clear",
  storageReplicaDeleteScope: "storage.replica.delete-scope",
  storageReplicaListPage: "storage.replica.list-page",
  storageReplicaOpen: "storage.replica.open",
  storageReplicaRead: "storage.replica.read",
  storageReplicaReadAll: "storage.replica.read-all",
  storageReplicaRenameScope: "storage.replica.rename-scope",
} as const

export type CypheriaIpcChannel = (typeof CYPHERIA_IPC_CHANNELS)[keyof typeof CYPHERIA_IPC_CHANNELS]

export const EmptyPayloadSchema = z.object({}).strict()
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>

export const MAX_DESKTOP_ATTACHMENT_BYTES = 32 * 1024 * 1024
export const AttachmentStorageKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)
export const AttachmentBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0, "Attachment bytes cannot be empty.")
  .refine(
    (bytes) => bytes.byteLength <= MAX_DESKTOP_ATTACHMENT_BYTES,
    `Attachment bytes cannot exceed ${MAX_DESKTOP_ATTACHMENT_BYTES} bytes.`
  )

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
  })
  .strict()
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export const AppearanceSettingsWriteSchema = AppearanceSettingsSchema
export type AppearanceSettingsWrite = z.infer<typeof AppearanceSettingsWriteSchema>
export const CYPHERIA_APPEARANCE_ARGUMENT_PREFIX = "--cypheria-appearance="
export const CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX = "--cypheria-development="
export const CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX = "--cypheria-window-role="

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
  locale: SupportedLocaleSchema,
}).strict()
export type LanguageSettings = z.infer<typeof LanguageSettingsSchema>
export const LanguageBootstrapSchema = z
  .object({ locale: SupportedLocaleSchema, localeOverride: LanguageLocaleSchema.nullable() })
  .strict()
export type LanguageBootstrap = z.infer<typeof LanguageBootstrapSchema>
export const CYPHERIA_LANGUAGE_ARGUMENT_PREFIX = "--cypheria-language="

export type ClientSettingCategory =
  | "activity"
  | "appearance"
  | "composer"
  | "general"
  | "git-ui"
  | "locale"
  | "notifications"
  | "panel"
  | "popout"
  | "sidebar"

export type ClientSettingDefinition<Value> = Readonly<{
  category: ClientSettingCategory
  defaultValue: Value
  key: string
  schema: z.ZodType<Value>
  version: 1
}>

const defineClientSetting = <Value>(
  definition: ClientSettingDefinition<Value>
): ClientSettingDefinition<Value> => definition

const defaultFontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const defaultFontMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"'

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettingsWrite =
  AppearanceSettingsWriteSchema.parse({
    theme: "system",
    lightThemeId: "codex",
    darkThemeId: "codex",
    lightTheme: {
      accent: "#0169cc",
      accentSource: "chatgpt",
      contrast: 45,
      fonts: { code: defaultFontMono, ui: defaultFontSans },
      ink: "#0d0d0d",
      opaqueWindows: false,
      semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: "#751ed9" },
      surface: "#ffffff",
    },
    darkTheme: {
      accent: "#0169cc",
      accentSource: "chatgpt",
      contrast: 60,
      fonts: { code: defaultFontMono, ui: defaultFontSans },
      ink: "#fcfcfc",
      opaqueWindows: true,
      semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: "#b06dff" },
      surface: "#111111",
    },
    uiFontSize: 14,
    codeFontSize: 13,
    diffMarkerStyle: "color",
    reducedMotionPreference: "system",
    useFontSmoothing: true,
    usePointerCursors: false,
  })

export const NotificationSoundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("bundled"), sound: z.enum(["default", "classic"]) }).strict(),
  z.object({ type: z.literal("system"), name: z.string().trim().min(1) }).strict(),
  z.object({ type: z.literal("custom"), path: z.string().trim().min(1) }).strict(),
])
export type NotificationSound = z.infer<typeof NotificationSoundSchema>

export const ClientPreferencesSnapshotSchema = z
  .object({
    projectlessWorkspaceRoot: z.string().min(1),
    openInTargetPreference: z.string().min(1),
    macMenuBarEnabled: z.boolean(),
    preventSleepWhileRunning: z.boolean(),
    permissionModeVisibility: z.boolean(),
    composerPlainTextMode: z.boolean(),
    showContextWindowUsage: z.boolean(),
    composerEnterBehavior: z.enum(["enter", "cmdIfMultiline", "cmdAlways"]),
    followUpQueueMode: z.enum(["queue", "steer"]),
    hotkeyWindowHotkey: z.string().nullable(),
    hotkeyWindowProjectlessDefaultEnabled: z.boolean(),
    notificationsTurnMode: z.enum(["off", "unfocused", "always"]),
    notificationsPermissionsEnabled: z.boolean(),
    notificationsQuestionsEnabled: z.boolean(),
    notificationSound: NotificationSoundSchema,
  })
  .strict()
export type ClientPreferencesSnapshot = z.infer<typeof ClientPreferencesSnapshotSchema>

export type ClientSettingDefinitions = Readonly<{
  appearance: ClientSettingDefinition<AppearanceSettingsWrite>
  localeOverride: ClientSettingDefinition<LanguageLocale | null>
  projectlessWorkspaceRoot: ClientSettingDefinition<string | null>
  openInTargetPreference: ClientSettingDefinition<string>
  macMenuBarEnabled: ClientSettingDefinition<boolean>
  preventSleepWhileRunning: ClientSettingDefinition<boolean>
  permissionModeVisibility: ClientSettingDefinition<boolean>
  composerPlainTextMode: ClientSettingDefinition<boolean>
  showContextWindowUsage: ClientSettingDefinition<boolean>
  composerEnterBehavior: ClientSettingDefinition<"enter" | "cmdIfMultiline" | "cmdAlways">
  followUpQueueMode: ClientSettingDefinition<"queue" | "steer">
  defaultTerminalLocation: ClientSettingDefinition<"bottom" | "right">
  showBottomPanelControl: ClientSettingDefinition<boolean>
  hotkeyWindowHotkey: ClientSettingDefinition<string | null>
  hotkeyWindowProjectlessDefaultEnabled: ClientSettingDefinition<boolean>
  notificationsTurnMode: ClientSettingDefinition<"off" | "unfocused" | "always">
  notificationsPermissionsEnabled: ClientSettingDefinition<boolean>
  notificationsQuestionsEnabled: ClientSettingDefinition<boolean>
  notificationSound: ClientSettingDefinition<NotificationSound>
  sidebarOrganization: ClientSettingDefinition<"by-project" | "one-list">
  pinnedSidebarSort: ClientSettingDefinition<"priority" | "updated" | "created" | "manual">
  chatSidebarSort: ClientSettingDefinition<"priority" | "updated" | "created" | "manual">
  gitReviewSource: ClientSettingDefinition<
    "unstaged" | "staged" | "uncommitted" | "branch" | "commit" | "last-turn"
  >
  unreadThreadIds: ClientSettingDefinition<string[]>
}>

export const clientSettingDefinitions: ClientSettingDefinitions = {
  appearance: defineClientSetting({
    category: "appearance",
    defaultValue: DEFAULT_APPEARANCE_SETTINGS,
    key: "appearance",
    schema: AppearanceSettingsWriteSchema,
    version: 1,
  }),
  localeOverride: defineClientSetting({
    category: "locale",
    defaultValue: null as LanguageLocale | null,
    key: "localeOverride",
    schema: LanguageLocaleSchema.nullable(),
    version: 1,
  }),
  projectlessWorkspaceRoot: defineClientSetting({
    category: "general",
    defaultValue: null as string | null,
    key: "projectlessWorkspaceRoot",
    schema: z.string().trim().min(1).nullable(),
    version: 1,
  }),
  openInTargetPreference: defineClientSetting({
    category: "general",
    defaultValue: "system",
    key: "openInTargetPreference",
    schema: z.string().trim().min(1),
    version: 1,
  }),
  macMenuBarEnabled: defineClientSetting({
    category: "general",
    defaultValue: true,
    key: "macMenuBarEnabled",
    schema: z.boolean(),
    version: 1,
  }),
  preventSleepWhileRunning: defineClientSetting({
    category: "general",
    defaultValue: false,
    key: "preventSleepWhileRunning",
    schema: z.boolean(),
    version: 1,
  }),
  permissionModeVisibility: defineClientSetting({
    category: "composer",
    defaultValue: false,
    key: "permissionModeVisibility",
    schema: z.boolean(),
    version: 1,
  }),
  composerPlainTextMode: defineClientSetting({
    category: "composer",
    defaultValue: false,
    key: "composerPlainTextMode",
    schema: z.boolean(),
    version: 1,
  }),
  showContextWindowUsage: defineClientSetting({
    category: "composer",
    defaultValue: false,
    key: "showContextWindowUsage",
    schema: z.boolean(),
    version: 1,
  }),
  composerEnterBehavior: defineClientSetting({
    category: "composer",
    defaultValue: "enter" as const,
    key: "composerEnterBehavior",
    schema: z.enum(["enter", "cmdIfMultiline", "cmdAlways"]),
    version: 1,
  }),
  followUpQueueMode: defineClientSetting({
    category: "composer",
    defaultValue: "steer" as const,
    key: "followUpQueueMode",
    schema: z.enum(["queue", "steer"]),
    version: 1,
  }),
  defaultTerminalLocation: defineClientSetting({
    category: "panel",
    defaultValue: "bottom" as const,
    key: "defaultTerminalLocation",
    schema: z.enum(["bottom", "right"]),
    version: 1,
  }),
  showBottomPanelControl: defineClientSetting({
    category: "panel",
    defaultValue: true,
    key: "showBottomPanelControl",
    schema: z.boolean(),
    version: 1,
  }),
  hotkeyWindowHotkey: defineClientSetting({
    category: "popout",
    defaultValue: null as string | null,
    key: "hotkeyWindowHotkey",
    schema: z.string().trim().min(1).nullable(),
    version: 1,
  }),
  hotkeyWindowProjectlessDefaultEnabled: defineClientSetting({
    category: "popout",
    defaultValue: false,
    key: "hotkeyWindowProjectlessDefaultEnabled",
    schema: z.boolean(),
    version: 1,
  }),
  notificationsTurnMode: defineClientSetting({
    category: "notifications",
    defaultValue: "unfocused" as const,
    key: "notificationsTurnMode",
    schema: z.enum(["off", "unfocused", "always"]),
    version: 1,
  }),
  notificationsPermissionsEnabled: defineClientSetting({
    category: "notifications",
    defaultValue: true,
    key: "notificationsPermissionsEnabled",
    schema: z.boolean(),
    version: 1,
  }),
  notificationsQuestionsEnabled: defineClientSetting({
    category: "notifications",
    defaultValue: true,
    key: "notificationsQuestionsEnabled",
    schema: z.boolean(),
    version: 1,
  }),
  notificationSound: defineClientSetting({
    category: "notifications",
    defaultValue: { type: "bundled", sound: "default" } as NotificationSound,
    key: "notificationSound",
    schema: NotificationSoundSchema,
    version: 1,
  }),
  sidebarOrganization: defineClientSetting({
    category: "sidebar",
    defaultValue: "by-project" as const,
    key: "sidebarOrganization",
    schema: z.enum(["by-project", "one-list"]),
    version: 1,
  }),
  pinnedSidebarSort: defineClientSetting({
    category: "sidebar",
    defaultValue: "manual" as const,
    key: "pinnedSidebarSort",
    schema: z.enum(["priority", "updated", "created", "manual"]),
    version: 1,
  }),
  chatSidebarSort: defineClientSetting({
    category: "sidebar",
    defaultValue: "updated" as const,
    key: "chatSidebarSort",
    schema: z.enum(["priority", "updated", "created", "manual"]),
    version: 1,
  }),
  gitReviewSource: defineClientSetting({
    category: "git-ui",
    defaultValue: "unstaged" as const,
    key: "gitReviewSource",
    schema: z.enum(["unstaged", "staged", "uncommitted", "branch", "commit", "last-turn"]),
    version: 1,
  }),
  unreadThreadIds: defineClientSetting({
    category: "activity",
    defaultValue: [] as string[],
    key: "unreadThreadIds",
    schema: z.array(z.string().min(1)).max(1_000),
    version: 1,
  }),
}

export type ClientSettingName = keyof typeof clientSettingDefinitions

export const AttachmentMetadataSchema = z
  .object({
    id: z.string().min(1),
    storageKey: AttachmentStorageKeySchema,
    storageType: z.enum(["desktop-file", "native-file", "web-indexeddb"]),
    mimeType: z.string().min(1),
    fileName: z.string().nullable(),
    byteSize: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

const draftOwnedAttachmentSchema = <
  const Kind extends "image" | "audio" | "file" | "pasted-text" | "appshot",
>(
  kind: Kind
) =>
  z
    .object({
      id: z.string().min(1),
      kind: z.literal(kind),
      name: z.string().min(1),
      attachment: AttachmentMetadataSchema,
      status: z.enum(["ready", "unavailable"]).default("ready"),
      error: z.string().max(2_048).optional(),
    })
    .strict()
const DraftReferenceStatusSchema = z.enum(["ready", "degraded", "unavailable"])
export type ComposerDraftAttachment =
  | {
      id: string
      kind: "image" | "audio" | "file" | "pasted-text" | "appshot"
      name: string
      attachment: z.infer<typeof AttachmentMetadataSchema>
      status: "ready" | "unavailable"
      error?: string
    }
  | {
      id: string
      kind: "resource-link"
      name: string
      uri: string
      mimeType?: string
      status: "ready" | "degraded" | "unavailable"
    }
  | { id: string; kind: "workspace-file"; name: string; path: string }
  | {
      id: string
      kind: "browser-tab"
      title: string
      tabIdentity?: string
      url?: string
      status: "ready" | "degraded" | "unavailable"
    }
  | {
      id: string
      kind: "mcp-resource"
      name: string
      uri: string
      server?: string
      summary?: string
      status: "ready" | "degraded" | "unavailable"
    }
  | { id: string; kind: "selected-text"; text: string; source?: string }
  | {
      id: string
      kind: "app-context"
      name: string
      content: string
      imageAttachments: Array<z.infer<typeof AttachmentMetadataSchema>>
    }

export const ComposerDraftAttachmentSchema: z.ZodType<ComposerDraftAttachment> =
  z.discriminatedUnion("kind", [
    draftOwnedAttachmentSchema("image"),
    draftOwnedAttachmentSchema("audio"),
    draftOwnedAttachmentSchema("file"),
    draftOwnedAttachmentSchema("pasted-text"),
    draftOwnedAttachmentSchema("appshot"),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("resource-link"),
        name: z.string().min(1),
        uri: z.string().min(1),
        mimeType: z.string().min(1).optional(),
        status: DraftReferenceStatusSchema.default("ready"),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("workspace-file"),
        name: z.string().min(1),
        path: z.string().min(1),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("browser-tab"),
        title: z.string().min(1),
        tabIdentity: z.string().min(1).optional(),
        url: z.url().optional(),
        status: DraftReferenceStatusSchema.default("ready"),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("mcp-resource"),
        name: z.string().min(1),
        uri: z.string().min(1),
        server: z.string().min(1).optional(),
        summary: z.string().max(4_096).optional(),
        status: DraftReferenceStatusSchema.default("ready"),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("selected-text"),
        text: z.string().max(256_000),
        source: z.string().max(2_048).optional(),
      })
      .strict(),
    z
      .object({
        id: z.string().min(1),
        kind: z.literal("app-context"),
        name: z.string().min(1),
        content: z.string().max(256_000),
        imageAttachments: z.array(AttachmentMetadataSchema).max(16).default([]),
      })
      .strict(),
  ]) as z.ZodType<ComposerDraftAttachment>

export type ComposerDraft = {
  text: string
  attachments: ComposerDraftAttachment[]
  status: "editing" | "submitting" | "failed"
  updatedAt: number
}

export const ComposerDraftSchema: z.ZodType<ComposerDraft> = z
  .object({
    text: z.string().max(1_000_000),
    attachments: z.array(ComposerDraftAttachmentSchema).max(100),
    status: z.enum(["editing", "submitting", "failed"]),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict() as z.ZodType<ComposerDraft>

export type PanelLayoutCheckpoint = {
  right: {
    visible: boolean
    size: number
    activeTab: string | null
    openTabs: string[]
    fullscreen: boolean
  }
  bottom: {
    visible: boolean
    size: number
    activeTab: string | null
    openTabs: string[]
  }
  focusedPanel: "right" | "bottom" | null
}

export const PanelLayoutCheckpointSchema: z.ZodType<PanelLayoutCheckpoint> = z
  .object({
    right: z
      .object({
        visible: z.boolean(),
        size: z.number().min(180).max(2_000),
        activeTab: z.string().min(1).nullable(),
        openTabs: z.array(z.string().min(1)).max(100),
        fullscreen: z.boolean(),
      })
      .strict(),
    bottom: z
      .object({
        visible: z.boolean(),
        size: z.number().min(100).max(1_500),
        activeTab: z.string().min(1).nullable(),
        openTabs: z.array(z.string().min(1)).max(100),
      })
      .strict(),
    focusedPanel: z.enum(["right", "bottom"]).nullable(),
  })
  .strict() as z.ZodType<PanelLayoutCheckpoint>

export const panelLayoutKey = (threadId: string): string => `panelLayout:${threadId}`
export const composerDraftKey = (scopeId: string): string => `composerDraft:${scopeId}`

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

export const settingsAppearanceFontsListContract = {
  channel: CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList,
  namespace: "settings",
  request: EmptyPayloadSchema,
  response: z.array(AppearanceFontOptionSchema),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, AppearanceFontOption[]>

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

export const storageAttachmentWriteContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentWrite,
  namespace: "storage",
  request: z
    .object({ storageKey: AttachmentStorageKeySchema, bytes: AttachmentBytesSchema })
    .strict(),
  response: z.object({ byteSize: z.number().int().positive() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ storageKey: string; bytes: Uint8Array }, { byteSize: number }>

export const storageAttachmentCopyFileContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentCopyFile,
  namespace: "storage",
  request: z
    .object({ storageKey: AttachmentStorageKeySchema, uri: z.string().trim().min(1) })
    .strict(),
  response: z.object({ byteSize: z.number().int().positive() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ storageKey: string; uri: string }, { byteSize: number }>

export const storageAttachmentReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentRead,
  namespace: "storage",
  request: z.object({ storageKey: AttachmentStorageKeySchema }).strict(),
  response: z.object({ bytes: AttachmentBytesSchema }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ storageKey: string }, { bytes: Uint8Array }>

export const storageAttachmentStatContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentStat,
  namespace: "storage",
  request: z.object({ storageKey: AttachmentStorageKeySchema }).strict(),
  response: z.object({ byteSize: z.number().int().nonnegative(), exists: z.boolean() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ storageKey: string }, { byteSize: number; exists: boolean }>

export const storageAttachmentDeleteContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentDelete,
  namespace: "storage",
  request: z.object({ storageKey: AttachmentStorageKeySchema }).strict(),
  response: z.object({ deleted: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ storageKey: string }, { deleted: true }>

export const storageAttachmentListContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentList,
  namespace: "storage",
  request: EmptyPayloadSchema,
  response: z.object({ storageKeys: z.array(AttachmentStorageKeySchema) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { storageKeys: string[] }>

export const StoragePageRequestSchema = z
  .object({
    cursor: z.string().min(1).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    query: z.string().max(256).optional(),
  })
  .strict()
export type StoragePageRequest = z.infer<typeof StoragePageRequestSchema>

const MAX_STORAGE_KEY_CHARACTERS = 512
const MAX_STORAGE_VALUE_CHARACTERS = 16 * 1024 * 1024
const MAX_REPLICA_BATCH_ROWS = 10_000
const StorageKeySchema = z.string().min(1).max(MAX_STORAGE_KEY_CHARACTERS)
const StorageValueSchema = z.string().max(MAX_STORAGE_VALUE_CHARACTERS)
const StorageTextPreviewSchema = z.string().max(240)

export const KeyValueInspectionEntrySchema = z
  .object({
    key: StorageKeySchema,
    valueLength: z.number().int().nonnegative(),
    valuePreview: StorageTextPreviewSchema,
    valueTruncated: z.boolean(),
  })
  .strict()
export type KeyValueInspectionEntry = z.infer<typeof KeyValueInspectionEntrySchema>

export const StorageKeyValueChangeSchema = z
  .object({ key: StorageKeySchema, value: StorageValueSchema.nullable() })
  .strict()
export type StorageKeyValueChange = z.infer<typeof StorageKeyValueChangeSchema>

const ReplicaIdentifierSchema = z.string().min(1).max(1_024)
export const ReplicaRowKeySchema = z
  .object({
    scopeId: ReplicaIdentifierSchema,
    entityType: ReplicaIdentifierSchema,
    entityId: ReplicaIdentifierSchema,
  })
  .strict()
export type ReplicaRowKey = z.infer<typeof ReplicaRowKeySchema>

export const ReplicaRowSchema = ReplicaRowKeySchema.extend({ payload: StorageValueSchema }).strict()
export type ReplicaRow = z.infer<typeof ReplicaRowSchema>

export const ReplicaScopeRowsSchema = z
  .object({ scopeId: ReplicaIdentifierSchema, rows: z.array(ReplicaRowSchema) })
  .strict()
export type ReplicaScopeRows = z.infer<typeof ReplicaScopeRowsSchema>

export const ReplicaInspectionEntrySchema = ReplicaRowKeySchema.extend({
  payloadLength: z.number().int().nonnegative(),
  payloadPreview: StorageTextPreviewSchema,
  payloadTruncated: z.boolean(),
}).strict()
export type ReplicaInspectionEntry = z.infer<typeof ReplicaInspectionEntrySchema>

export const storageKeyValueGetContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageKeyValueGet,
  namespace: "storage",
  request: z.object({ key: StorageKeySchema }).strict(),
  response: z.object({ value: StorageValueSchema.nullable() }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ key: string }, { value: string | null }>

export const storageKeyValueSetContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageKeyValueSet,
  namespace: "storage",
  request: z.object({ key: StorageKeySchema, value: StorageValueSchema }).strict(),
  response: z.object({ saved: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ key: string; value: string }, { saved: true }>

export const storageKeyValueRemoveContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageKeyValueRemove,
  namespace: "storage",
  request: z.object({ key: StorageKeySchema }).strict(),
  response: z.object({ removed: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ key: string }, { removed: true }>

export const storageKeyValueListPageContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageKeyValueListPage,
  namespace: "storage",
  request: StoragePageRequestSchema,
  response: z
    .object({
      items: z.array(KeyValueInspectionEntrySchema),
      nextCursor: z.string().min(1).nullable(),
    })
    .strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  StoragePageRequest,
  { items: KeyValueInspectionEntry[]; nextCursor: string | null }
>

export const storageReplicaOpenContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaOpen,
  namespace: "storage",
  request: EmptyPayloadSchema,
  response: z.object({ opened: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { opened: true }>

export const storageReplicaReadContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaRead,
  namespace: "storage",
  request: z
    .object({
      scopeId: ReplicaIdentifierSchema,
      entityTypes: z.array(ReplicaIdentifierSchema).max(MAX_REPLICA_BATCH_ROWS),
      entityIds: z.array(ReplicaIdentifierSchema).max(MAX_REPLICA_BATCH_ROWS).optional(),
    })
    .strict(),
  response: z.object({ rows: z.array(ReplicaRowSchema) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  { scopeId: string; entityTypes: string[]; entityIds?: string[] },
  { rows: ReplicaRow[] }
>

export const storageReplicaReadAllContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaReadAll,
  namespace: "storage",
  request: EmptyPayloadSchema,
  response: z.object({ scopes: z.array(ReplicaScopeRowsSchema) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { scopes: ReplicaScopeRows[] }>

export const storageReplicaListPageContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaListPage,
  namespace: "storage",
  request: StoragePageRequestSchema,
  response: z
    .object({
      items: z.array(ReplicaInspectionEntrySchema),
      nextCursor: z.string().min(1).nullable(),
    })
    .strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  StoragePageRequest,
  { items: ReplicaInspectionEntry[]; nextCursor: string | null }
>

export const storageReplicaApplyContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaApply,
  namespace: "storage",
  request: z
    .object({
      deletes: z.array(ReplicaRowKeySchema).max(MAX_REPLICA_BATCH_ROWS),
      upserts: z.array(ReplicaRowSchema).max(MAX_REPLICA_BATCH_ROWS),
    })
    .strict(),
  response: z.object({ applied: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ deletes: ReplicaRowKey[]; upserts: ReplicaRow[] }, { applied: true }>

export const storageReplicaDeleteScopeContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaDeleteScope,
  namespace: "storage",
  request: z.object({ scopeId: ReplicaIdentifierSchema }).strict(),
  response: z.object({ deleted: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ scopeId: string }, { deleted: true }>

export const storageReplicaRenameScopeContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaRenameScope,
  namespace: "storage",
  request: z
    .object({ oldScopeId: ReplicaIdentifierSchema, newScopeId: ReplicaIdentifierSchema })
    .strict(),
  response: z.object({ renamed: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<{ oldScopeId: string; newScopeId: string }, { renamed: true }>

export const storageReplicaClearContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageReplicaClear,
  namespace: "storage",
  request: EmptyPayloadSchema,
  response: z.object({ cleared: z.literal(true) }).strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<EmptyPayload, { cleared: true }>

export const AttachmentFileInspectionEntrySchema = z
  .object({
    storageKey: AttachmentStorageKeySchema,
    byteSize: z.number().int().positive(),
    bytePreview: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= 32),
  })
  .strict()
export type AttachmentFileInspectionEntry = z.infer<typeof AttachmentFileInspectionEntrySchema>

export const storageAttachmentListPageContract = {
  channel: CYPHERIA_IPC_CHANNELS.storageAttachmentListPage,
  namespace: "storage",
  request: StoragePageRequestSchema,
  response: z
    .object({
      items: z.array(AttachmentFileInspectionEntrySchema),
      nextCursor: z.string().min(1).nullable(),
    })
    .strict(),
  version: IPC_PROTOCOL_VERSION,
} satisfies IpcContract<
  StoragePageRequest,
  { items: AttachmentFileInspectionEntry[]; nextCursor: string | null }
>

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
  settingsOpenTargetsList: settingsOpenTargetsListContract,
  settingsNotificationSoundsList: settingsNotificationSoundsListContract,
  settingsNotificationSoundPreview: settingsNotificationSoundPreviewContract,
  storageAttachmentDelete: storageAttachmentDeleteContract,
  storageAttachmentCopyFile: storageAttachmentCopyFileContract,
  storageAttachmentList: storageAttachmentListContract,
  storageAttachmentListPage: storageAttachmentListPageContract,
  storageAttachmentRead: storageAttachmentReadContract,
  storageAttachmentStat: storageAttachmentStatContract,
  storageAttachmentWrite: storageAttachmentWriteContract,
  storageKeyValueGet: storageKeyValueGetContract,
  storageKeyValueListPage: storageKeyValueListPageContract,
  storageKeyValueRemove: storageKeyValueRemoveContract,
  storageKeyValueSet: storageKeyValueSetContract,
  storageReplicaApply: storageReplicaApplyContract,
  storageReplicaClear: storageReplicaClearContract,
  storageReplicaDeleteScope: storageReplicaDeleteScopeContract,
  storageReplicaListPage: storageReplicaListPageContract,
  storageReplicaOpen: storageReplicaOpenContract,
  storageReplicaRead: storageReplicaReadContract,
  storageReplicaReadAll: storageReplicaReadAllContract,
  storageReplicaRenameScope: storageReplicaRenameScopeContract,
} as const

export type CypheriaPreloadApi = {
  readonly bootstrap: {
    readonly appearance: AppearanceSettingsWrite
    readonly development: boolean
    readonly language: LanguageBootstrap
    readonly windowRole: "main" | "popout"
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
  readonly storage: {
    readonly attachments: {
      readonly getPathForFile: (file: File) => string
      readonly delete: (storageKey: string) => Promise<{ deleted: true }>
      readonly copyFileUri: (storageKey: string, uri: string) => Promise<{ byteSize: number }>
      readonly list: () => Promise<{ storageKeys: string[] }>
      readonly listPage: (request: StoragePageRequest) => Promise<{
        items: AttachmentFileInspectionEntry[]
        nextCursor: string | null
      }>
      readonly read: (storageKey: string) => Promise<{ bytes: Uint8Array }>
      readonly stat: (storageKey: string) => Promise<{ byteSize: number; exists: boolean }>
      readonly write: (storageKey: string, bytes: Uint8Array) => Promise<{ byteSize: number }>
    }
    readonly keyValue: {
      readonly getItem: (key: string) => Promise<{ value: string | null }>
      readonly setItem: (key: string, value: string) => Promise<{ saved: true }>
      readonly removeItem: (key: string) => Promise<{ removed: true }>
      readonly listPage: (request: StoragePageRequest) => Promise<{
        items: KeyValueInspectionEntry[]
        nextCursor: string | null
      }>
      readonly onChanged: (handler: (change: StorageKeyValueChange) => void) => () => void
    }
    readonly replica: {
      readonly open: () => Promise<{ opened: true }>
      readonly read: (
        scopeId: string,
        entityTypes: readonly string[],
        entityIds?: readonly string[]
      ) => Promise<{ rows: ReplicaRow[] }>
      readonly readAll: () => Promise<{ scopes: ReplicaScopeRows[] }>
      readonly listPage: (request: StoragePageRequest) => Promise<{
        items: ReplicaInspectionEntry[]
        nextCursor: string | null
      }>
      readonly apply: (changes: {
        readonly deletes: readonly ReplicaRowKey[]
        readonly upserts: readonly ReplicaRow[]
      }) => Promise<{ applied: true }>
      readonly deleteScope: (scopeId: string) => Promise<{ deleted: true }>
      readonly renameScope: (oldScopeId: string, newScopeId: string) => Promise<{ renamed: true }>
      readonly clear: () => Promise<{ cleared: true }>
    }
  }
  readonly settings: {
    readonly listOpenTargets: () => Promise<OpenTarget[]>
    readonly listNotificationSounds: () => Promise<string[]>
    readonly previewNotificationSound: () => Promise<{ played: boolean }>
    readonly listAppearanceFonts: () => Promise<AppearanceFontOption[]>
  }
}
