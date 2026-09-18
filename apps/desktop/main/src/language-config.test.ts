import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { getDesktopSettingsPath } from "./desktop-settings.js"
import {
  readLanguageSettings,
  resolveSupportedLocale,
  writeLanguageSettings,
} from "./language-config.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("desktop language settings", () => {
  it("resolves supported system languages in preference order", () => {
    expect(resolveSupportedLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN")
    expect(resolveSupportedLocale("system", ["fr-FR", "en-GB"])).toBe("en")
    expect(resolveSupportedLocale("system", ["zh-Hant-TW"])).toBe("en")
    expect(resolveSupportedLocale("zh-CN", ["en-US"])).toBe("zh-CN")
    expect(resolveSupportedLocale("ja", ["zh-CN"])).toBe("en")
  })

  it("persists an explicit choice without touching appearance", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "cypheria-language-test-"))
    temporaryDirectories.push(userDataDir)

    await expect(readLanguageSettings(userDataDir, ["zh-CN"])).resolves.toMatchObject({
      locale: "zh-CN",
      preference: "system",
    })
    await writeLanguageSettings(userDataDir, { preference: "ja" }, ["zh-CN"])
    await expect(readLanguageSettings(userDataDir, ["zh-CN"])).resolves.toMatchObject({
      locale: "en",
      preference: "ja",
    })

    const document = JSON.parse(await readFile(getDesktopSettingsPath(userDataDir), "utf8"))
    expect(document.language).toEqual({ preference: "ja" })
    expect(document.appearance.theme).toBe("system")
  })
})
