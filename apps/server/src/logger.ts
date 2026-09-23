import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import { PersistedServerConfigSchema } from "@cypheria/protocol"
import pino, { type Logger } from "pino"
import { createStream } from "rotating-file-stream"
import { loadServerConfig } from "./config.js"
import { DEFAULT_PERSISTED_SERVER_CONFIG, resolveServerConfigPath } from "./persisted-config.js"
import { buildRuntimePaths } from "./runtime/index.js"

const sensitivePaths = [
  "authorization",
  "headers.authorization",
  "headers.Authorization",
  "req.headers.authorization",
  "req.headers.Authorization",
  "token",
  "apiKey",
  "password",
]

const persistedLogging = (configDir: string) => {
  try {
    return PersistedServerConfigSchema.parse(
      JSON.parse(readFileSync(resolveServerConfigPath(configDir), "utf8"))
    )
  } catch {
    // The normal config loader reports invalid files during Server startup.
    return DEFAULT_PERSISTED_SERVER_CONFIG
  }
}

export function createServerProcessLogger(name: string): Logger {
  const paths = buildRuntimePaths()
  const config = loadServerConfig(process.env, {}, persistedLogging(paths.configDir))
  const configuredPath = config.logFilePath ?? resolve(paths.logsDir, "server.log")
  const basePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(paths.cypheriaHome, configuredPath)
  const logPath =
    name === "cypheria-server-supervisor"
      ? basePath.replace(/(\.log)?$/u, "-supervisor.log")
      : basePath
  mkdirSync(dirname(logPath), { mode: 0o700, recursive: true })
  if (existsSync(logPath)) chmodSync(logPath, 0o600)
  const file = createStream(basename(logPath), {
    maxFiles: config.logRotateCount,
    mode: 0o600,
    path: dirname(logPath),
    size: `${config.logRotateSizeMb}M`,
  })
  file.on("error", (error) => {
    console.error(`Unable to write ${name} log: ${error.message}`)
  })
  const levels = pino.levels.values
  const consolePriority = levels[config.logLevel] ?? 30
  const filePriority = levels[config.logFileLevel] ?? 30
  const level = consolePriority < filePriority ? config.logLevel : config.logFileLevel
  return pino(
    { level, name, redact: { paths: sensitivePaths, remove: true } },
    pino.multistream([
      { level: config.logLevel, stream: process.stdout },
      { level: config.logFileLevel, stream: file },
    ])
  )
}
