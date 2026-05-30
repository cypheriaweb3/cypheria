import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  getCodexConfigPath,
  mergeAppearanceThemesIntoToml,
  parseAppearanceThemesFromToml,
  readAppearanceSettings,
  writeAppearanceSettings,
} from "./appearance-config.js"

describe("Codex appearance config", () => {
  it("parses desktop chrome theme sections with defaults for missing fields", () => {
    const themes = parseAppearanceThemesFromToml(`
model = "gpt-5"

[desktop.appearanceLightChromeTheme]
accent = "#123456"
contrast = 44
ink = "#111111"
opaqueWindows = false
surface = "#ffffff"

[desktop.appearanceLightChromeTheme.fonts]
ui = "-apple-system, Blink"
code = 'ui-monospace, "SFM"'

[desktop.appearanceLightChromeTheme.semanticColors]
diffAdded = "#00aa00"
diffRemoved = "#dd0000"
skill = "#6600aa"
`)

    expect(themes.light).toMatchObject({
      accent: "#123456",
      contrast: 44,
      fonts: {
        code: 'ui-monospace, "SFM"',
        ui: "-apple-system, Blink",
      },
      semanticColors: {
        skill: "#6600aa",
      },
    })
    expect(themes.dark.surface).toBe("#111111")
  })

  it("replaces only managed appearance sections", () => {
    const merged = mergeAppearanceThemesIntoToml(
      `model = "gpt-5"

[profiles.default]
approval_policy = "on-request"

[desktop.appearanceLightChromeTheme]
accent = "#000000"

[desktop.appearanceLightChromeTheme.fonts]
ui = "Old"

[mcp_servers.test]
command = "node"
`,
      {
        dark: {
          accent: "#0169cc",
          contrast: 60,
          fonts: { code: "Mono", ui: "System" },
          ink: "#fcfcfc",
          opaqueWindows: true,
          semanticColors: {
            diffAdded: "#00a240",
            diffRemoved: "#e02e2a",
            skill: "#b06dff",
          },
          surface: "#111111",
        },
        light: {
          accent: "#123456",
          contrast: 45,
          fonts: { code: "Mono", ui: "System" },
          ink: "#0d0d0d",
          opaqueWindows: false,
          semanticColors: {
            diffAdded: "#00a240",
            diffRemoved: "#e02e2a",
            skill: "#751ed9",
          },
          surface: "#ffffff",
        },
      }
    )

    expect(merged).toContain('model = "gpt-5"')
    expect(merged).toContain("[profiles.default]")
    expect(merged).toContain("[mcp_servers.test]")
    expect(merged).not.toContain('ui = "Old"')
    expect(merged).toContain('accent = "#123456"')
    expect(merged).toContain("[desktop.appearanceDarkChromeTheme.semanticColors]")
  })

  it("writes appearance settings to CODEX_HOME config.toml without dropping other config", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "cypheria-codex-config-test-"))

    try {
      const configPath = getCodexConfigPath(codexHome)
      await writeFile(configPath, 'model = "gpt-5"\n', "utf8")

      const initial = await readAppearanceSettings(codexHome)
      initial.themes.light.accent = "#abcdef"

      await writeAppearanceSettings(codexHome, initial.themes)

      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain('model = "gpt-5"')
      expect(toml).toContain('accent = "#abcdef"')

      const reread = await readAppearanceSettings(codexHome)
      expect(reread.themes.light.accent).toBe("#abcdef")
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })
})
