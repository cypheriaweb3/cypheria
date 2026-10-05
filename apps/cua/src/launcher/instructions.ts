import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { BrowserBackend } from "../browser/types.ts"
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
  browser: "browsers (`cua.getBrowser`, `cua.getTab`)",
  computer: "native apps (`cua.getApp`)",
}

/**
 * Assembles the `js` tool description from the fragments in `instructions/`: the common
 * introduction, the browser entry points with the enabled backends, the native app entry point
 * of the platform, a note naming disabled surfaces, and the output rules.
 */
export const loadInstructions = (
  root: string,
  surfaces: readonly CuaSurface[],
  backends: readonly BrowserBackend[],
  platform: NodeJS.Platform = process.platform
): CuaReplInstructions => {
  const directory = PLATFORM_DIRECTORIES[platform]
  if (!directory) throw new Error(`unsupported cua_repl platform=${platform}`)
  const read = (name: string) => readFileSync(join(root, "instructions", name), "utf8").trimEnd()
  const enabled = new Set(surfaces)
  const parts = [read("description.md")]
  if (enabled.has("browser")) {
    parts.push(
      [read("browser.md"), ...backends.map((backend) => read(`browser-${backend}.md`))].join("\n")
    )
  }
  if (enabled.has("computer")) parts.push(read(`${directory}/computer.md`))
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
