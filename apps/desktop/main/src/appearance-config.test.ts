import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  getCodexConfigPath,
  mergeAppearanceSettingsIntoToml,
  mergeAppearanceThemesIntoToml,
  parseAppearanceSettingsFromToml,
  parseAppearanceThemesFromToml,
  readAppearanceSettings,
  writeAppearanceSettings,
} from "./appearance-config.js"

describe("Codex appearance config", () => {
  it("parses desktop chrome theme sections with defaults for missing fields", () => {
    const themes = parseAppearanceThemesFromToml(`
model = "gpt-5"

[desktop]
appearanceTheme = "dark"
appearanceLightCodeThemeId = "github"
appearanceDarkCodeThemeId = "tokyo-night"

[desktop.appearanceLightChromeTheme]
accent = "#123456"
accentSource = "custom"
contrast = 44
ink = "#111111"
opaqueWindows = false
surface = "#ffffff"

[desktop.appearanceLightChromeTheme.fonts]
ui = "-apple-system, Blink"
code = 'ui-monospace, "SFM"'

[desktop.appearanceLightChromeTheme.fonts.codeFace]
family = "Courier New"
fullName = "Courier New Bold Italic"
postscriptName = "CourierNewPS-BoldItalicMT"

[desktop.appearanceLightChromeTheme.fonts.uiFace]
family = "Book Antiqua"
fullName = "Book Antiqua Bold"
postscriptName = "BookAntiqua-Bold"

[desktop.appearanceLightChromeTheme.semanticColors]
diffAdded = "#00aa00"
diffRemoved = "#dd0000"
skill = "#6600aa"
`)

    expect(themes.lightTheme).toMatchObject({
      accent: "#123456",
      accentSource: "custom",
      contrast: 44,
      fonts: {
        code: 'ui-monospace, "SFM"',
        codeFace: {
          family: "Courier New",
          fullName: "Courier New Bold Italic",
          postscriptName: "CourierNewPS-BoldItalicMT",
        },
        ui: "-apple-system, Blink",
        uiFace: {
          family: "Book Antiqua",
          fullName: "Book Antiqua Bold",
          postscriptName: "BookAntiqua-Bold",
        },
      },
      semanticColors: {
        skill: "#6600aa",
      },
    })
    expect(themes.darkTheme.surface).toBe("#111111")
  })

  it("parses desktop appearance mode and code theme presets", () => {
    const settings = parseAppearanceSettingsFromToml(`
[desktop]
appearanceTheme = "dark"
appearanceLightCodeThemeId = "github"
appearanceDarkCodeThemeId = "tokyo-night"
appearanceDiffMarkerStyle = "symbols"
reduced-motion-preference = "on"
sansFontSize = 15
codeFontSize = 13
useFontSmoothing = false
usePointerCursors = true
preventSleepWhileRunning = true
`)

    expect(settings.theme).toBe("dark")
    expect(settings.codeFontSize).toBe(13)
    expect(settings.darkThemeId).toBe("tokyo-night")
    expect(settings.lightThemeId).toBe("github")
    expect(settings.diffMarkerStyle).toBe("symbols")
    expect(settings.reducedMotionPreference).toBe("on")
    expect(settings.uiFontSize).toBe(15)
    expect(settings.useFontSmoothing).toBe(false)
    expect(settings.usePointerCursors).toBe(true)
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
        darkTheme: {
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
        lightTheme: {
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

  it("renders structured font faces and omits system-default font values", () => {
    const merged = mergeAppearanceThemesIntoToml("", {
      darkTheme: {
        accent: "#0169cc",
        contrast: 60,
        fonts: {
          code: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"',
          ui: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        ink: "#fcfcfc",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#e02e2a",
          skill: "#b06dff",
        },
        surface: "#111111",
      },
      lightTheme: {
        accent: "#123456",
        contrast: 45,
        fonts: {
          code: '"Courier New"',
          codeFace: {
            family: "Courier New",
            fullName: "Courier New Bold Italic",
            postscriptName: "CourierNewPS-BoldItalicMT",
          },
          ui: '"Book Antiqua"',
          uiFace: {
            family: "Book Antiqua",
            fullName: "Book Antiqua Bold",
            postscriptName: "BookAntiqua-Bold",
          },
        },
        ink: "#0d0d0d",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#e02e2a",
          skill: "#751ed9",
        },
        surface: "#ffffff",
      },
    })

    expect(merged).toContain("[desktop.appearanceLightChromeTheme.fonts]")
    expect(merged).toContain('ui = "\\"Book Antiqua\\""')
    expect(merged).toContain('code = "\\"Courier New\\""')
    expect(merged).toContain("[desktop.appearanceLightChromeTheme.fonts.uiFace]")
    expect(merged).toContain('fullName = "Book Antiqua Bold"')
    expect(merged).toContain("[desktop.appearanceLightChromeTheme.fonts.codeFace]")
    expect(merged).toContain('postscriptName = "CourierNewPS-BoldItalicMT"')
    expect(merged).not.toContain("[desktop.appearanceDarkChromeTheme.fonts]")
  })

  it("replaces only managed desktop appearance keys", () => {
    const merged = mergeAppearanceSettingsIntoToml(
      `model = "gpt-5"

[desktop]
appearanceTheme = "light"
appearanceLightCodeThemeId = "codex"
appearanceDarkCodeThemeId = "dracula"
preventSleepWhileRunning = true

[profiles.default]
approval_policy = "on-request"
`,
      {
        theme: "system",
        lightThemeId: "codex",
        darkThemeId: "codex",
        uiFontSize: 14,
        codeFontSize: 13,
        diffMarkerStyle: "color",
        reducedMotionPreference: "system",
        useFontSmoothing: true,
        usePointerCursors: false,
        darkTheme: {
          accent: "#0169cc",
          accentSource: "chatgpt",
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
        lightTheme: {
          accent: "#123456",
          accentSource: "custom",
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

    expect(merged).toContain('appearanceTheme = "system"')
    expect(merged).toContain('appearanceLightCodeThemeId = "codex"')
    expect(merged).toContain('appearanceDarkCodeThemeId = "codex"')
    expect(merged).toContain('appearanceDiffMarkerStyle = "color"')
    expect(merged).toContain('reduced-motion-preference = "system"')
    expect(merged).toContain("sansFontSize = 14")
    expect(merged).toContain("codeFontSize = 13")
    expect(merged).toContain("useFontSmoothing = true")
    expect(merged).toContain("usePointerCursors = false")
    expect(merged).toContain("preventSleepWhileRunning = true")
    expect(merged).toContain("[profiles.default]")
    expect(merged).toContain('accentSource = "custom"')
  })

  it("writes appearance settings to CODEX_HOME config.toml without dropping other config", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "cypheria-codex-config-test-"))

    try {
      const configPath = getCodexConfigPath(codexHome)
      await writeFile(configPath, 'model = "gpt-5"\n', "utf8")

      const initial = await readAppearanceSettings(codexHome)
      initial.lightTheme.accent = "#abcdef"

      await writeAppearanceSettings(codexHome, initial)

      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain('model = "gpt-5"')
      expect(toml).toContain('accent = "#abcdef"')
      expect(toml).toContain('appearanceLightCodeThemeId = "codex"')

      const reread = await readAppearanceSettings(codexHome)
      expect(reread.lightTheme.accent).toBe("#abcdef")
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })

  it("creates CODEX_HOME config.toml with default appearance settings when missing", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "cypheria-codex-config-test-"))

    try {
      const configPath = getCodexConfigPath(codexHome)
      const settings = await readAppearanceSettings(codexHome)
      const toml = await readFile(configPath, "utf8")

      expect(settings.configPath).toBe(configPath)
      expect(toml).toContain("[desktop]")
      expect(toml).toContain('appearanceTheme = "system"')
      expect(toml).toContain(
        '[desktop]\nappearanceTheme = "system"\nappearanceLightCodeThemeId = "codex"'
      )
      expect(toml).not.toContain('",appearance')
      expect(toml).toContain("[desktop.appearanceLightChromeTheme]")
      expect(toml).toContain("[desktop.appearanceDarkChromeTheme]")
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })
})
