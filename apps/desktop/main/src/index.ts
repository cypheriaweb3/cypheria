import {
  buildCodexEnvironment,
  buildRuntimePaths,
  type CypheriaRuntimePaths,
  ensureRuntimeDirectories,
  type RuntimeHomeEnv,
  type RuntimeHomeOptions,
} from "@cypheria/runtime"

export type DesktopRuntimeContext = {
  readonly paths: CypheriaRuntimePaths
  readonly codexEnv: RuntimeHomeEnv
}

export const initializeDesktopRuntime = async (
  options: RuntimeHomeOptions = {}
): Promise<DesktopRuntimeContext> => {
  const paths = buildRuntimePaths(options)
  await ensureRuntimeDirectories(paths)

  return {
    paths,
    codexEnv: buildCodexEnvironment(paths),
  }
}
