import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CUA_SURFACES, type CuaSurface } from "../surfaces.ts"

const PLATFORM_DIRECTORIES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "win32",
}

/** What the model reads about `cua_repl` before it calls it. */
export type CuaReplInstructions = {
  readonly serverInstructions: string
  readonly jsDescription: string
  readonly codeDescription: string
  readonly resetDescription: string
}

const SURFACE_NAMES: Record<CuaSurface, string> = {
  browsers: "external browsers (`cua.browsers`)",
  computer: "native apps (`cua.getApp`)",
  iab: "the built-in browser (`cua.iab`)",
  mcpapps: "MCP Apps (`cua.mcpApps`)",
}

/**
 * Assembles the `js` tool description from the fragments in `instructions/`: the common
 * introduction, the entry points of each enabled surface, a note naming disabled ones, and the
 * output rules. Native app entry points differ by platform.
 */
export const loadInstructions = (
  root: string,
  surfaces: readonly CuaSurface[],
  platform: NodeJS.Platform = process.platform
): CuaReplInstructions => {
  const directory = PLATFORM_DIRECTORIES[platform]
  if (!directory) throw new Error(`unsupported cua_repl platform=${platform}`)
  const read = (name: string) => readFileSync(join(root, "instructions", name), "utf8").trimEnd()
  const enabled = new Set(surfaces)
  const parts = [read("description.md")]
  for (const surface of CUA_SURFACES) {
    if (!enabled.has(surface)) continue
    parts.push(read(surface === "computer" ? `${directory}/computer.md` : `${surface}.md`))
  }
  const disabled = CUA_SURFACES.filter((surface) => !enabled.has(surface))
  if (disabled.length > 0) {
    parts.push(
      `${read("disabled.md")} ${disabled.map((surface) => SURFACE_NAMES[surface]).join(", ")}.`
    )
  }
  parts.push(read("output.md"))
  return {
    codeDescription: read("code.md"),
    jsDescription: parts.join("\n\n"),
    resetDescription: read("reset.md"),
    serverInstructions: read("server.md"),
  }
}
