import { spawn } from "node:child_process"
import { once } from "node:events"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

import { ENABLED_SURFACES_ENV, formatSurfaces, parseSurfaces } from "../surfaces.ts"
import { loadInstructions } from "./instructions.ts"

export const NODE_REPL_PATH_ENV = "CUA_REPL_NODE_REPL_PATH"

/** The `cua` runtime module the banner imports, relative to the package root. */
export const RUNTIME_ENTRY = "dist/runtime.mjs"

/** The environment `node_repl` starts with to present itself as `cua_repl`. */
export const cuaReplEnvironment = (
  root: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv => {
  const surfaces = parseSurfaces(env[ENABLED_SURFACES_ENV])
  const instructions = loadInstructions(root, surfaces, platform)
  const overrides = {
    server_instructions: instructions.serverInstructions,
    tools: {
      js: {
        description: instructions.jsDescription,
        field_descriptions: { code: instructions.codeDescription },
      },
      js_reset: { description: instructions.resetDescription },
    },
  }
  const banner = `await import(${JSON.stringify(pathToFileURL(join(root, RUNTIME_ENTRY)).href)});`
  return {
    ...env,
    [ENABLED_SURFACES_ENV]: formatSurfaces(surfaces),
    NODE_REPL_JS_BANNER: env.NODE_REPL_JS_BANNER ?? banner,
    CUA_REPL_PLATFORM: platform,
    NODE_REPL_TOOL_OVERRIDES: JSON.stringify(overrides),
    NODE_REPL_TRUSTED_RPC_ENABLED: "1",
    // The runtime reads these from the frozen `nodeRepl.env` snapshot.
    NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: [
      env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST,
      ENABLED_SURFACES_ENV,
      "CUA_REPL_PLATFORM",
    ]
      .filter(Boolean)
      .join(","),
  }
}

/**
 * Starts `node_repl` as `cua_repl` and mirrors its lifetime: stdio is inherited, signals are
 * forwarded, and the exit status is passed through.
 */
export const launch = async (root: string, env: NodeJS.ProcessEnv = process.env): Promise<void> => {
  const nodeRepl = env[NODE_REPL_PATH_ENV]
  if (!nodeRepl || !isAbsolute(nodeRepl)) {
    throw new Error(`${NODE_REPL_PATH_ENV} must name an absolute executable`)
  }
  const child = spawn(nodeRepl, [], { env: cuaReplEnvironment(root, env), stdio: "inherit" })
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const
  const forward = (signal: NodeJS.Signals) => {
    child.kill(signal)
  }
  for (const signal of signals) process.on(signal, forward)
  try {
    const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null]
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code !== null && code >= 0 ? code : 1
  } finally {
    for (const signal of signals) process.off(signal, forward)
  }
}
