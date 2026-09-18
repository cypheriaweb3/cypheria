import type { WorkspaceLayoutSettings, WorkspaceLayoutSettingsWrite } from "../../ipc/src/index.js"
import { WorkspaceLayoutSettingsWriteSchema } from "../../ipc/src/index.js"
import {
  defaultWorkspaceLayoutSettings,
  getDesktopSettingsPath,
  readDesktopSettings,
  updateDesktopSettings,
} from "./desktop-settings.js"

export { defaultWorkspaceLayoutSettings }
export const getWorkspaceLayoutConfigPath = getDesktopSettingsPath

export const readWorkspaceLayoutSettings = async (
  userDataDir: string
): Promise<WorkspaceLayoutSettings> => ({
  ...(await readDesktopSettings(userDataDir)).workspaceLayout,
  configPath: getDesktopSettingsPath(userDataDir),
})

export const writeWorkspaceLayoutSettings = async (
  userDataDir: string,
  settings: WorkspaceLayoutSettingsWrite
): Promise<WorkspaceLayoutSettings> => {
  const workspaceLayout = WorkspaceLayoutSettingsWriteSchema.parse(settings)
  await updateDesktopSettings(userDataDir, (current) => ({ ...current, workspaceLayout }))
  return { ...workspaceLayout, configPath: getDesktopSettingsPath(userDataDir) }
}
