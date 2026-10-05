import { homedir } from "node:os"

import { buildRuntimePaths } from "@cypheria/server/runtime"

export type DesktopAppPaths = {
  readonly browserDir: string
  readonly codexHome: string
  readonly configDir: string
  readonly cypheriaHome: string
}

/**
 * Desktop's paths in the Cypheria home, derived from the Server's runtime paths so both name the
 * same directories, such as the Codex home that Cypheria's Codex runs with.
 */
export const buildDesktopAppPaths = (
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): DesktopAppPaths => {
  const { browserDir, codexHome, configDir, cypheriaHome } = buildRuntimePaths({ env, homeDir })
  return { browserDir, codexHome, configDir, cypheriaHome }
}
