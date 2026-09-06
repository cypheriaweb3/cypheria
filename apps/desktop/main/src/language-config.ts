import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import {
  LanguagePreferenceSchema,
  type LanguageSettings,
  type LanguageSettingsWrite,
  LanguageSettingsWriteSchema,
  type SupportedLocale,
} from "../../ipc/src/index.js"
import { getCodexConfigPath } from "./appearance-config.js"

const sectionHeaderPattern = /^\s*\[([^\]]+)]\s*(?:#.*)?$/
const localeOverridePattern = /^\s*localeOverride\s*=\s*(["'])(.*?)\1\s*(?:#.*)?$/

export const getLanguageConfigPath = getCodexConfigPath

export const resolveSupportedLocale = (
  preference: LanguageSettingsWrite["preference"],
  preferredSystemLanguages: readonly string[]
): SupportedLocale => {
  if (preference !== "system") {
    return preference === "zh-CN" ? "zh-CN" : "en"
  }

  for (const language of preferredSystemLanguages) {
    const normalized = language.toLowerCase()
    if (
      normalized === "zh" ||
      normalized.startsWith("zh-cn") ||
      normalized.startsWith("zh-sg") ||
      normalized.startsWith("zh-hans")
    ) {
      return "zh-CN"
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en"
    }
  }

  return "en"
}

export const parseLanguagePreferenceFromToml = (
  toml: string
): LanguageSettingsWrite["preference"] => {
  let inDesktopSection = false

  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(sectionHeaderPattern)
    if (sectionMatch) {
      inDesktopSection = sectionMatch[1] === "desktop"
      continue
    }

    if (!inDesktopSection) {
      continue
    }

    const overrideMatch = line.match(localeOverridePattern)
    if (!overrideMatch?.[2]) {
      continue
    }

    const parsed = LanguagePreferenceSchema.safeParse(overrideMatch[2])
    return parsed.success && parsed.data !== "system" ? parsed.data : "system"
  }

  return "system"
}

export const mergeLanguagePreferenceIntoToml = (
  toml: string,
  preference: LanguageSettingsWrite["preference"]
): string => {
  const lines = toml.split(/\r?\n/)
  const keptLines: string[] = []
  let inDesktopSection = false
  let desktopHeaderIndex = -1

  for (const line of lines) {
    const sectionMatch = line.match(sectionHeaderPattern)
    if (sectionMatch) {
      inDesktopSection = sectionMatch[1] === "desktop"
      if (inDesktopSection && desktopHeaderIndex < 0) {
        desktopHeaderIndex = keptLines.length
      }
      keptLines.push(line)
      continue
    }

    if (inDesktopSection && localeOverridePattern.test(line)) {
      continue
    }

    keptLines.push(line)
  }

  const stripped = keptLines.join("\n").trimEnd()
  if (preference === "system") {
    return stripped ? `${stripped}\n` : ""
  }

  const setting = `localeOverride = ${JSON.stringify(preference)}`
  if (desktopHeaderIndex >= 0) {
    keptLines.splice(desktopHeaderIndex + 1, 0, setting)
    return `${keptLines.join("\n").trimEnd()}\n`
  }

  return stripped ? `${stripped}\n\n[desktop]\n${setting}\n` : `[desktop]\n${setting}\n`
}

export const readLanguageSettings = async (
  codexHome: string,
  preferredSystemLanguages: readonly string[]
): Promise<LanguageSettings> => {
  const configPath = getLanguageConfigPath(codexHome)
  let stored: LanguageSettingsWrite = { preference: "system" }

  try {
    stored = { preference: parseLanguagePreferenceFromToml(await readFile(configPath, "utf8")) }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return {
    ...stored,
    configPath,
    locale: resolveSupportedLocale(stored.preference, preferredSystemLanguages),
  }
}

export const writeLanguageSettings = async (
  codexHome: string,
  settings: LanguageSettingsWrite,
  preferredSystemLanguages: readonly string[]
): Promise<LanguageSettings> => {
  const parsed = LanguageSettingsWriteSchema.parse(settings)
  const configPath = getLanguageConfigPath(codexHome)
  let existingToml = ""

  try {
    existingToml = await readFile(configPath, "utf8")
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, mergeLanguagePreferenceIntoToml(existingToml, parsed.preference), {
    encoding: "utf8",
    mode: 0o600,
  })

  return {
    ...parsed,
    configPath,
    locale: resolveSupportedLocale(parsed.preference, preferredSystemLanguages),
  }
}

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"
