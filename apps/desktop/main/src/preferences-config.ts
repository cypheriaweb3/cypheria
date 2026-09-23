import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import {
  type DesktopPreferences,
  type DesktopPreferencesWrite,
  DesktopPreferencesWriteSchema,
} from "../../ipc/src/index.js"
import {
  getDesktopSettingsPath,
  readDesktopSettings,
  updateDesktopSettings,
} from "./desktop-settings.js"

const effectivePreferences = (
  preferences: DesktopPreferencesWrite,
  userDataDir: string
): DesktopPreferences => ({
  ...preferences,
  projectlessWorkspaceRoot:
    preferences.projectlessWorkspaceRoot ?? join(homedir(), "Documents", "Cypheria"),
  configPath: getDesktopSettingsPath(userDataDir),
})

export const readDesktopPreferences = async (userDataDir: string): Promise<DesktopPreferences> =>
  effectivePreferences((await readDesktopSettings(userDataDir)).preferences, userDataDir)

export const writeDesktopPreferences = async (
  userDataDir: string,
  input: DesktopPreferencesWrite
): Promise<DesktopPreferences> => {
  const preferences = DesktopPreferencesWriteSchema.parse(input)
  if (preferences.projectlessWorkspaceRoot && !isAbsolute(preferences.projectlessWorkspaceRoot)) {
    throw new Error("The projectless task folder must be an absolute path")
  }
  await updateDesktopSettings(userDataDir, (current) => ({ ...current, preferences }))
  return effectivePreferences(preferences, userDataDir)
}
