import { mkdir, open, readFile, rename } from "node:fs/promises"
import { resolve } from "node:path"

import {
  type PersistedServerConfig,
  type PersistedServerConfigPatch,
  PersistedServerConfigSchema,
} from "@cypheria/protocol"

export const CYPHERIA_SERVER_CONFIG_FILENAME = "server.json" as const

export const DEFAULT_PERSISTED_SERVER_CONFIG: PersistedServerConfig = {
  server: {
    cors: { allowedOrigins: [] },
    limits: { maxMessageBytes: 1024 * 1024 },
    listen: { host: "127.0.0.1", port: 6768 },
    relay: {
      enabled: false,
      publicUseTls: true,
      useTls: true,
    },
    sessions: {
      helloTimeoutMs: 10_000,
      reconnectGraceMs: 30_000,
    },
    shutdownTimeoutMs: 10_000,
    webApp: { enabled: true },
  },
  version: 1,
}

export const resolveServerConfigPath = (configDir: string): string =>
  resolve(configDir, CYPHERIA_SERVER_CONFIG_FILENAME)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const deepMerge = <T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown>
): T => {
  const next: Record<string, unknown> = { ...current }
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue
    const currentValue = next[key]
    next[key] =
      isRecord(currentValue) && isRecord(patchValue)
        ? deepMerge(currentValue, patchValue)
        : patchValue
  }
  return next as T
}

export const applyPersistedServerConfigPatch = (
  current: PersistedServerConfig,
  patch: PersistedServerConfigPatch
): PersistedServerConfig =>
  PersistedServerConfigSchema.parse(
    deepMerge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>)
  )

export async function loadPersistedServerConfig(configDir: string): Promise<PersistedServerConfig> {
  const path = resolveServerConfigPath(configDir)
  try {
    return PersistedServerConfigSchema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(DEFAULT_PERSISTED_SERVER_CONFIG)
    }
    throw new Error(`Unable to load Cypheria server config: ${path}`, { cause: error })
  }
}

export async function savePersistedServerConfig(
  configDir: string,
  config: PersistedServerConfig
): Promise<void> {
  const parsed = PersistedServerConfigSchema.parse(config)
  await mkdir(configDir, { mode: 0o700, recursive: true })
  const path = resolveServerConfigPath(configDir)
  const temporaryPath = `${path}.${process.pid}.tmp`
  const file = await open(temporaryPath, "w", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(parsed, undefined, 2)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporaryPath, path)
}
