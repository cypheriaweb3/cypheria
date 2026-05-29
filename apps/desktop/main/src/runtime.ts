import {
  buildCodexEnvironment,
  CypheriaRuntime,
  type CypheriaRuntimeOptions,
  type CypheriaRuntimePaths,
  type RuntimeHomeEnv,
} from "@cypheria/runtime"

export type DesktopRuntimeContext = {
  readonly paths: CypheriaRuntimePaths
  readonly codexEnv: RuntimeHomeEnv
  readonly runtime: CypheriaRuntime
}

export const initializeDesktopRuntime = async (
  options: CypheriaRuntimeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const runtime = new CypheriaRuntime(options)
  await runtime.start()

  return {
    paths: runtime.paths,
    codexEnv: buildCodexEnvironment(runtime.paths),
    runtime,
  }
}

export const shutdownDesktopRuntime = async (context: DesktopRuntimeContext): Promise<void> => {
  await context.runtime.stop()
}
