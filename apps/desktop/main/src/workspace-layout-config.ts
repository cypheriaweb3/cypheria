import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { WorkspaceLayoutSettings, WorkspaceLayoutSettingsWrite } from "../../ipc/src/index.js"
import { WorkspaceLayoutSettingsWriteSchema } from "../../ipc/src/index.js"

const configFileName = "workspace-layout.json"

export const defaultWorkspaceLayoutSettings: WorkspaceLayoutSettingsWrite = {
  defaultTerminalLocation: "bottom",
  showBottomPanelControl: true,
}

export const getWorkspaceLayoutConfigPath = (configDir: string): string =>
  join(configDir, configFileName)

export const readWorkspaceLayoutSettings = async (
  configDir: string
): Promise<WorkspaceLayoutSettings> => {
  const configPath = getWorkspaceLayoutConfigPath(configDir)
  try {
    const contents = await readFile(configPath, "utf8")
    return {
      ...WorkspaceLayoutSettingsWriteSchema.parse(JSON.parse(contents)),
      configPath,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return { ...defaultWorkspaceLayoutSettings, configPath }
  }
}

export const writeWorkspaceLayoutSettings = async (
  configDir: string,
  settings: WorkspaceLayoutSettingsWrite
): Promise<WorkspaceLayoutSettings> => {
  const parsed = WorkspaceLayoutSettingsWriteSchema.parse(settings)
  const configPath = getWorkspaceLayoutConfigPath(configDir)
  const temporaryPath = `${configPath}.tmp`
  await mkdir(configDir, { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rename(temporaryPath, configPath)
  return { ...parsed, configPath }
}
