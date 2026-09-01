import {
  applyDatabaseMigrations,
  createAuditLogService,
  createAutomationPersistenceService,
  createWalletProviderPersistenceService,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  type AutomationRuntimeService,
  type AutomationRuntimeServiceOptions,
  buildCodexEnvironment,
  buildRuntimePaths,
  CypheriaRuntime,
  type CypheriaRuntimeOptions,
  type CypheriaRuntimePaths,
  createAutomationRuntimeService,
  createEthereumProviderRuntimeService,
  createSolanaProviderRuntimeService,
  type EthereumProviderRuntimeServiceOptions,
  ensureRuntimeDirectories,
  type RuntimeHomeEnv,
  type SolanaProviderRuntimeServiceOptions,
} from "@cypheria/runtime"
import { createDappSessionManager, type DappSessionManager } from "@cypheria/wallet-provider"
import {
  type CodexAppServerContext,
  type StartCodexAppServerOptions,
  shutdownCodexAppServer,
  startCodexAppServer,
} from "./codex-app-server.js"

export type DesktopRuntimeContext = {
  readonly automation: AutomationRuntimeService
  readonly codexAppServer?: CodexAppServerContext
  readonly dappSessions: DappSessionManager
  readonly database: OpenDatabaseResult
  readonly paths: CypheriaRuntimePaths
  readonly codexEnv: RuntimeHomeEnv
  readonly runtime: CypheriaRuntime
}

export type DesktopRuntimeOptions = CypheriaRuntimeOptions & {
  readonly automation?: Omit<AutomationRuntimeServiceOptions, "audit" | "persistence">
  readonly codexAppServer?: Omit<StartCodexAppServerOptions, "clientVersion" | "codexEnv" | "paths">
  readonly clientVersion?: string
  readonly ethereumProvider?: Omit<
    EthereumProviderRuntimeServiceOptions,
    "audit" | "persistence" | "sessions"
  >
  readonly solanaProvider?: Omit<
    SolanaProviderRuntimeServiceOptions,
    "audit" | "persistence" | "sessions"
  >
  readonly startCodexAppServer?: boolean
}

export const initializeDesktopRuntime = async (
  options: DesktopRuntimeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const {
    automation: automationOptions,
    clientVersion,
    codexAppServer: codexAppServerOptions,
    ethereumProvider: ethereumProviderOptions,
    solanaProvider: solanaProviderOptions,
    startCodexAppServer: shouldStartCodexAppServerOption,
    ...runtimeOptions
  } = options
  const paths = buildRuntimePaths(runtimeOptions)
  await ensureRuntimeDirectories(paths)
  const database = openCypheriaDatabase({ dbDir: paths.dbDir })
  const codexEnv = buildCodexEnvironment(paths)
  const shouldStartCodexAppServer = shouldStartCodexAppServerOption ?? true
  let runtime: CypheriaRuntime | undefined
  let codexAppServer: CodexAppServerContext | undefined

  try {
    await applyDatabaseMigrations(database.client)
    const audit = createAuditLogService(database.db)
    const walletProviderPersistence = createWalletProviderPersistenceService(database.db)
    const dappSessions = createDappSessionManager({ persistence: walletProviderPersistence })
    const automation = createAutomationRuntimeService({
      ...automationOptions,
      audit,
      persistence: createAutomationPersistenceService(database.db),
    })
    const providerServices = [
      ...(ethereumProviderOptions
        ? [
            createEthereumProviderRuntimeService({
              ...ethereumProviderOptions,
              audit,
              persistence: walletProviderPersistence,
              sessions: dappSessions,
            }),
          ]
        : []),
      ...(solanaProviderOptions
        ? [
            createSolanaProviderRuntimeService({
              ...solanaProviderOptions,
              audit,
              persistence: walletProviderPersistence,
              sessions: dappSessions,
            }),
          ]
        : []),
    ]
    runtime = new CypheriaRuntime({
      ...runtimeOptions,
      ensureDirectories: false,
      services: [...(runtimeOptions.services ?? []), automation, ...providerServices],
    })
    await runtime.start()
    codexAppServer = shouldStartCodexAppServer
      ? await startCodexAppServer({
          ...codexAppServerOptions,
          clientVersion: clientVersion ?? "0.0.0",
          codexEnv,
          paths,
        })
      : undefined
    return {
      automation,
      codexAppServer,
      database,
      dappSessions,
      paths: runtime.paths,
      codexEnv,
      runtime,
    }
  } catch (error) {
    try {
      await runtime?.stop()
    } finally {
      database.close()
    }
    throw error
  }
}

export const shutdownDesktopRuntime = async (context: DesktopRuntimeContext): Promise<void> => {
  try {
    if (context.codexAppServer) {
      await shutdownCodexAppServer(context.codexAppServer)
    }
  } finally {
    try {
      await context.runtime.stop()
    } finally {
      context.database.close()
    }
  }
}
