import type {
  PersistedServerConfig,
  PersistedServerConfigPatch,
  ServerConfigSnapshot,
} from "@cypheria/protocol"

import {
  type CypheriaServerConfig,
  type CypheriaServerConfigOverrides,
  loadServerConfig,
} from "./config.js"
import {
  applyPersistedServerConfigPatch,
  loadPersistedServerConfig,
  resolveServerConfigPath,
  savePersistedServerConfig,
} from "./persisted-config.js"

const EFFECTIVE_CONFIG_PATHS: ReadonlyArray<
  readonly [persisted: string, effective: keyof CypheriaServerConfig]
> = [
  ["server.cors.allowedOrigins", "allowedOrigins"],
  ["server.limits.maxMessageBytes", "maxMessageBytes"],
  ["server.listen.host", "host"],
  ["server.listen.port", "port"],
  ["server.relay.enabled", "relayEnabled"],
  ["server.relay.endpoint", "relayEndpoint"],
  ["server.relay.publicEndpoint", "relayPublicEndpoint"],
  ["server.relay.publicUseTls", "relayPublicUseTls"],
  ["server.relay.useTls", "relayUseTls"],
  ["server.sessions.helloTimeoutMs", "sessionHelloTimeoutMs"],
  ["server.sessions.reconnectGraceMs", "sessionReconnectGraceMs"],
  ["server.shutdownTimeoutMs", "shutdownTimeoutMs"],
  ["server.webApp.directory", "webAppDir"],
  ["server.webApp.enabled", "webAppEnabled"],
]

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export class ServerConfigStore {
  readonly #configDir: string
  readonly #env: NodeJS.ProcessEnv
  readonly #resolutionOverrides: CypheriaServerConfigOverrides
  readonly #runningConfig: CypheriaServerConfig

  #persisted: PersistedServerConfig
  #restartRequiredPaths: string[] = []

  private constructor(options: {
    configDir: string
    env: NodeJS.ProcessEnv
    persisted: PersistedServerConfig
    resolutionOverrides?: CypheriaServerConfigOverrides
    runningConfig: CypheriaServerConfig
  }) {
    this.#configDir = options.configDir
    this.#env = options.env
    this.#persisted = options.persisted
    this.#resolutionOverrides = options.resolutionOverrides ?? {}
    this.#runningConfig = options.runningConfig
  }

  static async open(
    configDir: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<ServerConfigStore> {
    const persisted = await loadPersistedServerConfig(configDir)
    const runningConfig = loadServerConfig(env, {}, persisted)
    return new ServerConfigStore({ configDir, env, persisted, runningConfig })
  }

  static fromResolved(
    configDir: string,
    runningConfig: CypheriaServerConfig,
    env: NodeJS.ProcessEnv = {}
  ): ServerConfigStore {
    const persisted: PersistedServerConfig = {
      server: {
        cors: { allowedOrigins: runningConfig.allowedOrigins },
        limits: { maxMessageBytes: runningConfig.maxMessageBytes },
        listen: { host: runningConfig.host, port: runningConfig.port },
        relay: {
          enabled: runningConfig.relayEnabled,
          ...(runningConfig.relayEndpoint ? { endpoint: runningConfig.relayEndpoint } : {}),
          ...(runningConfig.relayPublicEndpoint
            ? { publicEndpoint: runningConfig.relayPublicEndpoint }
            : {}),
          publicUseTls: runningConfig.relayPublicUseTls,
          useTls: runningConfig.relayUseTls,
        },
        sessions: {
          helloTimeoutMs: runningConfig.sessionHelloTimeoutMs,
          reconnectGraceMs: runningConfig.sessionReconnectGraceMs,
        },
        shutdownTimeoutMs: runningConfig.shutdownTimeoutMs,
        webApp: { directory: runningConfig.webAppDir, enabled: runningConfig.webAppEnabled },
      },
      version: 1,
    }
    return new ServerConfigStore({
      configDir,
      env,
      persisted,
      resolutionOverrides: { authToken: runningConfig.authToken },
      runningConfig,
    })
  }

  get effective(): CypheriaServerConfig {
    return this.#runningConfig
  }

  getSnapshot(): ServerConfigSnapshot {
    return {
      config: structuredClone(this.#persisted),
      overrideControlledPaths: [...this.#runningConfig.overrideControlledPaths],
      path: resolveServerConfigPath(this.#configDir),
      restartRequiredPaths: [...this.#restartRequiredPaths],
    }
  }

  async patch(patch: PersistedServerConfigPatch): Promise<ServerConfigSnapshot> {
    const next = applyPersistedServerConfigPatch(this.#persisted, patch)
    loadServerConfig(this.#env, this.#resolutionOverrides, next)
    await savePersistedServerConfig(this.#configDir, next)
    this.#persisted = next
    this.#refreshRestartRequiredPaths()
    return this.getSnapshot()
  }

  async reload(): Promise<ServerConfigSnapshot> {
    const next = await loadPersistedServerConfig(this.#configDir)
    loadServerConfig(this.#env, this.#resolutionOverrides, next)
    this.#persisted = next
    this.#refreshRestartRequiredPaths()
    return this.getSnapshot()
  }

  #refreshRestartRequiredPaths(): void {
    const desired = loadServerConfig(this.#env, this.#resolutionOverrides, this.#persisted)
    const overridden = new Set(this.#runningConfig.overrideControlledPaths)
    this.#restartRequiredPaths = EFFECTIVE_CONFIG_PATHS.flatMap(([path, key]) =>
      overridden.has(path) || same(this.#runningConfig[key], desired[key]) ? [] : [path]
    )
  }
}
