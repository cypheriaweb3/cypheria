import { loadServerConfig } from "./config.js"
import { createServerProcessLogger } from "./logger.js"
import { isSupervisorMessage, type WorkerToSupervisorMessage } from "./process-messages.js"
import { CypheriaServer, type ServerLifecycleAction } from "./server.js"

const logger = createServerProcessLogger("cypheria-server-worker")
const send = (message: WorkerToSupervisorMessage): void => {
  if (process.send?.(message) === false) logger.warn("Unable to send supervisor message")
}

let stopping = false
const server = new CypheriaServer({
  config: loadServerConfig(),
  logger,
  onLifecycleRequest: ({ action, reason }) => {
    if (process.send) send({ action, reason, type: "lifecycle" })
    else void stop(action, reason)
  },
})

async function stop(
  action: ServerLifecycleAction,
  reason = `Server ${action}`,
  failureExitCode?: number
): Promise<void> {
  if (stopping) return
  stopping = true
  try {
    await server.stop(reason)
    process.exitCode = failureExitCode ?? (action === "restart" ? 75 : 0)
  } catch (error) {
    logger.error({ err: error }, "Failed to stop server cleanly")
    process.exitCode = 1
  } finally {
    if (process.connected) process.disconnect?.()
  }
}

process.on("message", (message) => {
  if (isSupervisorMessage(message)) void stop(message.action, message.reason)
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

try {
  const address = await server.start()
  send({ address, pid: process.pid, type: "ready" })
} catch (error) {
  logger.fatal({ err: error }, "Unable to start Cypheria server")
  send({ message: error instanceof Error ? error.message : String(error), type: "fatal" })
  process.exitCode = 1
}
