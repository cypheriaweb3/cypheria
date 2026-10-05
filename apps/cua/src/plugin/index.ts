import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BrowserBackend } from "../browser/types.ts"
import { NODE_REPL_PATH_ENV } from "../launcher/launch.ts"
import {
  BROWSER_BACKENDS_ENV,
  type CuaSurface,
  ENABLED_SURFACES_ENV,
  formatSurfaces,
} from "../surfaces.ts"

/** The hidden plugin's name and the MCP server it declares. */
export const CUA_PLUGIN_NAME = "cua"
export const CUA_REPL_SERVER = "cua_repl"
/** The launcher the MCP server runs, relative to the package root. */
export const LAUNCHER_ENTRY = "dist/cua-repl.mjs"

/**
 * Finds the package root that carries the built launcher: `CYPHERIA_CUA_ROOT`, this package in a
 * checkout, or the copy a Server build places next to its bundle (`dist/cua`).
 */
export const resolveCuaRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const candidates = [
    env.CYPHERIA_CUA_ROOT,
    fileURLToPath(new URL("../../", import.meta.url)),
    fileURLToPath(new URL("./cua/", import.meta.url)),
    fileURLToPath(new URL("../../../cua/", import.meta.url)),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const root = candidates.find((candidate) => existsSync(join(candidate, LAUNCHER_ENTRY)))
  if (!root) {
    throw new Error("The cua runtime is not built; run `pnpm --filter @cypheria/cua build`.")
  }
  return root
}

/** How to start `cua_repl`: the same shape as an MCP server's command, args, and env. */
export type CuaReplLaunch = {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export type CuaReplLaunchInput = {
  readonly root: string
  /** The Node.js executable that runs the launcher. */
  readonly nodePath: string
  /** The `node_repl` executable the launcher starts. */
  readonly nodeReplPath: string
  readonly surfaces: readonly CuaSurface[]
  /** The browser backends settings allow, which the tool description names. */
  readonly backends?: readonly BrowserBackend[]
  /** Further `node_repl` environment, such as its host services pipe and sandbox. */
  readonly env?: Readonly<Record<string, string>>
}

export const cuaReplLaunch = (input: CuaReplLaunchInput): CuaReplLaunch => ({
  args: [join(input.root, LAUNCHER_ENTRY)],
  command: input.nodePath,
  env: {
    ...input.env,
    [ENABLED_SURFACES_ENV]: formatSurfaces(input.surfaces),
    [BROWSER_BACKENDS_ENV]: (input.backends ?? []).join(","),
    [NODE_REPL_PATH_ENV]: input.nodeReplPath,
    NODE_REPL_NODE_PATH: input.nodePath,
  },
})

type McpServerTemplate = Record<string, unknown> & { enabled?: boolean }

const readTemplate = async (root: string): Promise<McpServerTemplate> => {
  const template = JSON.parse(await readFile(join(root, "plugin", ".mcp.template.json"), "utf8"))
  const server = template?.mcpServers?.[CUA_REPL_SERVER]
  if (!server || typeof server !== "object") {
    throw new Error(`The cua plugin template does not declare ${CUA_REPL_SERVER}`)
  }
  return server as McpServerTemplate
}

/**
 * The Codex `mcp_servers.cua_repl` entry: the template's tool exposure and limits with this
 * launch. A Thread passes it as a config override so the server reaches that Thread's host.
 */
export const cuaReplServerConfig = async (
  root: string,
  launch: CuaReplLaunch,
  enabled = true
): Promise<Record<string, unknown>> => ({
  ...(await readTemplate(root)),
  args: [...launch.args],
  command: launch.command,
  enabled,
  env: { ...launch.env },
})

export type GeneratedCuaPlugin = { readonly directory: string; readonly version: string }

/**
 * Writes the hidden `cua` plugin from the package template into `directory`: its Codex and Claude
 * manifests and MCP configurations filled in with `launch`. The server
 * stays disabled in the plugin; each Thread enables it with its own host (`cuaReplServerConfig`).
 * The version carries a digest of the configuration, so a moved installation reinstalls.
 */
export const generateCuaPlugin = async (input: {
  readonly root: string
  readonly directory: string
  readonly launch: CuaReplLaunch
  /** Claude-only environment, such as `${VAR}` references Claude expands per session. */
  readonly claudeEnv?: Readonly<Record<string, string>>
}): Promise<GeneratedCuaPlugin> => {
  const template = join(input.root, "plugin")
  const codex = JSON.parse(await readFile(join(template, ".codex-plugin", "plugin.json"), "utf8"))
  const claude = JSON.parse(await readFile(join(template, ".claude-plugin", "plugin.json"), "utf8"))
  const server = await cuaReplServerConfig(input.root, input.launch, false)
  const mcp = { mcpServers: { [CUA_REPL_SERVER]: server } }
  const claudeMcp = {
    mcpServers: {
      [CUA_REPL_SERVER]: {
        args: server.args,
        command: server.command,
        env: { ...(server.env as Record<string, string>), ...input.claudeEnv },
      },
    },
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([codex, claude, mcp]))
    .digest("hex")
    .slice(0, 12)
  const version = `${codex.version}-g${digest}`
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  await rm(input.directory, { force: true, recursive: true })
  await mkdir(join(input.directory, ".codex-plugin"), { recursive: true })
  await mkdir(join(input.directory, ".claude-plugin"), { recursive: true })
  await writeFile(
    join(input.directory, ".codex-plugin", "plugin.json"),
    json({ ...codex, version })
  )
  await writeFile(
    join(input.directory, ".claude-plugin", "plugin.json"),
    json({ ...claude, version })
  )
  await writeFile(join(input.directory, ".mcp.json"), json(mcp))
  await writeFile(join(input.directory, ".claude-mcp.json"), json(claudeMcp))
  return { directory: input.directory, version }
}
