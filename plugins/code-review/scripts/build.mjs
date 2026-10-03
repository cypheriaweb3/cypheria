import { access, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const root = fileURLToPath(new URL("../", import.meta.url))

/** What an installed plugin needs; sources, build configuration, and dependencies stay behind. */
const PLUGIN_FILES = [
  ".claude-mcp.json",
  ".claude-plugin",
  ".codex-mcp.json",
  ".codex-plugin",
  "dist/app.html",
  "src/server",
]

/** Copies the installable plugin, with the App built into `dist/app.html`, to `pluginDir`. */
export const packagePlugin = async (pluginDir) => {
  try {
    await access(path.join(root, "dist/app.html"))
  } catch {
    throw new Error(
      "The Code Review App is not built. Run `pnpm --filter @cypheria/code-review build`."
    )
  }
  await rm(pluginDir, { force: true, recursive: true })
  for (const file of PLUGIN_FILES) {
    await mkdir(path.dirname(path.join(pluginDir, file)), { recursive: true })
    await cp(path.join(root, file), path.join(pluginDir, file), { recursive: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { "plugin-dir": { type: "string" } } })
  const { build } = await import("vite")
  await build({ configFile: path.join(root, "vite.config.ts"), root: path.join(root, "src/app") })
  if (values["plugin-dir"]) await packagePlugin(path.resolve(values["plugin-dir"]))
}
