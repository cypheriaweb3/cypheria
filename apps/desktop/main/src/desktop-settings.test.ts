import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readDesktopSettings, updateDesktopSettings } from "./desktop-settings.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("desktop settings store", () => {
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
