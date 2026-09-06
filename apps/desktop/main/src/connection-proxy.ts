import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ConnectionProxySettings, ConnectionProxyTestResult } from "../../ipc/src/index.js"
import { ConnectionProxySettingsSchema } from "../../ipc/src/index.js"

const configFileName = "proxy.json"
const openAiModelsUrl = "https://api.openai.com/v1/models"
const proxyEnvironmentKeys = [
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const
const localBypassHosts = ["localhost", "127.0.0.1", "::1"]

export const defaultConnectionProxySettings: ConnectionProxySettings = { mode: "system" }

export const getConnectionProxyConfigPath = (configDir: string): string =>
  join(configDir, configFileName)

export const readConnectionProxySettings = async (
  configDir: string
): Promise<ConnectionProxySettings> => {
  try {
    const contents = await readFile(getConnectionProxyConfigPath(configDir), "utf8")
    return ConnectionProxySettingsSchema.parse(JSON.parse(contents))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConnectionProxySettings
    }
    throw error
  }
}

export const writeConnectionProxySettings = async (
  configDir: string,
  settings: ConnectionProxySettings
): Promise<ConnectionProxySettings> => {
  const parsed = ConnectionProxySettingsSchema.parse(settings)
  const path = getConnectionProxyConfigPath(configDir)
  const temporaryPath = `${path}.tmp`
  await mkdir(configDir, { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rename(temporaryPath, path)
  return parsed
}

const formatProxyHost = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host

export const toConnectionProxyUrl = (
  settings: Extract<ConnectionProxySettings, { mode: "manual" }>,
  includeCredentials = true
): string => {
  const url = new URL(
    `${settings.protocol}://${formatProxyHost(settings.host.trim())}:${settings.port}`
  )
  if (includeCredentials) {
    url.username = settings.username
    url.password = settings.password
  }
  return url.toString().replace(/\/$/u, "")
}

const bypassHosts = (settings: Extract<ConnectionProxySettings, { mode: "manual" }>): string[] => {
  const configured = settings.bypass
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set([...localBypassHosts, ...configured])]
}

export const buildConnectionProxyEnvironment = (
  baseEnvironment: NodeJS.ProcessEnv,
  settings: ConnectionProxySettings
): NodeJS.ProcessEnv => {
  const environment = { ...baseEnvironment }
  for (const key of proxyEnvironmentKeys) {
    delete environment[key]
  }
  if (settings.mode !== "manual") return environment

  const proxyUrl = toConnectionProxyUrl(settings)
  const noProxy = bypassHosts(settings).join(",")
  if (settings.protocol === "socks5") {
    environment.ALL_PROXY = proxyUrl
    environment.all_proxy = proxyUrl
  } else {
    environment.HTTP_PROXY = proxyUrl
    environment.HTTPS_PROXY = proxyUrl
    environment.ALL_PROXY = proxyUrl
    environment.http_proxy = proxyUrl
    environment.https_proxy = proxyUrl
    environment.all_proxy = proxyUrl
  }
  environment.NO_PROXY = noProxy
  environment.no_proxy = noProxy
  return environment
}

export type ProxySession = {
  fetch(input: string, init?: RequestInit): Promise<Response>
  setProxy(config: {
    bypassRules?: string
    mode: "direct" | "fixed_servers" | "system"
    proxyRules?: string
  }): Promise<void>
}

export const applyConnectionProxyToSession = async (
  proxySession: ProxySession,
  settings: ConnectionProxySettings
): Promise<void> => {
  if (settings.mode === "system") {
    await proxySession.setProxy({ mode: "system" })
    return
  }
  if (settings.mode === "direct") {
    await proxySession.setProxy({ mode: "direct" })
    return
  }
  await proxySession.setProxy({
    bypassRules: bypassHosts(settings).join(","),
    mode: "fixed_servers",
    proxyRules: toConnectionProxyUrl(settings, false),
  })
}

const readResponseError = async (response: Response): Promise<string | undefined> => {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message.trim() || undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

export const testConnectionProxy = async (
  proxySession: ProxySession,
  settings: ConnectionProxySettings
): Promise<ConnectionProxyTestResult> => {
  const startedAt = performance.now()
  try {
    await applyConnectionProxyToSession(proxySession, settings)
    const response = await proxySession.fetch(openAiModelsUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    })
    const latencyMs = Math.round(performance.now() - startedAt)
    const detail = await readResponseError(response)
    const requestId = response.headers.get("x-request-id")
    const reachedOpenAi = response.status === 401
    return {
      latencyMs,
      message: reachedOpenAi
        ? "Connected to OpenAI successfully."
        : [
            detail ?? `OpenAI returned HTTP ${response.status}.`,
            requestId && `Request ID: ${requestId}`,
          ]
            .filter(Boolean)
            .join(" "),
      ok: reachedOpenAi,
      statusCode: response.status,
    }
  } catch (error) {
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "Connection timed out after 10 seconds."
          : error instanceof Error
            ? error.message
            : String(error),
      ok: false,
    }
  }
}
