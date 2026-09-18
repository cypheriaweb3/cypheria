import {
  type LanguageSettings,
  type LanguageSettingsWrite,
  LanguageSettingsWriteSchema,
  type SupportedLocale,
} from "../../ipc/src/index.js"
import {
  getDesktopSettingsPath,
  readDesktopSettings,
  updateDesktopSettings,
} from "./desktop-settings.js"

export const getLanguageConfigPath = getDesktopSettingsPath

export const resolveSupportedLocale = (
  preference: LanguageSettingsWrite["preference"],
  preferredSystemLanguages: readonly string[]
): SupportedLocale => {
  if (preference !== "system") return preference === "zh-CN" ? "zh-CN" : "en"

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

export const readLanguageSettings = async (
  userDataDir: string,
  preferredSystemLanguages: readonly string[]
): Promise<LanguageSettings> => {
  const stored = (await readDesktopSettings(userDataDir)).language
  return {
    ...stored,
    configPath: getDesktopSettingsPath(userDataDir),
    locale: resolveSupportedLocale(stored.preference, preferredSystemLanguages),
  }
}

export const writeLanguageSettings = async (
  userDataDir: string,
  settings: LanguageSettingsWrite,
  preferredSystemLanguages: readonly string[]
): Promise<LanguageSettings> => {
  const language = LanguageSettingsWriteSchema.parse(settings)
  await updateDesktopSettings(userDataDir, (current) => ({ ...current, language }))
  return {
    ...language,
    configPath: getDesktopSettingsPath(userDataDir),
    locale: resolveSupportedLocale(language.preference, preferredSystemLanguages),
  }
}
