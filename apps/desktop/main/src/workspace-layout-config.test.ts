import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { getDesktopSettingsPath } from "./desktop-settings.js"
import {
  readWorkspaceLayoutSettings,
  writeWorkspaceLayoutSettings,
} from "./workspace-layout-config.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("workspace layout config", () => {
  it("uses ChatGPT-compatible defaults before a config file exists", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-workspace-layout-test-"))
    temporaryDirectories.push(userDataDir)

    await expect(readWorkspaceLayoutSettings(userDataDir)).resolves.toEqual({
      configPath: getDesktopSettingsPath(userDataDir),
      defaultTerminalLocation: "bottom",
      showBottomPanelControl: true,
    })
  })

  it("persists layout in the combined desktop settings document", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-workspace-layout-test-"))
    temporaryDirectories.push(userDataDir)
    const saved = await writeWorkspaceLayoutSettings(userDataDir, {
      defaultTerminalLocation: "right",
      showBottomPanelControl: false,
    })

    await expect(readWorkspaceLayoutSettings(userDataDir)).resolves.toEqual(saved)
    const document = JSON.parse(await readFile(getDesktopSettingsPath(userDataDir), "utf8"))
    expect(document.workspaceLayout).toEqual({
      defaultTerminalLocation: "right",
      showBottomPanelControl: false,
    })
  })
})
