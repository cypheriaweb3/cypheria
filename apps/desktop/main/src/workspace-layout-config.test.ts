import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  getWorkspaceLayoutConfigPath,
  readWorkspaceLayoutSettings,
  writeWorkspaceLayoutSettings,
} from "./workspace-layout-config.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("workspace layout config", () => {
  it("uses ChatGPT-compatible defaults before a config file exists", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-workspace-layout-test-"))
    temporaryDirectories.push(configDir)

    await expect(readWorkspaceLayoutSettings(configDir)).resolves.toEqual({
      configPath: getWorkspaceLayoutConfigPath(configDir),
      defaultTerminalLocation: "bottom",
      showBottomPanelControl: true,
    })
  })

  it("persists renderer-safe layout preferences atomically", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-workspace-layout-test-"))
    temporaryDirectories.push(configDir)

    const saved = await writeWorkspaceLayoutSettings(configDir, {
      defaultTerminalLocation: "right",
      showBottomPanelControl: false,
    })

    await expect(readWorkspaceLayoutSettings(configDir)).resolves.toEqual(saved)
    await expect(readFile(getWorkspaceLayoutConfigPath(configDir), "utf8")).resolves.toContain(
      '"defaultTerminalLocation": "right"'
    )
  })
})
