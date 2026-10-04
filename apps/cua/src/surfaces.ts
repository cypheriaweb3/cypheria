/**
 * The UI surfaces `cua_repl` can control. Each has its own API in the `cua` global, and the
 * launcher describes only the enabled ones to the model.
 */
export const CUA_SURFACES = ["iab", "browsers", "mcpapps", "computer"] as const
export type CuaSurface = (typeof CUA_SURFACES)[number]

/** The environment variable that carries the enabled surfaces into the launcher and runtime. */
export const ENABLED_SURFACES_ENV = "CUA_REPL_ENABLED_SURFACES"

/** Parses a comma-separated surface list. Unknown names are rejected, never ignored. */
export const parseSurfaces = (value: string | undefined): CuaSurface[] => {
  if (value === undefined) throw new Error(`${ENABLED_SURFACES_ENV} is required`)
  const surfaces = new Set<CuaSurface>()
  for (const entry of value.split(",")) {
    const name = entry.trim()
    if (!name) continue
    if (!(CUA_SURFACES as readonly string[]).includes(name)) {
      throw new Error(`unknown ${ENABLED_SURFACES_ENV} surface=${name}`)
    }
    surfaces.add(name as CuaSurface)
  }
  return CUA_SURFACES.filter((surface) => surfaces.has(surface))
}

export const formatSurfaces = (surfaces: Iterable<CuaSurface>): string => {
  const enabled = new Set(surfaces)
  return CUA_SURFACES.filter((surface) => enabled.has(surface)).join(",")
}
