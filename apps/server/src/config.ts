import { fileURLToPath } from "node:url"
import { z } from "zod"

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
    shutdownTimeoutMs: z.number().int().positive().max(120_000),
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
  overrides: CypheriaServerConfigOverrides = {}
): CypheriaServerConfig {
  const input = {
    allowedOrigins: splitList(env.CYPHERIA_SERVER_ALLOWED_ORIGINS),
    authToken: env.CYPHERIA_SERVER_TOKEN?.trim() || undefined,
    host: env.CYPHERIA_SERVER_HOST?.trim() || "127.0.0.1",
    maxMessageBytes: readPositiveInteger(env.CYPHERIA_SERVER_MAX_MESSAGE_BYTES, 1024 * 1024),
    port: env.CYPHERIA_SERVER_PORT ?? 6768,
    relayEnabled: readBoolean(env.CYPHERIA_SERVER_RELAY_ENABLED, false),
    relayEndpoint: env.CYPHERIA_SERVER_RELAY_ENDPOINT?.trim() || undefined,
    relayPublicEndpoint:
      env.CYPHERIA_SERVER_RELAY_PUBLIC_ENDPOINT?.trim() ||
      env.CYPHERIA_SERVER_RELAY_ENDPOINT?.trim() ||
      undefined,
    relayPublicUseTls: readBoolean(
      env.CYPHERIA_SERVER_RELAY_PUBLIC_USE_TLS,
      readBoolean(env.CYPHERIA_SERVER_RELAY_USE_TLS, true)
    ),
    relayUseTls: readBoolean(env.CYPHERIA_SERVER_RELAY_USE_TLS, true),
    sessionHelloTimeoutMs: readPositiveInteger(env.CYPHERIA_SERVER_HELLO_TIMEOUT_MS, 10_000),
    shutdownTimeoutMs: readPositiveInteger(env.CYPHERIA_SERVER_SHUTDOWN_TIMEOUT_MS, 10_000),
    webAppDir:
      env.CYPHERIA_SERVER_WEB_DIR?.trim() || resolveBundledWebAppDirectory(import.meta.url),
    webAppEnabled: readBoolean(env.CYPHERIA_SERVER_WEB_ENABLED, true),
    ...overrides,
  }
  input.relayPublicEndpoint ??= input.relayEndpoint
  return CypheriaServerConfigSchema.parse(input)
}
