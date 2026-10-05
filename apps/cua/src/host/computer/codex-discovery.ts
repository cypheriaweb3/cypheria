import { execFile } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join } from "node:path"
import { promisify } from "node:util"

import { z } from "zod"

import type { McpLaunch } from "./mcp-stdio.ts"

const run = promisify(execFile)

/** OpenAI's Apple Developer team, which signs ChatGPT and Codex Computer Use. */
export const OPENAI_TEAM_ID = "2DC432GLL2"

const CHATGPT_APP = "/Applications/ChatGPT.app"

/** Environment that selects ChatGPT's browser backends or instructions, which Cypheria drops. */
const BROWSER_ENV =
  /^(BROWSER_USE_|NODE_REPL_INSTRUCTIONS_USE_CASE_(BROWSER|CHROME)$|CUA_REPL_BROWSER_ENV$)/

const ServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
})
const McpJsonSchema = z.object({ mcpServers: z.object({ cua_repl: ServerSchema }) })

/** The `cua_repl` server ChatGPT configured for Codex, as its `.mcp.json` describes it. */
export type CodexComputerUseServer = z.infer<typeof ServerSchema> & {
  readonly version: string
  readonly path: string
}

/** Whether the installed ChatGPT's Computer Use runtime can serve this device, and why not. */
export type CodexComputerUseDetection =
  | {
      readonly available: true
      readonly version: string
      readonly server: CodexComputerUseServer
      /** Codex Computer Use.app, which owns the Accessibility and Screen Recording grants. */
      readonly serviceApp: string
      /** The Codex that sandboxes the runtime's kernel: Cypheria's, else the one ChatGPT names. */
      readonly codexCli: string
    }
  | { readonly available: false; readonly reason: string; readonly version?: string }

export type DetectOptions = {
  readonly home?: string
  readonly platform?: NodeJS.Platform
  /**
   * Cypheria's own Codex executable, which sandboxes the runtime's kernel; without it, the Codex
   * that ChatGPT's `.mcp.json` names does.
   */
  readonly codexCli: string | null
  /** Runs a command and returns its output, for tests. */
  readonly exec?: (
    command: string,
    args: readonly string[]
  ) => Promise<{ stdout: string; stderr: string }>
}

const versionKey = (version: string) =>
  version.split(".").map((part) => Number.parseInt(part, 10) || 0)

const compareVersions = (a: string, b: string): number => {
  const left = versionKey(a)
  const right = versionKey(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * The newest `.mcp.json` ChatGPT wrote for its unified Computer Use plugin, preferring the one
 * that matches the installed ChatGPT's version.
 */
export const findCodexComputerUseServer = (
  home: string,
  appVersion: string | undefined
): CodexComputerUseServer | null => {
  const root = join(home, ".codex", "plugins", "cache", "openai-bundled", "unified-computer-use")
  let versions: string[]
  try {
    versions = readdirSync(root).filter((entry) => existsSync(join(root, entry, ".mcp.json")))
  } catch {
    return null
  }
  versions.sort(compareVersions).reverse()
  const ordered =
    appVersion && versions.includes(appVersion)
      ? [appVersion, ...versions.filter((entry) => entry !== appVersion)]
      : versions
  for (const version of ordered) {
    const path = join(root, version, ".mcp.json")
    try {
      const parsed = McpJsonSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
      if (parsed.success) return { ...parsed.data.mcpServers.cua_repl, path, version }
    } catch {
      // A damaged file falls back to the next version.
    }
  }
  return null
}

/**
 * Cypheria's native Codex executable from an installation receipt. The receipt may name the npm
 * launcher (`node …/@openai/codex/bin/codex.js`); the native binary lives in the platform
 * package beside it.
 */
export const nativeCodexBinary = (receipt: {
  readonly command: string
  readonly args?: readonly string[]
}): string | null => {
  const name = basename(receipt.command).toLowerCase()
  if (name === "codex" || name === "codex.exe") return receipt.command
  const launcher = receipt.args?.find((arg) => arg.endsWith(join("bin", "codex.js")))
  if (!launcher) return null
  const scope = dirname(dirname(dirname(launcher)))
  const executable = process.platform === "win32" ? "codex.exe" : "codex"
  const candidates: string[] = []
  try {
    for (const entry of readdirSync(scope)) {
      if (!entry.startsWith("codex")) continue
      const vendor = join(scope, entry, "vendor")
      if (!existsSync(vendor)) continue
      for (const triple of readdirSync(vendor)) {
        candidates.push(join(vendor, triple, "bin", executable))
        candidates.push(join(vendor, triple, "codex", executable))
      }
    }
  } catch {
    return null
  }
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  )
}

/**
 * The environment Cypheria starts the runtime with: ChatGPT's own, changed only so it runs under
 * Cypheria's Codex and home, serves native apps alone, loads only the `sky` service, and has
 * the service's audio recording.
 */
export const codexComputerUseEnvironment = (
  server: CodexComputerUseServer,
  options: { readonly codexCli: string; readonly codexHome: string; readonly path?: string }
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.env)) {
    if (!BROWSER_ENV.test(key)) env[key] = value
  }
  const originalHome = server.env.CODEX_HOME
  if (env.NODE_REPL_TRUSTED_CODE_PATHS) {
    env.NODE_REPL_TRUSTED_CODE_PATHS = env.NODE_REPL_TRUSTED_CODE_PATHS.split(delimiter)
      .map((entry) => (originalHome && entry === originalHome ? options.codexHome : entry))
      .join(delimiter)
  }
  env.CODEX_HOME = options.codexHome
  env.CODEX_CLI_PATH = options.codexCli
  env.CUA_REPL_ENABLED_SURFACES = "computer"
  // Gives the runtime its audio recording methods; Cypheria calls them only when the model asks.
  env.SKY_ENABLE_AUDIO = "1"
  env.NODE_REPL_TRUSTED_SERVICES = JSON.stringify({ sky: "@oai/sky/service" })
  return {
    HOME: process.env.HOME ?? homedir(),
    PATH: options.path ?? process.env.PATH ?? "/usr/bin:/bin",
    ...env,
  }
}

export const codexComputerUseLaunch = (
  server: CodexComputerUseServer,
  options: { readonly codexCli: string; readonly codexHome: string }
): McpLaunch => ({
  args: server.args,
  command: server.command,
  env: codexComputerUseEnvironment(server, options),
})

const defaultExec = async (command: string, args: readonly string[]) => {
  const { stderr, stdout } = await run(command, [...args], { timeout: 20_000 })
  return { stderr: String(stderr), stdout: String(stdout) }
}

/** The app's signing team, after a strict verification; null when it does not verify. */
const signingTeam = async (
  app: string,
  exec: NonNullable<DetectOptions["exec"]>
): Promise<string | null> => {
  try {
    await exec("codesign", ["--verify", "--strict", app])
    const { stderr, stdout } = await exec("codesign", ["-dv", "--verbose=2", app])
    return /TeamIdentifier=(\S+)/.exec(`${stdout}\n${stderr}`)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Detects the Computer Use runtime of the person's installed ChatGPT with static checks only:
 * the files its `.mcp.json` names exist, ChatGPT and Codex Computer Use carry OpenAI's signature,
 * and Cypheria's Codex can sandbox the runtime's kernel. Compatibility is the runtime's own
 * handshake to decide when it runs.
 */
export const detectCodexComputerUse = async (
  options: DetectOptions
): Promise<CodexComputerUseDetection> => {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { available: false, reason: "Codex Computer Use runs on macOS only." }
  }
  const exec = options.exec ?? defaultExec
  if (!existsSync(CHATGPT_APP)) {
    return { available: false, reason: "ChatGPT is not installed in /Applications." }
  }
  const appVersion = await exec("plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    join(CHATGPT_APP, "Contents", "Info.plist"),
  ])
    .then(({ stdout }) => stdout.trim() || undefined)
    .catch(() => undefined)
  const server = findCodexComputerUseServer(options.home ?? homedir(), appVersion)
  if (!server) {
    return {
      available: false,
      reason: "Turn on Computer Use once in the ChatGPT app, which installs and authorizes it.",
    }
  }
  const missing = [
    server.command,
    ...server.args.filter((arg) => arg.startsWith("/")),
    server.env.CUA_REPL_NODE_REPL_PATH,
    ...(server.env.NODE_REPL_NODE_MODULE_DIRS ?? "").split(delimiter),
    server.env.SKY_CUA_SERVICE_PATH,
  ].filter((path): path is string => !path || !existsSync(path))
  if (missing.length > 0) {
    return {
      available: false,
      reason: `ChatGPT's Computer Use files are missing (${missing.map((path) => path || "an unnamed path").join(", ")}). Turn Computer Use off and on in ChatGPT.`,
      version: server.version,
    }
  }
  const serviceApp = server.env.SKY_CUA_SERVICE_PATH ?? ""
  for (const app of [CHATGPT_APP, serviceApp]) {
    const team = await signingTeam(app, exec)
    if (team !== OPENAI_TEAM_ID) {
      return {
        available: false,
        reason: `${basename(app)} does not carry OpenAI's signature.`,
        version: server.version,
      }
    }
  }
  const codexCli = options.codexCli ?? server.env.CODEX_CLI_PATH
  if (!codexCli || !existsSync(codexCli)) {
    return {
      available: false,
      reason: "No Codex is available to sandbox the runtime; install Codex in Cypheria.",
      version: server.version,
    }
  }
  try {
    await exec(codexCli, ["sandbox", "--help"])
  } catch {
    return {
      available: false,
      reason:
        codexCli === options.codexCli
          ? "Cypheria's Codex cannot sandbox the runtime; update Codex in Cypheria."
          : "ChatGPT's Codex cannot sandbox the runtime; update ChatGPT.",
      version: server.version,
    }
  }
  return { available: true, codexCli, server, serviceApp, version: server.version }
}
