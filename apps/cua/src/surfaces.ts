import { BROWSER_BACKENDS, type BrowserBackend } from "./browser/types.ts"

/**
 * The surfaces `cua_repl` exposes, with ChatGPT's names: browsers through `agent.browsers` and
 * `cua.getBrowser()`, and native apps through `cua.getApp()`. The launcher describes only the
 * enabled ones to the model.
 */
export const CUA_SURFACES = ["browser", "computer"] as const
export type CuaSurface = (typeof CUA_SURFACES)[number]

/** What a host can offer: one of the browser backends, or native app control. */
export type HostCapability = BrowserBackend | "computer"
export const HOST_CAPABILITIES: readonly HostCapability[] = [...BROWSER_BACKENDS, "computer"]

/** The environment variable that carries the enabled surfaces into the launcher and runtime. */
export const ENABLED_SURFACES_ENV = "CUA_REPL_ENABLED_SURFACES"
/** The browser backends the settings allow, so documentation names only those. */
export const BROWSER_BACKENDS_ENV = "CUA_REPL_BROWSER_BACKENDS"

/** Parses a comma-separated surface list. Unknown names are rejected, never ignored. */
export const parseSurfaces = (value: string | undefined): CuaSurface[] => {
  if (value === undefined) throw new Error(`${ENABLED_SURFACES_ENV} is required`)
  return parseList(value, CUA_SURFACES, ENABLED_SURFACES_ENV)
}

export const parseBrowserBackends = (value: string | undefined): BrowserBackend[] =>
  parseList(value ?? "", BROWSER_BACKENDS, BROWSER_BACKENDS_ENV)

const parseList = <T extends string>(value: string, known: readonly T[], name: string): T[] => {
  const found = new Set<T>()
  for (const entry of value.split(",")) {
    const item = entry.trim()
    if (!item) continue
    if (!(known as readonly string[]).includes(item)) {
      throw new Error(`unknown ${name} entry=${item}`)
    }
    found.add(item as T)
  }
  return known.filter((item) => found.has(item))
}

export const formatSurfaces = (surfaces: Iterable<CuaSurface>): string => {
  const enabled = new Set(surfaces)
  return CUA_SURFACES.filter((surface) => enabled.has(surface)).join(",")
}
