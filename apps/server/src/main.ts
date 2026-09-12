import { buildRuntimePaths } from "@cypheria/runtime"

import { createServerProcessLogger } from "./logger.js"
import { isSupervisorMessage, type WorkerToSupervisorMessage } from "./process-messages.js"
import { CypheriaServer, type ServerLifecycleAction } from "./server.js"
import { ServerConfigStore } from "./server-config-store.js"

process.title = "Cypheria Server Worker"

const logger = createServerProcessLogger("cypheria-server-worker")
const send = (message: WorkerToSupervisorMessage): void => {
  if (process.send?.(message) === false) logger.warn("Unable to send supervisor message")
}

let server: CypheriaServer | undefined
let stopping = false
const supervisorPid = process.ppid
let lastSupervisorHeartbeatAt = Date.now()

async function stop(
  action: ServerLifecycleAction,
  reason = `Server ${action}`,
  failureExitCode?: number
): Promise<void> {
  if (stopping) return
  stopping = true
  try {
    await server?.stop(reason)
    process.exitCode = failureExitCode ?? (action === "restart" ? 75 : 0)
  } catch (error) {
    logger.error({ err: error }, "Failed to stop server cleanly")
    process.exitCode = 1
  } finally {
    if (process.connected) process.disconnect?.()
  }
}

process.on("message", (message) => {
  if (!isSupervisorMessage(message)) return
  if (message.type === "heartbeat") {
    lastSupervisorHeartbeatAt = Date.now()
    return
  }
  void stop(message.action, message.reason)
})
process.once("disconnect", () => {
  if (!stopping) process.exit(1)
})
process.once("SIGINT", () => void stop("shutdown", "SIGINT"))
process.once("SIGTERM", () => void stop("shutdown", "SIGTERM"))
process.once("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception")
  send({ message: error.message, type: "fatal" })
  void stop("shutdown", "Uncaught exception", 1)
})
process.once("unhandledRejection", (error) => {
  logger.fatal({ err: error }, "Unhandled rejection")
  send({ message: error instanceof Error ? error.message : String(error), type: "fatal" })
  void stop("shutdown", "Unhandled rejection", 1)
})

const heartbeat = setInterval(() => send({ timestamp: Date.now(), type: "heartbeat" }), 5_000)
heartbeat.unref()

if (typeof process.send === "function") {
  const supervisorGuard = setInterval(() => {
    const parentChanged = process.ppid !== supervisorPid
    const heartbeatExpired = Date.now() - lastSupervisorHeartbeatAt > 15_000
    if (!parentChanged && process.connected && !heartbeatExpired) return
    logger.fatal(
      { heartbeatExpired, parentChanged, supervisorPid },
      "Supervisor liveness lost; terminating worker"
    )
    process.exit(1)
  }, 1_000)
  supervisorGuard.unref()
}

try {
  const configStore = await ServerConfigStore.open(buildRuntimePaths().configDir)
  server = new CypheriaServer({
    configStore,
    logger,
    onLifecycleRequest: ({ action, reason }) => {
      if (process.send) send({ action, reason, type: "lifecycle" })
      else void stop(action, reason)
    },
  })
  const address = await server.start()
  send({ address, pid: process.pid, type: "ready" })
} catch (error) {
  logger.fatal({ err: error }, "Unable to start Cypheria server")
  send({ message: error instanceof Error ? error.message : String(error), type: "fatal" })
  process.exitCode = 1
}
