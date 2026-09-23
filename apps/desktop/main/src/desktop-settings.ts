import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { z } from "zod"

import {
  AppearanceSettingsWriteSchema,
  DesktopPreferencesWriteSchema,
  LanguageSettingsWriteSchema,
  WorkspaceLayoutSettingsWriteSchema,
} from "../../ipc/src/index.js"

const defaultFontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const defaultFontMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"'

export const defaultAppearanceSettings = AppearanceSettingsWriteSchema.parse({
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

export const defaultWorkspaceLayoutSettings = WorkspaceLayoutSettingsWriteSchema.parse({
  defaultTerminalLocation: "bottom",
  showBottomPanelControl: true,
})

export const defaultDesktopPreferences = DesktopPreferencesWriteSchema.parse({
  projectlessWorkspaceRoot: null,
  openInTargetPreference: "system",
  macMenuBarEnabled: process.platform === "darwin",
  preventSleepWhileRunning: false,
  pluginsEnabled: true,
  composerPlainTextMode: false,
  showContextWindowUsage: false,
  composerEnterBehavior: "enter",
  followUpQueueMode: "steer",
  hotkeyWindowHotkey: null,
  hotkeyWindowProjectlessDefaultEnabled: false,
  notificationsTurnMode: "unfocused",
  notificationsPermissionsEnabled: true,
  notificationsQuestionsEnabled: true,
  notificationSound: "default",
  notificationCustomSoundPath: null,
})

const DesktopSettingsDocumentSchema = z
  .object({
    version: z.literal(1),
    appearance: AppearanceSettingsWriteSchema,
    language: LanguageSettingsWriteSchema,
    workspaceLayout: WorkspaceLayoutSettingsWriteSchema,
    preferences: DesktopPreferencesWriteSchema.default(defaultDesktopPreferences),
    server: z
      .object({
        autoStart: z.boolean(),
        executablePath: z.string().min(1).nullable(),
        preferredPort: z.number().int().min(1).max(65_535).nullable(),
      })
      .strict(),
    window: z.object({ maximized: z.boolean() }).strict(),
    behavior: z.object({ soundsEnabled: z.boolean(), automaticUpdates: z.boolean() }).strict(),
  })
  .strict()

export type DesktopSettingsDocument = z.infer<typeof DesktopSettingsDocumentSchema>

export const defaultDesktopSettings: DesktopSettingsDocument = {
  version: 1,
  appearance: defaultAppearanceSettings,
  language: { preference: "system" },
  workspaceLayout: defaultWorkspaceLayoutSettings,
  preferences: defaultDesktopPreferences,
  server: { autoStart: true, executablePath: null, preferredPort: null },
  window: { maximized: false },
  behavior: { automaticUpdates: true, soundsEnabled: true },
}

const settingsFileName = "config.json"
const writeQueues = new Map<string, Promise<unknown>>()

export const getDesktopSettingsPath = (userDataDir: string): string =>
  join(userDataDir, settingsFileName)

export const readDesktopSettings = async (
  userDataDir: string
): Promise<DesktopSettingsDocument> => {
  const settingsPath = getDesktopSettingsPath(userDataDir)
  try {
    return DesktopSettingsDocumentSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")))
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    return DesktopSettingsDocumentSchema.parse(defaultDesktopSettings)
  }
}

export const updateDesktopSettings = async (
  userDataDir: string,
  update: (current: DesktopSettingsDocument) => DesktopSettingsDocument
): Promise<DesktopSettingsDocument> => {
  const settingsPath = getDesktopSettingsPath(userDataDir)
  const previous = writeQueues.get(settingsPath) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const next = DesktopSettingsDocumentSchema.parse(
        update(await readDesktopSettings(userDataDir))
      )
      const temporaryPath = `${settingsPath}.${process.pid}.tmp`
      await mkdir(dirname(settingsPath), { recursive: true })
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporaryPath, settingsPath)
      return next
    })
  writeQueues.set(settingsPath, operation)
  return operation
}

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"
