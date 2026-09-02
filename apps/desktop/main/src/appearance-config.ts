import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  type AppearanceChromeTheme,
  AppearanceCodeThemeIdSchema,
  AppearanceDiffMarkerStyleSchema,
  AppearanceReducedMotionPreferenceSchema,
  type AppearanceSettings,
  AppearanceThemeModeSchema,
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
  "reduced-motion-preference",
  "sansFontSize",
  "useFontSmoothing",
  "usePointerCursors",
])

const themeSectionNames = new Set([
  lightSection,
  `${lightSection}.fonts`,
  `${lightSection}.fonts.codeFace`,
  `${lightSection}.fonts.uiFace`,
  `${lightSection}.semanticColors`,
  darkSection,
  `${darkSection}.fonts`,
  `${darkSection}.fonts.codeFace`,
  `${darkSection}.fonts.uiFace`,
  `${darkSection}.semanticColors`,
])

const defaultFontSans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const defaultFontMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"'

export const defaultAppearanceThemes = {
  lightTheme: {
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
  darkTheme: {
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
} satisfies Pick<AppearanceSettings, "lightTheme" | "darkTheme">

export const defaultAppearanceSettings = {
  theme: "system",
  lightThemeId: "codex",
  darkThemeId: "codex",
  lightTheme: defaultAppearanceThemes.lightTheme,
  darkTheme: defaultAppearanceThemes.darkTheme,
  uiFontSize: 14,
  codeFontSize: 13,
  diffMarkerStyle: "color",
  reducedMotionPreference: "system",
  useFontSmoothing: true,
  usePointerCursors: false,
} satisfies Omit<AppearanceSettings, "configPath">

const sectionHeaderPattern = /^\s*\[([^\]]+)]\s*(?:#.*)?$/
const keyValuePattern = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/

const cloneDefaultThemes = (): Pick<AppearanceSettings, "lightTheme" | "darkTheme"> => ({
  darkTheme: {
    ...defaultAppearanceThemes.darkTheme,
    fonts: { ...defaultAppearanceThemes.darkTheme.fonts },
    semanticColors: { ...defaultAppearanceThemes.darkTheme.semanticColors },
  },
  lightTheme: {
    ...defaultAppearanceThemes.lightTheme,
    fonts: { ...defaultAppearanceThemes.lightTheme.fonts },
    semanticColors: { ...defaultAppearanceThemes.lightTheme.semanticColors },
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
        settings.theme = parsed.data
      }
      return
    }

    if (
      (key === "appearanceLightCodeThemeId" || key === "appearanceDarkCodeThemeId") &&
      typeof value === "string"
    ) {
      const parsed = AppearanceCodeThemeIdSchema.safeParse(value)
      if (parsed.success) {
        if (key === "appearanceLightCodeThemeId") {
          settings.lightThemeId = parsed.data
        } else {
          settings.darkThemeId = parsed.data
        }
      }
    }

    if (key === "appearanceDiffMarkerStyle" && typeof value === "string") {
      const parsed = AppearanceDiffMarkerStyleSchema.safeParse(value)
      if (parsed.success) {
        settings.diffMarkerStyle = parsed.data
      }
      return
    }

    if (key === "reduced-motion-preference" && typeof value === "string") {
      const parsed = AppearanceReducedMotionPreferenceSchema.safeParse(value)
      if (parsed.success) {
        settings.reducedMotionPreference = parsed.data
      }
      return
    }

    if (key === "sansFontSize" && typeof value === "number") {
      settings.uiFontSize = Math.min(16, Math.max(11, value))
      return
    }

    if (key === "codeFontSize" && typeof value === "number") {
      settings.codeFontSize = Math.min(24, Math.max(8, value))
      return
    }

    if (key === "useFontSmoothing" && typeof value === "boolean") {
      settings.useFontSmoothing = value
      return
    }

    if (key === "usePointerCursors" && typeof value === "boolean") {
      settings.usePointerCursors = value
      return
    }
    return
  }

  const target =
    section === lightSection || section.startsWith(`${lightSection}.`)
      ? settings.lightTheme
      : section === darkSection || section.startsWith(`${darkSection}.`)
        ? settings.darkTheme
        : undefined

  if (!target) {
    return
  }

  if (section.endsWith(".fonts.codeFace") || section.endsWith(".fonts.uiFace")) {
    if (
      (key === "family" || key === "fullName" || key === "postscriptName") &&
      typeof value === "string" &&
      value.trim()
    ) {
      const faceKey = section.endsWith(".fonts.codeFace") ? "codeFace" : "uiFace"
      const familyKey = faceKey === "codeFace" ? "code" : "ui"
      target.fonts[faceKey] = {
        family: parseCssFontFamily(target.fonts[familyKey]),
        ...target.fonts[faceKey],
        [key]: value,
      }
    }
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
    theme: defaultAppearanceSettings.theme,
    lightThemeId: defaultAppearanceSettings.lightThemeId,
    darkThemeId: defaultAppearanceSettings.darkThemeId,
    ...cloneDefaultThemes(),
    uiFontSize: defaultAppearanceSettings.uiFontSize,
    codeFontSize: defaultAppearanceSettings.codeFontSize,
    diffMarkerStyle: defaultAppearanceSettings.diffMarkerStyle,
    reducedMotionPreference: defaultAppearanceSettings.reducedMotionPreference,
    useFontSmoothing: defaultAppearanceSettings.useFontSmoothing,
    usePointerCursors: defaultAppearanceSettings.usePointerCursors,
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

export const parseAppearanceThemesFromToml = (
  toml: string
): Pick<AppearanceSettings, "lightTheme" | "darkTheme"> => {
  const { lightTheme, darkTheme } = parseAppearanceSettingsFromToml(toml)
  return { lightTheme, darkTheme }
}

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

const parseCssFontFamily = (value: string): string => {
  const [firstFamily] = value.split(",")
  return firstFamily?.trim().replace(/^["']|["']$/g, "") || value
}

const renderDesktopAppearanceKeys = (
  settings: Pick<
    AppearanceSettings,
    | "theme"
    | "lightThemeId"
    | "darkThemeId"
    | "uiFontSize"
    | "codeFontSize"
    | "diffMarkerStyle"
    | "reducedMotionPreference"
    | "useFontSmoothing"
    | "usePointerCursors"
  >
): string =>
  [
    `appearanceTheme = ${quoteTomlString(settings.theme)}`,
    `appearanceLightCodeThemeId = ${quoteTomlString(settings.lightThemeId)}`,
    `appearanceDarkCodeThemeId = ${quoteTomlString(settings.darkThemeId)}`,
    `appearanceDiffMarkerStyle = ${quoteTomlString(settings.diffMarkerStyle)}`,
    `reduced-motion-preference = ${quoteTomlString(settings.reducedMotionPreference)}`,
    `sansFontSize = ${settings.uiFontSize}`,
    `codeFontSize = ${settings.codeFontSize}`,
    `useFontSmoothing = ${settings.useFontSmoothing}`,
    `usePointerCursors = ${settings.usePointerCursors}`,
  ].join("\n")

const mergeDesktopAppearanceKeysIntoToml = (
  toml: string,
  settings: Pick<
    AppearanceSettings,
    | "theme"
    | "lightThemeId"
    | "darkThemeId"
    | "uiFontSize"
    | "codeFontSize"
    | "diffMarkerStyle"
    | "reducedMotionPreference"
    | "useFontSmoothing"
    | "usePointerCursors"
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
    ? `${stripped}\n\n[${desktopSection}]\n${renderedKeys.join("\n")}`
    : `[${desktopSection}]\n${renderedKeys.join("\n")}`
}

const renderFontFace = (
  sectionName: string,
  faceKey: "codeFace" | "uiFace",
  face: AppearanceChromeTheme["fonts"]["codeFace" | "uiFace"]
): string => {
  if (!face) {
    return ""
  }

  return `
[${sectionName}.fonts.${faceKey}]
family = ${quoteTomlString(face.family)}
${face.fullName ? `fullName = ${quoteTomlString(face.fullName)}\n` : ""}${face.postscriptName ? `postscriptName = ${quoteTomlString(face.postscriptName)}` : ""}`.trimEnd()
}

const renderFontSettings = (
  sectionName: string,
  theme: AppearanceChromeTheme,
  defaultTheme: AppearanceChromeTheme
): string => {
  const fontLines: string[] = []
  if (theme.fonts.ui !== defaultTheme.fonts.ui || theme.fonts.uiFace) {
    fontLines.push(`ui = ${quoteTomlString(theme.fonts.ui)}`)
  }
  if (theme.fonts.code !== defaultTheme.fonts.code || theme.fonts.codeFace) {
    fontLines.push(`code = ${quoteTomlString(theme.fonts.code)}`)
  }

  const faceSections = [
    renderFontFace(sectionName, "uiFace", theme.fonts.uiFace),
    renderFontFace(sectionName, "codeFace", theme.fonts.codeFace),
  ].filter(Boolean)

  if (fontLines.length === 0 && faceSections.length === 0) {
    return ""
  }

  return [
    `[${sectionName}.fonts]`,
    ...fontLines,
    ...faceSections.map((section) => `\n${section}`),
  ].join("\n")
}

const renderTheme = (
  sectionName: string,
  theme: AppearanceChromeTheme,
  defaultTheme: AppearanceChromeTheme
): string => {
  const fontSettings = renderFontSettings(sectionName, theme, defaultTheme)

  return `[${sectionName}]
accent = ${quoteTomlString(theme.accent)}
${theme.accentSource ? `accentSource = ${quoteTomlString(theme.accentSource)}\n` : ""}contrast = ${theme.contrast}
ink = ${quoteTomlString(theme.ink)}
opaqueWindows = ${theme.opaqueWindows}
surface = ${quoteTomlString(theme.surface)}

${fontSettings ? `${fontSettings}\n\n` : ""}\
[${sectionName}.semanticColors]
diffAdded = ${quoteTomlString(theme.semanticColors.diffAdded)}
diffRemoved = ${quoteTomlString(theme.semanticColors.diffRemoved)}
skill = ${quoteTomlString(theme.semanticColors.skill)}`
}

const renderAppearanceThemes = (
  settings: Pick<AppearanceSettings, "lightTheme" | "darkTheme">
): string =>
  [
    renderTheme(lightSection, settings.lightTheme, defaultAppearanceThemes.lightTheme),
    renderTheme(darkSection, settings.darkTheme, defaultAppearanceThemes.darkTheme),
  ].join("\n\n")

export const mergeAppearanceThemesIntoToml = (
  toml: string,
  settings: Pick<AppearanceSettings, "lightTheme" | "darkTheme">
): string => {
  const base = removeAppearanceThemeSections(toml)
  const renderedThemes = renderAppearanceThemes(settings)
  return base ? `${base}\n\n${renderedThemes}\n` : `${renderedThemes}\n`
}

export const mergeAppearanceSettingsIntoToml = (
  toml: string,
  settings: Pick<
    AppearanceSettings,
    | "theme"
    | "lightThemeId"
    | "darkThemeId"
    | "lightTheme"
    | "darkTheme"
    | "uiFontSize"
    | "codeFontSize"
    | "diffMarkerStyle"
    | "reducedMotionPreference"
    | "useFontSmoothing"
    | "usePointerCursors"
  >
): string =>
  mergeAppearanceThemesIntoToml(mergeDesktopAppearanceKeysIntoToml(toml, settings), settings)

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

    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      mergeAppearanceSettingsIntoToml("", defaultAppearanceSettings),
      "utf8"
    )

    return {
      theme: defaultAppearanceSettings.theme,
      lightThemeId: defaultAppearanceSettings.lightThemeId,
      darkThemeId: defaultAppearanceSettings.darkThemeId,
      ...cloneDefaultThemes(),
      uiFontSize: defaultAppearanceSettings.uiFontSize,
      codeFontSize: defaultAppearanceSettings.codeFontSize,
      configPath,
      diffMarkerStyle: defaultAppearanceSettings.diffMarkerStyle,
      reducedMotionPreference: defaultAppearanceSettings.reducedMotionPreference,
      useFontSmoothing: defaultAppearanceSettings.useFontSmoothing,
      usePointerCursors: defaultAppearanceSettings.usePointerCursors,
    }
  }
}

export const writeAppearanceSettings = async (
  codexHome: string,
  settings: Pick<
    AppearanceSettings,
    | "theme"
    | "lightThemeId"
    | "darkThemeId"
    | "lightTheme"
    | "darkTheme"
    | "uiFontSize"
    | "codeFontSize"
    | "diffMarkerStyle"
    | "reducedMotionPreference"
    | "useFontSmoothing"
    | "usePointerCursors"
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
    theme: settings.theme,
    lightThemeId: settings.lightThemeId,
    darkThemeId: settings.darkThemeId,
    lightTheme: settings.lightTheme,
    darkTheme: settings.darkTheme,
    uiFontSize: settings.uiFontSize,
    codeFontSize: settings.codeFontSize,
    configPath,
    diffMarkerStyle: settings.diffMarkerStyle,
    reducedMotionPreference: settings.reducedMotionPreference,
    useFontSmoothing: settings.useFontSmoothing,
    usePointerCursors: settings.usePointerCursors,
  }
}
