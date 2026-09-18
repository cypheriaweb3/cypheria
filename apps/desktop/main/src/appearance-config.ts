import {
  type AppearanceSettings,
  type AppearanceSettingsWrite,
  AppearanceSettingsWriteSchema,
} from "../../ipc/src/index.js"
import {
  defaultAppearanceSettings,
  getDesktopSettingsPath,
  readDesktopSettings,
  updateDesktopSettings,
} from "./desktop-settings.js"

export { defaultAppearanceSettings }

export const defaultAppearanceThemes = {
  lightTheme: defaultAppearanceSettings.lightTheme,
  darkTheme: defaultAppearanceSettings.darkTheme,
}

export const readAppearanceSettings = async (userDataDir: string): Promise<AppearanceSettings> => ({
  ...(await readDesktopSettings(userDataDir)).appearance,
  configPath: getDesktopSettingsPath(userDataDir),
})

export const writeAppearanceSettings = async (
  userDataDir: string,
  settings: AppearanceSettingsWrite
): Promise<AppearanceSettings> => {
  const appearance = AppearanceSettingsWriteSchema.parse(settings)
  await updateDesktopSettings(userDataDir, (current) => ({ ...current, appearance }))
  return { ...appearance, configPath: getDesktopSettingsPath(userDataDir) }
}
