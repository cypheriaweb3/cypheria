import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Resolves the path to the node_repl executable.
 * Priority:
 * 1. Process environment variable CYPHERIA_NODE_REPL_PATH
 * 2. Monorepo apps/node-repl/dist/node_repl (or .exe on Windows)
 * 3. Relative to current file / bundle
 * 4. Fallback to "node_repl" in PATH
 */
export const resolveNodeReplBinary = (): string => {
  if (process.env.CYPHERIA_NODE_REPL_PATH && existsSync(process.env.CYPHERIA_NODE_REPL_PATH)) {
    return process.env.CYPHERIA_NODE_REPL_PATH
  }

  const exeName = process.platform === "win32" ? "node_repl.exe" : "node_repl"
  const currentDir = dirname(fileURLToPath(import.meta.url))

  const candidates = [
    // Source: apps/server/src/node-repl -> apps/node-repl/dist/node_repl
    resolve(currentDir, "../../../node-repl/dist", exeName),
    // Dist: apps/server/dist -> apps/node-repl/dist/node_repl
    resolve(currentDir, "../../node-repl/dist", exeName),
    // Packaged/installed adjacent
    resolve(currentDir, "../node-repl", exeName),
    resolve(currentDir, exeName),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return exeName
}
