import {
  createDappBrowserPersistenceService,
  ensureDatabaseSchema,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  buildCodexEnvironment,
  CypheriaRuntime,
  type CypheriaRuntimeOptions,
  type CypheriaRuntimePaths,
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
  readonly codexAppServer?: CodexAppServerContext
  readonly dappSessions: DappSessionManager
  readonly database: OpenDatabaseResult
  readonly paths: CypheriaRuntimePaths
  readonly codexEnv: RuntimeHomeEnv
  readonly runtime: CypheriaRuntime
}

export type DesktopRuntimeOptions = CypheriaRuntimeOptions & {
  readonly codexAppServer?: Omit<StartCodexAppServerOptions, "clientVersion" | "codexEnv" | "paths">
  readonly clientVersion?: string
  readonly startCodexAppServer?: boolean
}

export const initializeDesktopRuntime = async (
  options: DesktopRuntimeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const runtime = new CypheriaRuntime(options)
  await runtime.start()
  const database = openCypheriaDatabase({ dbDir: runtime.paths.dbDir })
  const codexEnv = buildCodexEnvironment(runtime.paths)
  const shouldStartCodexAppServer = options.startCodexAppServer ?? true
  let codexAppServer: CodexAppServerContext | undefined

  try {
    await ensureDatabaseSchema(database.client)
    codexAppServer = shouldStartCodexAppServer
      ? await startCodexAppServer({
          ...options.codexAppServer,
          clientVersion: options.clientVersion ?? "0.0.0",
          codexEnv,
          paths: runtime.paths,
        })
      : undefined
  } catch (error) {
    database.close()
    await runtime.stop()
    throw error
  }

  return {
    codexAppServer,
    database,
    dappSessions: createDappSessionManager({
      persistence: createDappBrowserPersistenceService(database.db),
    }),
    paths: runtime.paths,
    codexEnv,
    runtime,
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
