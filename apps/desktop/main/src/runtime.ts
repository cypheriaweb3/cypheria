import {
  applyDatabaseMigrations,
  createAuditLogService,
  createAutomationPersistenceService,
  createDappBrowserPersistenceService,
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
  ensureRuntimeDirectories,
  type RuntimeHomeEnv,
} from "@cypheria/runtime"
import { createDappSessionManager, type DappSessionManager } from "@cypheria/web3-browser"
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
  readonly startCodexAppServer?: boolean
}

export const initializeDesktopRuntime = async (
  options: DesktopRuntimeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const {
    automation: automationOptions,
    clientVersion,
    codexAppServer: codexAppServerOptions,
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
    const automation = createAutomationRuntimeService({
      ...automationOptions,
      audit: createAuditLogService(database.db),
      persistence: createAutomationPersistenceService(database.db),
    })
    runtime = new CypheriaRuntime({
      ...runtimeOptions,
      ensureDirectories: false,
      services: [...(runtimeOptions.services ?? []), automation],
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
      dappSessions: createDappSessionManager({
        persistence: createDappBrowserPersistenceService(database.db),
      }),
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
