import { homedir } from "node:os"
import { resolve } from "node:path"

export const CYPHERIA_HOME_ENV = "CYPHERIA_HOME"
export const CODEX_HOME_ENV = "CODEX_HOME"
export const DEFAULT_CYPHERIA_HOME_BASENAME = ".cypheria"

export type RuntimeHomeEnv = Record<string, string | undefined>

export type RuntimeHomeOptions = {
  readonly env?: RuntimeHomeEnv
  readonly homeDir?: string
}

export type CypheriaRuntimePaths = {
  readonly cypheriaHome: string
  readonly codexHome: string
  readonly dbDir: string
  readonly vaultDir: string
  readonly logsDir: string
  readonly cacheDir: string
  readonly browserDir: string
  readonly automationDir: string
  readonly configDir: string
}

const getConfiguredHome = (env: RuntimeHomeEnv): string | undefined => {
  const value = env[CYPHERIA_HOME_ENV]?.trim()
  return value ? value : undefined
}

export const resolveCypheriaHome = (options: RuntimeHomeOptions = {}): string => {
  const env = options.env ?? process.env
  const configuredHome = getConfiguredHome(env)

  if (configuredHome) {
    return resolve(configuredHome)
  }

  return resolve(options.homeDir ?? homedir(), DEFAULT_CYPHERIA_HOME_BASENAME)
}

export const buildRuntimePaths = (options: RuntimeHomeOptions = {}): CypheriaRuntimePaths => {
  const cypheriaHome = resolveCypheriaHome(options)
  const pathInHome = (name: string) => resolve(cypheriaHome, name)

  return {
    cypheriaHome,
    codexHome: pathInHome("codex"),
    dbDir: pathInHome("db"),
    vaultDir: pathInHome("vault"),
    logsDir: pathInHome("logs"),
    cacheDir: pathInHome("cache"),
    browserDir: pathInHome("browser"),
    automationDir: pathInHome("automation"),
    configDir: pathInHome("config"),
  }
}

export const buildCodexEnvironment = (
  paths: Pick<CypheriaRuntimePaths, "codexHome">,
  baseEnv: RuntimeHomeEnv = process.env
): RuntimeHomeEnv => ({
  ...baseEnv,
  [CODEX_HOME_ENV]: paths.codexHome,
})
