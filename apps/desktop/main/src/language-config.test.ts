import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  getLanguageConfigPath,
  mergeLanguagePreferenceIntoToml,
  parseLanguagePreferenceFromToml,
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

  it("reads localeOverride only from the desktop section", () => {
    expect(
      parseLanguagePreferenceFromToml(`localeOverride = "ja"

[desktop]
localeOverride = "zh-CN"
`)
    ).toBe("zh-CN")
    expect(parseLanguagePreferenceFromToml("[desktop]\nlocaleOverride = 'fr-FR'\n")).toBe("fr-FR")
    expect(parseLanguagePreferenceFromToml('[desktop]\nlocaleOverride = "unknown"\n')).toBe(
      "system"
    )
  })

  it("adds, replaces, and removes localeOverride without changing other settings", () => {
    const initial = `model = "gpt-5"

[desktop]
appearanceTheme = "dark"
localeOverride = "en" # managed language

[mcp_servers.test]
command = "node"
`
    const selected = mergeLanguagePreferenceIntoToml(initial, "ja")
    expect(selected).toContain('[desktop]\nlocaleOverride = "ja"\nappearanceTheme = "dark"')
    expect(selected).toContain('[mcp_servers.test]\ncommand = "node"')
    expect(selected).not.toContain('localeOverride = "en"')

    const automatic = mergeLanguagePreferenceIntoToml(selected, "system")
    expect(automatic).not.toContain("localeOverride")
    expect(automatic).toContain('appearanceTheme = "dark"')
  })

  it("defaults to automatic detection and persists an explicit choice", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "cypheria-language-test-"))
    temporaryDirectories.push(codexHome)

    await expect(readLanguageSettings(codexHome, ["zh-CN"])).resolves.toMatchObject({
      locale: "zh-CN",
      preference: "system",
    })

    await expect(
      writeLanguageSettings(codexHome, { preference: "ja" }, ["zh-CN"])
    ).resolves.toMatchObject({
      locale: "en",
      preference: "ja",
    })
    await expect(readLanguageSettings(codexHome, ["zh-CN"])).resolves.toMatchObject({
      locale: "en",
      preference: "ja",
    })
    await expect(readFile(getLanguageConfigPath(codexHome), "utf8")).resolves.toContain(
      'localeOverride = "ja"'
    )

    await writeLanguageSettings(codexHome, { preference: "system" }, ["zh-CN"])
    await expect(readFile(getLanguageConfigPath(codexHome), "utf8")).resolves.not.toContain(
      "localeOverride"
    )
  })
})
