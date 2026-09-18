import { homedir } from "node:os"
import { resolve } from "node:path"

export type DesktopAppPaths = {
  readonly browserDir: string
  readonly codexHome: string
  readonly configDir: string
  readonly cypheriaHome: string
}

export const buildDesktopAppPaths = (
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): DesktopAppPaths => {
  const configured = env.CYPHERIA_HOME?.trim()
  const cypheriaHome = configured ? resolve(configured) : resolve(homeDir, ".cypheria")
  return {
    browserDir: resolve(cypheriaHome, "browser"),
    codexHome: resolve(cypheriaHome, "codex"),
    configDir: resolve(cypheriaHome, "config"),
    cypheriaHome,
  }
}
