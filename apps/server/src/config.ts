import { fileURLToPath } from "node:url"
import type { PersistedServerConfig } from "@cypheria/protocol"
import { z } from "zod"

import { DEFAULT_PERSISTED_SERVER_CONFIG } from "./persisted-config.js"

const PortSchema = z.coerce.number().int().min(0).max(65_535)

const AuthTokenSchema = z
  .string()
  .trim()
  .min(16, "CYPHERIA_SERVER_TOKEN must contain at least 16 characters")
  .max(256)
  .regex(
    /^[A-Za-z0-9._~-]+$/,
    "CYPHERIA_SERVER_TOKEN may only contain WebSocket subprotocol-safe characters"
  )

export const CypheriaServerConfigSchema = z
  .object({
    allowedOrigins: z.array(
      z
        .string()
        .url()
        .transform((value) => new URL(value).origin)
    ),
    authToken: AuthTokenSchema.optional(),
    host: z.string().trim().min(1),
    maxMessageBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    port: PortSchema,
    relayEnabled: z.boolean(),
    relayEndpoint: z.string().trim().min(1).max(2048).optional(),
    relayPublicEndpoint: z.string().trim().min(1).max(2048).optional(),
    relayPublicUseTls: z.boolean(),
    relayUseTls: z.boolean(),
    sessionHelloTimeoutMs: z.number().int().positive().max(60_000),
    sessionReconnectGraceMs: z
      .number()
      .int()
      .nonnegative()
      .max(5 * 60_000),
    shutdownTimeoutMs: z.number().int().positive().max(120_000),
    overrideControlledPaths: z.array(z.string()),
    webAppDir: z.string().min(1),
    webAppEnabled: z.boolean(),
  })
  .superRefine((config, context) => {
    if (!["127.0.0.1", "::1", "localhost"].includes(config.host) && !config.authToken) {
      context.addIssue({
        code: "custom",
        message: "CYPHERIA_SERVER_TOKEN is required when binding outside loopback",
        path: ["authToken"],
      })
    }
    if (config.relayEnabled && !config.relayEndpoint) {
      context.addIssue({
        code: "custom",
        message: "CYPHERIA_SERVER_RELAY_ENDPOINT is required when relay is enabled",
        path: ["relayEndpoint"],
      })
    }
  })

export type CypheriaServerConfig = z.infer<typeof CypheriaServerConfigSchema>
export type CypheriaServerConfigOverrides = Partial<CypheriaServerConfig>

const splitList = (value: string | undefined): string[] =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? []

const readPositiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  return z.coerce.number().int().positive().parse(value)
}

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  throw new Error(`Invalid boolean environment value: ${value}`)
}

export function resolveBundledWebAppDirectory(moduleUrl = import.meta.url): string {
  return fileURLToPath(new URL("./web/", moduleUrl))
}

export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: CypheriaServerConfigOverrides = {},
  persisted: PersistedServerConfig = DEFAULT_PERSISTED_SERVER_CONFIG
): CypheriaServerConfig {
  const configured = persisted.server
  const overrideControlledPaths: string[] = []
  const fromEnvironment = <T>(
    name: string,
    path: string,
    parse: (value: string) => T
  ): T | undefined => {
    const raw = env[name]
    if (raw === undefined || raw.trim() === "") return undefined
    overrideControlledPaths.push(path)
    return parse(raw)
  }
  const environmentRelayUseTls = fromEnvironment(
    "CYPHERIA_SERVER_RELAY_USE_TLS",
    "server.relay.useTls",
    (value) => readBoolean(value, configured.relay.useTls)
  )
  const input = {
    allowedOrigins:
      fromEnvironment("CYPHERIA_SERVER_ALLOWED_ORIGINS", "server.cors.allowedOrigins", (value) =>
        splitList(value)
      ) ?? configured.cors.allowedOrigins,
    authToken: env.CYPHERIA_SERVER_TOKEN?.trim() || undefined,
    host:
      fromEnvironment("CYPHERIA_SERVER_HOST", "server.listen.host", (value) => value.trim()) ??
      configured.listen.host,
    maxMessageBytes:
      fromEnvironment(
        "CYPHERIA_SERVER_MAX_MESSAGE_BYTES",
        "server.limits.maxMessageBytes",
        (value) => readPositiveInteger(value, configured.limits.maxMessageBytes)
      ) ?? configured.limits.maxMessageBytes,
    port:
      fromEnvironment("CYPHERIA_SERVER_PORT", "server.listen.port", (value) =>
        z.coerce.number().int().min(0).max(65_535).parse(value)
      ) ?? configured.listen.port,
    relayEnabled:
      fromEnvironment("CYPHERIA_SERVER_RELAY_ENABLED", "server.relay.enabled", (value) =>
        readBoolean(value, configured.relay.enabled)
      ) ?? configured.relay.enabled,
    relayEndpoint:
      fromEnvironment("CYPHERIA_SERVER_RELAY_ENDPOINT", "server.relay.endpoint", (value) =>
        value.trim()
      ) ?? configured.relay.endpoint,
    relayPublicEndpoint:
      fromEnvironment(
        "CYPHERIA_SERVER_RELAY_PUBLIC_ENDPOINT",
        "server.relay.publicEndpoint",
        (value) => value.trim()
      ) ??
      configured.relay.publicEndpoint ??
      configured.relay.endpoint,
    relayPublicUseTls:
      fromEnvironment(
        "CYPHERIA_SERVER_RELAY_PUBLIC_USE_TLS",
        "server.relay.publicUseTls",
        (value) => readBoolean(value, environmentRelayUseTls ?? configured.relay.publicUseTls)
      ) ??
      environmentRelayUseTls ??
      configured.relay.publicUseTls,
    relayUseTls: environmentRelayUseTls ?? configured.relay.useTls,
    sessionHelloTimeoutMs:
      fromEnvironment(
        "CYPHERIA_SERVER_HELLO_TIMEOUT_MS",
        "server.sessions.helloTimeoutMs",
        (value) => readPositiveInteger(value, configured.sessions.helloTimeoutMs)
      ) ?? configured.sessions.helloTimeoutMs,
    sessionReconnectGraceMs:
      fromEnvironment(
        "CYPHERIA_SERVER_RECONNECT_GRACE_MS",
        "server.sessions.reconnectGraceMs",
        (value) => z.coerce.number().int().nonnegative().parse(value)
      ) ?? configured.sessions.reconnectGraceMs,
    shutdownTimeoutMs:
      fromEnvironment("CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS", "server.shutdownTimeoutMs", (value) =>
        readPositiveInteger(value, configured.shutdownTimeoutMs)
      ) ?? configured.shutdownTimeoutMs,
    overrideControlledPaths,
    webAppDir:
      fromEnvironment("CYPHERIA_SERVER_WEB_DIR", "server.webApp.directory", (value) =>
        value.trim()
      ) ??
      configured.webApp.directory ??
      resolveBundledWebAppDirectory(import.meta.url),
    webAppEnabled:
      fromEnvironment("CYPHERIA_SERVER_WEB_ENABLED", "server.webApp.enabled", (value) =>
        readBoolean(value, configured.webApp.enabled)
      ) ?? configured.webApp.enabled,
    ...overrides,
  }
  input.relayPublicEndpoint ??= input.relayEndpoint
  return CypheriaServerConfigSchema.parse(input)
}
