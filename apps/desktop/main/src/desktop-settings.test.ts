import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  getDesktopSettingsPath,
  readDesktopSettings,
  updateDesktopSettings,
} from "./desktop-settings.js"
import { readDesktopPreferences, writeDesktopPreferences } from "./preferences-config.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("desktop settings store", () => {
  it("stores general preferences in config.json", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-desktop-settings-test-"))
    temporaryDirectories.push(userDataDir)
    expect(getDesktopSettingsPath(userDataDir)).toBe(join(userDataDir, "config.json"))
    const current = await readDesktopPreferences(userDataDir)
    expect(current.projectlessWorkspaceRoot).toMatch(/[/\\]Documents[/\\]Cypheria$/)
    const { configPath: _configPath, ...write } = current
    await writeDesktopPreferences(userDataDir, {
      ...write,
      composerEnterBehavior: "cmdIfMultiline",
      notificationSound: "classic",
      notificationsTurnMode: "always",
    })
    await expect(readDesktopPreferences(userDataDir)).resolves.toMatchObject({
      composerEnterBehavior: "cmdIfMultiline",
      notificationSound: "classic",
      notificationsTurnMode: "always",
    })
  })

  it("serializes concurrent section updates without losing either change", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-desktop-settings-test-"))
    temporaryDirectories.push(userDataDir)

    await Promise.all([
      updateDesktopSettings(userDataDir, (current) => ({
        ...current,
        language: { preference: "zh-CN" },
      })),
      updateDesktopSettings(userDataDir, (current) => ({
        ...current,
        workspaceLayout: { defaultTerminalLocation: "right", showBottomPanelControl: false },
      })),
    ])

    await expect(readDesktopSettings(userDataDir)).resolves.toMatchObject({
      language: { preference: "zh-CN" },
      workspaceLayout: { defaultTerminalLocation: "right", showBottomPanelControl: false },
    })
  })
})
