import {
  buildCodexEnvironment,
  CypheriaRuntime,
  type CypheriaRuntimeOptions,
  type CypheriaRuntimePaths,
  type RuntimeHomeEnv,
} from "@cypheria/runtime"
import {
  type CodexAppServerContext,
  type StartCodexAppServerOptions,
  shutdownCodexAppServer,
  startCodexAppServer,
} from "./codex-app-server.js"

export type DesktopRuntimeContext = {
  readonly codexAppServer?: CodexAppServerContext
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
  const codexEnv = buildCodexEnvironment(runtime.paths)
  const shouldStartCodexAppServer = options.startCodexAppServer ?? true
  let codexAppServer: CodexAppServerContext | undefined

  try {
    codexAppServer = shouldStartCodexAppServer
      ? await startCodexAppServer({
          ...options.codexAppServer,
          clientVersion: options.clientVersion ?? "0.0.0",
          codexEnv,
          paths: runtime.paths,
        })
      : undefined
  } catch (error) {
    await runtime.stop()
    throw error
  }

  return {
    codexAppServer,
    paths: runtime.paths,
    codexEnv,
    runtime,
  }
}

export const shutdownDesktopRuntime = async (context: DesktopRuntimeContext): Promise<void> => {
  if (context.codexAppServer) {
    await shutdownCodexAppServer(context.codexAppServer)
  }
  await context.runtime.stop()
}
