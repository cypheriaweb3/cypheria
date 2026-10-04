import { randomUUID } from "node:crypto"
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import {
  CUA_PLUGIN_NAME,
  cuaReplLaunch,
  generateCuaPlugin,
  resolveCuaRoot,
} from "@cypheria/cua/plugin"

import { CUA_HOST_PIPE_ENV, CUA_SURFACES_ENV } from "../node-repl/host-manager.js"
import { resolveNodeReplBinary } from "../node-repl/resolve-binary.js"

const SKIPPED = new Set(["node_modules", ".turbo", ".vite"])

const CUA_DESCRIPTION =
  "Cypheria-managed Computer Use runtime for native apps and browsers. Installed automatically."

type MarketplaceFile = { plugins: Record<string, unknown>[] } & Record<string, unknown>

const addPlugin = async (file: string, entry: Record<string, unknown>) => {
  const marketplace = JSON.parse(await readFile(file, "utf8")) as MarketplaceFile
  marketplace.plugins = [
    ...marketplace.plugins.filter((plugin) => plugin.name !== entry.name),
    entry,
  ]
  await writeFile(file, `${JSON.stringify(marketplace, null, 2)}\n`)
}

/**
 * Writes the marketplace Agents install bundled plugins from: the checked-in plugins without
 * dependency directories, plus the hidden `cua` plugin generated from the `@cypheria/cua`
 * template with this installation's launcher. Its `cua_repl` server stays disabled until a
 * Thread enables it with that Thread's host; Claude sessions supply their host through
 * environment variables Claude expands.
 */
export const materializeBundledMarketplace = async (
  source: string,
  target: string
): Promise<string> => {
  const staging = `${target}.${randomUUID()}`
  await cp(source, staging, {
    filter: (path) => !SKIPPED.has(basename(path)),
    recursive: true,
  })
  try {
    const root = resolveCuaRoot()
    await generateCuaPlugin({
      claudeEnv: {
        CUA_REPL_ENABLED_SURFACES: `\${${CUA_SURFACES_ENV}:-}`,
        NODE_REPL_HOST_SERVICES_PIPE_PATH: `\${${CUA_HOST_PIPE_ENV}:-}`,
      },
      directory: join(staging, CUA_PLUGIN_NAME),
      launch: cuaReplLaunch({
        nodePath: process.execPath,
        nodeReplPath: resolveNodeReplBinary(),
        root,
        surfaces: [],
      }),
      root,
    })
    await addPlugin(join(staging, ".agents", "plugins", "marketplace.json"), {
      category: "Productivity",
      name: CUA_PLUGIN_NAME,
      policy: { authentication: "ON_USE", installation: "INSTALLED_BY_DEFAULT" },
      source: { path: `./${CUA_PLUGIN_NAME}`, source: "local" },
    })
    await addPlugin(join(staging, ".claude-plugin", "marketplace.json"), {
      category: "Productivity",
      description: CUA_DESCRIPTION,
      name: CUA_PLUGIN_NAME,
      source: `./${CUA_PLUGIN_NAME}`,
    })
    await rm(target, { force: true, recursive: true })
    await rename(staging, target)
    return target
  } catch (error) {
    await rm(staging, { force: true, recursive: true })
    throw error
  }
}
