import type { ServerDiagnostics } from "@cypheria/protocol"
import type { CypheriaRuntimeLifecycleState } from "@cypheria/runtime"

export type ConnectionDiagnostics = ServerDiagnostics["connections"]

export const collectDiagnostics = (
  connections: ConnectionDiagnostics,
  runtimeState: CypheriaRuntimeLifecycleState
): ServerDiagnostics => ({
  collectedAt: new Date().toISOString(),
  connections,
  memory: process.memoryUsage(),
  process: {
    pid: process.pid,
    uptimeSeconds: process.uptime(),
  },
  runtimeState,
})
