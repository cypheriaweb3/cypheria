import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  defaultAppearanceSettings,
  readAppearanceSettings,
  writeAppearanceSettings,
} from "./appearance-config.js"
import { getDesktopSettingsPath } from "./desktop-settings.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("desktop appearance settings", () => {
  it("uses desktop-local defaults without creating a Codex config", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-appearance-test-"))
    temporaryDirectories.push(userDataDir)

    await expect(readAppearanceSettings(userDataDir)).resolves.toEqual({
      ...defaultAppearanceSettings,
      configPath: getDesktopSettingsPath(userDataDir),
    })
  })

  it("persists appearance in the combined desktop settings document", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-appearance-test-"))
    temporaryDirectories.push(userDataDir)
    const settings = { ...defaultAppearanceSettings, theme: "dark" as const, uiFontSize: 16 }

    await expect(writeAppearanceSettings(userDataDir, settings)).resolves.toMatchObject(settings)
    await expect(readAppearanceSettings(userDataDir)).resolves.toMatchObject(settings)

    const document = JSON.parse(await readFile(getDesktopSettingsPath(userDataDir), "utf8"))
    expect(document).toMatchObject({
      version: 1,
      appearance: { theme: "dark", uiFontSize: 16 },
      language: { preference: "system" },
      workspaceLayout: { defaultTerminalLocation: "bottom" },
    })
  })
})
