import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  AppearanceCodeThemeIdSchema,
  AppearanceDiffMarkerStyleSchema,
  AppearanceThemeModeSchema,
  type AppearanceChromeTheme,
  type AppearanceSettings,
} from "../../ipc/src/index.js"

const desktopSection = "desktop"
const lightSection = "desktop.appearanceLightChromeTheme"
const darkSection = "desktop.appearanceDarkChromeTheme"
const managedDesktopAppearanceKeys = new Set([
  "appearanceDarkCodeThemeId",
  "appearanceDiffMarkerStyle",
  "appearanceLightCodeThemeId",
  "appearanceTheme",
  "codeFontSize",
  "sansFontSize",
])

const themeSectionNames = new Set([
  lightSection,
  `${lightSection}.fonts`,
  `${lightSection}.semanticColors`,
  darkSection,
  `${darkSection}.fonts`,
  `${darkSection}.semanticColors`,
])

const defaultFontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const defaultFontMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"'

export const defaultAppearanceThemes: AppearanceSettings["themes"] = {
  light: {
    accent: "#0169cc",
    accentSource: "chatgpt",
    contrast: 45,
    fonts: {
      code: defaultFontMono,
      ui: defaultFontSans,
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
  dark: {
    accent: "#0169cc",
    accentSource: "chatgpt",
    contrast: 60,
    fonts: {
      code: defaultFontMono,
      ui: defaultFontSans,
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
}

export const defaultAppearanceSettings = {
  appearanceTheme: "system",
  codeFontSize: 12,
  codeThemes: {
    dark: "codex",
    light: "catppuccin",
  },
  diffMarkerStyle: "color",
  sansFontSize: 14,
  themes: defaultAppearanceThemes,
} satisfies Omit<AppearanceSettings, "configPath">

const sectionHeaderPattern = /^\s*\[([^\]]+)]\s*(?:#.*)?$/
const keyValuePattern = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/

const cloneDefaults = (): AppearanceSettings["themes"] => ({
  dark: {
    ...defaultAppearanceThemes.dark,
    fonts: { ...defaultAppearanceThemes.dark.fonts },
    semanticColors: { ...defaultAppearanceThemes.dark.semanticColors },
  },
  light: {
    ...defaultAppearanceThemes.light,
    fonts: { ...defaultAppearanceThemes.light.fonts },
    semanticColors: { ...defaultAppearanceThemes.light.semanticColors },
  },
})

export const getCodexConfigPath = (codexHome: string): string => join(codexHome, "config.toml")

const stripInlineComment = (value: string): string => {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : (quote ?? char)
      continue
    }
    if (char === "#" && !quote) {
      return value.slice(0, index).trim()
    }
  }
  return value.trim()
}

const parseTomlValue = (rawValue: string): string | number | boolean | undefined => {
  const value = stripInlineComment(rawValue)

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

const applyParsedValue = (
  settings: Omit<AppearanceSettings, "configPath">,
  section: string,
  key: string,
  value: string | number | boolean | undefined
): void => {
  if (section === desktopSection) {
    if (key === "appearanceTheme" && typeof value === "string") {
      const parsed = AppearanceThemeModeSchema.safeParse(value)
      if (parsed.success) {
        settings.appearanceTheme = parsed.data
      }
      return
    }

    if (
      (key === "appearanceLightCodeThemeId" || key === "appearanceDarkCodeThemeId") &&
      typeof value === "string"
    ) {
      const parsed = AppearanceCodeThemeIdSchema.safeParse(value)
      if (parsed.success) {
        settings.codeThemes[key === "appearanceLightCodeThemeId" ? "light" : "dark"] = parsed.data
      }
    }

    if (key === "appearanceDiffMarkerStyle" && typeof value === "string") {
      const parsed = AppearanceDiffMarkerStyleSchema.safeParse(value)
      if (parsed.success) {
        settings.diffMarkerStyle = parsed.data
      }
      return
    }

    if (key === "sansFontSize" && typeof value === "number") {
      settings.sansFontSize = Math.min(16, Math.max(11, value))
      return
    }

    if (key === "codeFontSize" && typeof value === "number") {
      settings.codeFontSize = Math.min(24, Math.max(8, value))
      return
    }
    return
  }

  const { themes } = settings
  const target =
    section === lightSection || section.startsWith(`${lightSection}.`)
      ? themes.light
      : section === darkSection || section.startsWith(`${darkSection}.`)
        ? themes.dark
        : undefined

  if (!target) {
    return
  }

  if (section.endsWith(".fonts")) {
    if ((key === "ui" || key === "code") && typeof value === "string" && value.trim()) {
      target.fonts[key] = value
    }
    return
  }

  if (section.endsWith(".semanticColors")) {
    if (
      (key === "diffAdded" || key === "diffRemoved" || key === "skill") &&
      typeof value === "string"
    ) {
      target.semanticColors[key] = value
    }
    return
  }

  if ((key === "accent" || key === "ink" || key === "surface") && typeof value === "string") {
    target[key] = value
    return
  }

  if (key === "accentSource" && (value === "chatgpt" || value === "custom")) {
    target.accentSource = value
    return
  }

  if (key === "contrast" && typeof value === "number") {
    target.contrast = value
    return
  }

  if (key === "opaqueWindows" && typeof value === "boolean") {
    target.opaqueWindows = value
  }
}

export const parseAppearanceSettingsFromToml = (
  toml: string
): Omit<AppearanceSettings, "configPath"> => {
  const settings: Omit<AppearanceSettings, "configPath"> = {
    appearanceTheme: defaultAppearanceSettings.appearanceTheme,
    codeFontSize: defaultAppearanceSettings.codeFontSize,
    codeThemes: { ...defaultAppearanceSettings.codeThemes },
    diffMarkerStyle: defaultAppearanceSettings.diffMarkerStyle,
    sansFontSize: defaultAppearanceSettings.sansFontSize,
    themes: cloneDefaults(),
  }
  let currentSection: string | undefined

  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(sectionHeaderPattern)
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1]
      continue
    }

    if (
      !currentSection ||
      (currentSection !== desktopSection && !themeSectionNames.has(currentSection))
    ) {
      continue
    }

    const keyValueMatch = line.match(keyValuePattern)
    if (!keyValueMatch?.[1] || !keyValueMatch[2]) {
      continue
    }

    applyParsedValue(settings, currentSection, keyValueMatch[1], parseTomlValue(keyValueMatch[2]))
  }

  return settings
}

export const parseAppearanceThemesFromToml = (toml: string): AppearanceSettings["themes"] =>
  parseAppearanceSettingsFromToml(toml).themes

const removeManagedDesktopAppearanceKeys = (toml: string): string => {
  const keptLines: string[] = []
  let currentSection: string | undefined

  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(sectionHeaderPattern)
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1]
      keptLines.push(line)
      continue
    }

    const keyValueMatch = line.match(keyValuePattern)
    if (
      currentSection === desktopSection &&
      keyValueMatch?.[1] &&
      managedDesktopAppearanceKeys.has(keyValueMatch[1])
    ) {
      continue
    }

    keptLines.push(line)
  }

  return keptLines.join("\n").trimEnd()
}

const removeAppearanceThemeSections = (toml: string): string => {
  const keptLines: string[] = []
  let skipping = false

  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(sectionHeaderPattern)
    if (sectionMatch?.[1]) {
      skipping = themeSectionNames.has(sectionMatch[1])
    }

    if (!skipping) {
      keptLines.push(line)
    }
  }

  return keptLines.join("\n").trimEnd()
}

const quoteTomlString = (value: string): string => JSON.stringify(value)

const renderDesktopAppearanceKeys = (
  settings: Pick<
    AppearanceSettings,
    "appearanceTheme" | "codeFontSize" | "codeThemes" | "diffMarkerStyle" | "sansFontSize"
  >
): string =>
  [
    `appearanceTheme = ${quoteTomlString(settings.appearanceTheme)}`,
    `appearanceLightCodeThemeId = ${quoteTomlString(settings.codeThemes.light)}`,
    `appearanceDarkCodeThemeId = ${quoteTomlString(settings.codeThemes.dark)}`,
    `appearanceDiffMarkerStyle = ${quoteTomlString(settings.diffMarkerStyle)}`,
    `sansFontSize = ${settings.sansFontSize}`,
    `codeFontSize = ${settings.codeFontSize}`,
  ].join("\n")

const mergeDesktopAppearanceKeysIntoToml = (
  toml: string,
  settings: Pick<
    AppearanceSettings,
    "appearanceTheme" | "codeFontSize" | "codeThemes" | "diffMarkerStyle" | "sansFontSize"
  >
): string => {
  const stripped = removeManagedDesktopAppearanceKeys(toml)
  const lines = stripped.split(/\r?\n/)
  const desktopHeaderIndex = lines.findIndex(
    (line) => line.match(sectionHeaderPattern)?.[1] === desktopSection
  )
  const renderedKeys = renderDesktopAppearanceKeys(settings).split("\n")

  if (desktopHeaderIndex >= 0) {
    lines.splice(desktopHeaderIndex + 1, 0, ...renderedKeys)
    return lines.join("\n").trimEnd()
  }

  return stripped
    ? `${stripped}\n\n[${desktopSection}]\n${renderedKeys}`
    : `[${desktopSection}]\n${renderedKeys}`
}

const renderTheme = (sectionName: string, theme: AppearanceChromeTheme): string => `[${sectionName}]
accent = ${quoteTomlString(theme.accent)}
${theme.accentSource ? `accentSource = ${quoteTomlString(theme.accentSource)}\n` : ""}contrast = ${theme.contrast}
ink = ${quoteTomlString(theme.ink)}
opaqueWindows = ${theme.opaqueWindows}
surface = ${quoteTomlString(theme.surface)}

[${sectionName}.fonts]
ui = ${quoteTomlString(theme.fonts.ui)}
code = ${quoteTomlString(theme.fonts.code)}

[${sectionName}.semanticColors]
diffAdded = ${quoteTomlString(theme.semanticColors.diffAdded)}
diffRemoved = ${quoteTomlString(theme.semanticColors.diffRemoved)}
skill = ${quoteTomlString(theme.semanticColors.skill)}`

const renderAppearanceThemes = (themes: AppearanceSettings["themes"]): string =>
  [renderTheme(lightSection, themes.light), renderTheme(darkSection, themes.dark)].join("\n\n")

export const mergeAppearanceThemesIntoToml = (
  toml: string,
  themes: AppearanceSettings["themes"]
): string => {
  const base = removeAppearanceThemeSections(toml)
  const renderedThemes = renderAppearanceThemes(themes)
  return base ? `${base}\n\n${renderedThemes}\n` : `${renderedThemes}\n`
}

export const mergeAppearanceSettingsIntoToml = (
  toml: string,
  settings: Pick<
    AppearanceSettings,
    | "appearanceTheme"
    | "codeFontSize"
    | "codeThemes"
    | "diffMarkerStyle"
    | "sansFontSize"
    | "themes"
  >
): string =>
  mergeAppearanceThemesIntoToml(mergeDesktopAppearanceKeysIntoToml(toml, settings), settings.themes)

export const readAppearanceSettings = async (codexHome: string): Promise<AppearanceSettings> => {
  const configPath = getCodexConfigPath(codexHome)

  try {
    const toml = await readFile(configPath, "utf8")
    return {
      ...parseAppearanceSettingsFromToml(toml),
      configPath,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }

    return {
      appearanceTheme: defaultAppearanceSettings.appearanceTheme,
      codeFontSize: defaultAppearanceSettings.codeFontSize,
      codeThemes: { ...defaultAppearanceSettings.codeThemes },
      configPath,
      diffMarkerStyle: defaultAppearanceSettings.diffMarkerStyle,
      sansFontSize: defaultAppearanceSettings.sansFontSize,
      themes: cloneDefaults(),
    }
  }
}

export const writeAppearanceSettings = async (
  codexHome: string,
  settings: Pick<
    AppearanceSettings,
    | "appearanceTheme"
    | "codeFontSize"
    | "codeThemes"
    | "diffMarkerStyle"
    | "sansFontSize"
    | "themes"
  >
): Promise<AppearanceSettings> => {
  const configPath = getCodexConfigPath(codexHome)
  let existingToml = ""

  try {
    existingToml = await readFile(configPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, mergeAppearanceSettingsIntoToml(existingToml, settings), "utf8")

  return {
    appearanceTheme: settings.appearanceTheme,
    codeFontSize: settings.codeFontSize,
    codeThemes: settings.codeThemes,
    configPath,
    diffMarkerStyle: settings.diffMarkerStyle,
    sansFontSize: settings.sansFontSize,
    themes: settings.themes,
  }
}
