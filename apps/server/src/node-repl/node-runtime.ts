/**
 * Optional `node_repl` features the Server's own environment turns on, which Agents do not pass
 * through to MCP servers by themselves: `NODE_REPL_ENABLE_AUDIO=1` gives code `nodeRepl.emitAudio`.
 */
export const nodeReplFeatureEnv = (env: NodeJS.ProcessEnv = process.env): Record<string, string> =>
  env.NODE_REPL_ENABLE_AUDIO === "1" ? { NODE_REPL_ENABLE_AUDIO: "1" } : {}

/** A Node.js executable for `node_repl` kernels and the `cua_repl` launcher, and the environment it needs. */
export type NodeRuntime = {
  readonly path: string
  readonly env: Readonly<Record<string, string>>
}

/**
 * Prefers Cypheria's managed Node.js. Without it, falls back to the Server's own executable; a
 * Desktop-managed Server runs on Electron, which only behaves as Node.js with
 * `ELECTRON_RUN_AS_NODE`, so that fallback sets it explicitly instead of relying on inheritance.
 */
export const resolveNodeRuntime = (managedNode: string | undefined): NodeRuntime => {
  if (managedNode) return { env: {}, path: managedNode }
  return {
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
    path: process.execPath,
  }
}
