import { homedir } from "node:os"
import { join } from "node:path"
import type { KeyValueStorage } from "@cypheria/storage"
import { readValidatedValue } from "@cypheria/storage"
import {
  type AppearanceSettingsWrite,
  type ClientPreferencesSnapshot,
  type ClientSettingDefinition,
  clientSettingDefinitions,
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
    projectlessWorkspaceRoot,
    openInTargetPreference,
    macMenuBarEnabled,
    preventSleepWhileRunning,
    permissionModeVisibility,
    composerPlainTextMode,
    showContextWindowUsage,
    composerEnterBehavior,
    followUpQueueMode,
    hotkeyWindowHotkey,
    hotkeyWindowProjectlessDefaultEnabled,
    notificationsTurnMode,
    notificationsPermissionsEnabled,
    notificationsQuestionsEnabled,
    notificationSound,
  ] = await Promise.all([
    readClientSetting(storage, clientSettingDefinitions.projectlessWorkspaceRoot),
    readClientSetting(storage, clientSettingDefinitions.openInTargetPreference),
    readClientSetting(storage, clientSettingDefinitions.macMenuBarEnabled),
    readClientSetting(storage, clientSettingDefinitions.preventSleepWhileRunning),
    readClientSetting(storage, clientSettingDefinitions.permissionModeVisibility),
    readClientSetting(storage, clientSettingDefinitions.composerPlainTextMode),
    readClientSetting(storage, clientSettingDefinitions.showContextWindowUsage),
    readClientSetting(storage, clientSettingDefinitions.composerEnterBehavior),
    readClientSetting(storage, clientSettingDefinitions.followUpQueueMode),
    readClientSetting(storage, clientSettingDefinitions.hotkeyWindowHotkey),
    readClientSetting(storage, clientSettingDefinitions.hotkeyWindowProjectlessDefaultEnabled),
    readClientSetting(storage, clientSettingDefinitions.notificationsTurnMode),
    readClientSetting(storage, clientSettingDefinitions.notificationsPermissionsEnabled),
    readClientSetting(storage, clientSettingDefinitions.notificationsQuestionsEnabled),
    readClientSetting(storage, clientSettingDefinitions.notificationSound),
  ])
  return {
    projectlessWorkspaceRoot: projectlessWorkspaceRoot ?? join(homedir(), "Documents", "Cypheria"),
    openInTargetPreference,
    macMenuBarEnabled,
    preventSleepWhileRunning,
    permissionModeVisibility,
    composerPlainTextMode,
    showContextWindowUsage,
    composerEnterBehavior,
    followUpQueueMode,
    hotkeyWindowHotkey,
    hotkeyWindowProjectlessDefaultEnabled,
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
  clientSettingDefinitions.hotkeyWindowHotkey.key,
  clientSettingDefinitions.hotkeyWindowProjectlessDefaultEnabled.key,
  clientSettingDefinitions.notificationsTurnMode.key,
  clientSettingDefinitions.notificationsPermissionsEnabled.key,
  clientSettingDefinitions.notificationsQuestionsEnabled.key,
  clientSettingDefinitions.notificationSound.key,
  clientSettingDefinitions.openInTargetPreference.key,
  clientSettingDefinitions.projectlessWorkspaceRoot.key,
])

export const clientSettingHasMainSideEffect = (key: string): boolean => sideEffectKeys.has(key)
