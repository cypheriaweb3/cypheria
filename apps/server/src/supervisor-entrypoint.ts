import { fileURLToPath } from "node:url"

import { buildRuntimePaths } from "@cypheria/runtime"

import { createServerProcessLogger } from "./logger.js"
import { ServerPidLock } from "./pid-lock.js"
import { ServerSupervisor } from "./supervisor.js"

const logger = createServerProcessLogger("cypheria-server-supervisor")
const paths = buildRuntimePaths()
process.title = "Cypheria Server Supervisor"

try {
  const lock = await ServerPidLock.acquire(paths.configDir)
  const supervisor = new ServerSupervisor({
    logger,
    onReady: ({ address, pid }) => lock.updateWorker(pid, address),
    workerPath: fileURLToPath(new URL("./main.mjs", import.meta.url)),
  })
  const code = await supervisor.run()
  await lock.release()
  process.exitCode = code
} catch (error) {
  logger.fatal({ err: error }, "Cypheria server supervisor failed")
  process.exitCode = 1
}
