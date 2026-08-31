import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { AppearanceFontFace, AppearanceFontOption } from "../../ipc/src/index.js"

const execFileAsync = promisify(execFile)

type SystemProfilerTypeface = {
  readonly _name?: string
  readonly enabled?: string
  readonly family?: string
  readonly fullname?: string
  readonly style?: string
  readonly valid?: string
}

type SystemProfilerFont = {
  readonly typefaces?: readonly SystemProfilerTypeface[]
}

type SystemProfilerFontsResponse = {
  readonly SPFontsDataType?: readonly SystemProfilerFont[]
}

export const listSystemFonts = async (): Promise<AppearanceFontOption[]> => {
  if (process.platform !== "darwin") {
    return []
  }

  try {
    const { stdout } = await execFileAsync("system_profiler", ["SPFontsDataType", "-json"], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    })
    return parseSystemProfilerFonts(JSON.parse(stdout) as SystemProfilerFontsResponse)
  } catch {
    return []
  }
}

export const parseSystemProfilerFonts = (
  payload: SystemProfilerFontsResponse
): AppearanceFontOption[] => {
  const byFamily = new Map<string, AppearanceFontFace[]>()

  for (const font of payload.SPFontsDataType ?? []) {
    for (const typeface of font.typefaces ?? []) {
      if (typeface.enabled === "no" || typeface.valid === "no") {
        continue
      }

      const family = typeface.family?.trim()
      if (!family) {
        continue
      }

      const fullName = typeface.fullname?.trim()
      const postscriptName = typeface._name?.trim()
      const face: AppearanceFontFace = {
        family,
        fullName,
        postscriptName,
        style: inferTypefaceStyle(family, fullName, typeface.style),
      }
      const faces = byFamily.get(family) ?? []
      faces.push(face)
      byFamily.set(family, faces)
    }
  }

  return Array.from(byFamily.entries())
    .map(([family, faces]) => ({
      faces: dedupeFaces(faces).sort((first, second) =>
        compareFontStyles(normalizeFontStyle(first.style), normalizeFontStyle(second.style))
      ),
      family,
      styles: uniqueFontStyles(faces),
    }))
    .sort((first, second) => first.family.localeCompare(second.family))
}

const inferTypefaceStyle = (
  family: string,
  fullName: string | undefined,
  fallbackStyle: string | undefined
): string => {
  if (fullName === family) {
    return "Regular"
  }

  if (fullName?.startsWith(`${family} `)) {
    return fullName.slice(family.length + 1).trim() || "Regular"
  }

  return normalizeFontStyle(fallbackStyle)
}

const dedupeFaces = (faces: readonly AppearanceFontFace[]): AppearanceFontFace[] => {
  const seen = new Set<string>()
  const next: AppearanceFontFace[] = []
  for (const face of faces) {
    const key = `${face.family}\n${face.fullName ?? ""}\n${face.postscriptName ?? ""}\n${face.style ?? ""}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    next.push(face)
  }
  return next
}

const uniqueFontStyles = (faces: readonly AppearanceFontFace[]): string[] => {
  const styles = Array.from(new Set(faces.map((face) => normalizeFontStyle(face.style))))
  return styles.sort(compareFontStyles)
}

const normalizeFontStyle = (style: string | undefined): string => {
  const normalized = style?.trim()
  return normalized ? normalized : "Regular"
}

const compareFontStyles = (first: string, second: string): number => {
  const preferredOrder = ["Regular", "Medium", "Semibold", "Bold", "Italic", "Bold Italic"]
  const firstIndex = preferredOrder.indexOf(first)
  const secondIndex = preferredOrder.indexOf(second)
  if (firstIndex !== -1 || secondIndex !== -1) {
    return (
      (firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex) -
      (secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex)
    )
  }
  return first.localeCompare(second)
}
