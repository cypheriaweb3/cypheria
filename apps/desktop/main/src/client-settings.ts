import { randomUUID } from "node:crypto"
import type { KeyValueStorage } from "@cypheria/storage"
import { readValidatedValue, writeValidatedValue } from "@cypheria/storage"
import {
  type AppearanceSettingsWrite,
  type ClientPreferencesSnapshot,
  type ClientSettingDefinition,
  clientSettingDefinitions,
  DesktopClientIdSchema,
  type LanguageLocale,
  type NotificationSound,
  type SupportedLocale,
} from "../../ipc/src/index.js"

export const readClientSetting = <Value>(
  storage: KeyValueStorage,
  definition: ClientSettingDefinition<Value>
): Promise<Value> =>
  readValidatedValue(storage, definition.key, definition.defaultValue, definition.schema, {
    version: definition.version,
  })

export const writeClientSetting = <Value>(
  storage: KeyValueStorage,
  definition: ClientSettingDefinition<Value>,
  value: Value
): Promise<void> =>
  writeValidatedValue(storage, definition.key, value, definition.schema, {
    version: definition.version,
  })

const DESKTOP_CLIENT_ID_KEY = "cypheria.desktop.client-id"

/**
 * The Desktop's client ID, created once per Cypheria home and shared by Electron main and every
 * window. The Server joins their connections into one session and knows the device's computer host
 * by it, so the host keeps its ID across reloads, reconnects, and restarts.
 */
export const readDesktopClientId = async (
  storage: KeyValueStorage,
  create: () => string = () => `cid_${randomUUID()}`
): Promise<string> => {
  const stored = DesktopClientIdSchema.safeParse(await storage.getItem(DESKTOP_CLIENT_ID_KEY))
  if (stored.success) return stored.data
  const id = DesktopClientIdSchema.parse(create())
  await storage.setItem(DESKTOP_CLIENT_ID_KEY, id)
  return id
}

export const resolveSupportedLocale = (
  override: LanguageLocale | null,
  preferredSystemLanguages: readonly string[]
): SupportedLocale => {
  if (override !== null) return override === "zh-CN" ? "zh-CN" : "en"
  for (const language of preferredSystemLanguages) {
    const normalized = language.toLowerCase()
    if (
      normalized === "zh" ||
      normalized.startsWith("zh-cn") ||
      normalized.startsWith("zh-sg") ||
      normalized.startsWith("zh-hans")
    ) {
      return "zh-CN"
    }
    if (normalized === "en" || normalized.startsWith("en-")) return "en"
  }
  return "en"
}

export const readAppearance = (storage: KeyValueStorage): Promise<AppearanceSettingsWrite> =>
  readClientSetting(storage, clientSettingDefinitions.appearance)

export const readLocaleBootstrap = async (
  storage: KeyValueStorage,
  preferredSystemLanguages: readonly string[]
) => {
  const localeOverride = await readClientSetting(storage, clientSettingDefinitions.localeOverride)
  return {
    locale: resolveSupportedLocale(localeOverride, preferredSystemLanguages),
    localeOverride,
  }
}

export const readNotificationSound = (storage: KeyValueStorage): Promise<NotificationSound> =>
  readClientSetting(storage, clientSettingDefinitions.notificationSound)

export const readClientPreferences = async (
  storage: KeyValueStorage
): Promise<ClientPreferencesSnapshot> => {
  const [
    openInTargetPreference,
    macMenuBarEnabled,
    preventSleepWhileRunning,
    composerPlainTextMode,
    showContextWindowUsage,
    composerEnterBehavior,
    followUpQueueMode,
    notificationsTurnMode,
    notificationsPermissionsEnabled,
    notificationsQuestionsEnabled,
    notificationSound,
  ] = await Promise.all([
    readClientSetting(storage, clientSettingDefinitions.openInTargetPreference),
    readClientSetting(storage, clientSettingDefinitions.macMenuBarEnabled),
    readClientSetting(storage, clientSettingDefinitions.preventSleepWhileRunning),
    readClientSetting(storage, clientSettingDefinitions.composerPlainTextMode),
    readClientSetting(storage, clientSettingDefinitions.showContextWindowUsage),
    readClientSetting(storage, clientSettingDefinitions.composerEnterBehavior),
    readClientSetting(storage, clientSettingDefinitions.followUpQueueMode),
    readClientSetting(storage, clientSettingDefinitions.notificationsTurnMode),
    readClientSetting(storage, clientSettingDefinitions.notificationsPermissionsEnabled),
    readClientSetting(storage, clientSettingDefinitions.notificationsQuestionsEnabled),
    readClientSetting(storage, clientSettingDefinitions.notificationSound),
  ])
  return {
    openInTargetPreference,
    macMenuBarEnabled,
    preventSleepWhileRunning,
    composerPlainTextMode,
    showContextWindowUsage,
    composerEnterBehavior,
    followUpQueueMode,
    notificationsTurnMode,
    notificationsPermissionsEnabled,
    notificationsQuestionsEnabled,
    notificationSound,
  }
}

const sideEffectKeys = new Set([
  clientSettingDefinitions.appearance.key,
  clientSettingDefinitions.localeOverride.key,
  clientSettingDefinitions.macMenuBarEnabled.key,
  clientSettingDefinitions.preventSleepWhileRunning.key,
  clientSettingDefinitions.notificationsTurnMode.key,
  clientSettingDefinitions.notificationsPermissionsEnabled.key,
  clientSettingDefinitions.notificationsQuestionsEnabled.key,
  clientSettingDefinitions.notificationSound.key,
  clientSettingDefinitions.openInTargetPreference.key,
])

export const clientSettingHasMainSideEffect = (key: string): boolean => sideEffectKeys.has(key)
