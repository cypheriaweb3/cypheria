import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { buildRuntimePaths } from "@cypheria/runtime"
import pino, { type Logger } from "pino"

export function createServerProcessLogger(name: string): Logger {
  const paths = buildRuntimePaths()
  mkdirSync(paths.logsDir, { mode: 0o700, recursive: true })
  const file = pino.destination({ dest: resolve(paths.logsDir, "server.log"), mkdir: true })
  return pino({ name }, pino.multistream([{ stream: process.stdout }, { stream: file }]))
}
