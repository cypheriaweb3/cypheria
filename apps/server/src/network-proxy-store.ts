import { chmod, mkdir, open, readFile, rename } from "node:fs/promises"
import { resolve } from "node:path"

import {
  type NetworkProxySettings,
  NetworkProxySettingsSchema,
  type NetworkProxySnapshot,
} from "@cypheria/protocol"
import { z } from "zod"

const fileName = "network-proxy.json"
const localBypassHosts = ["localhost", "127.0.0.1", "::1"]
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

const PersistedNetworkProxySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("system") }).strict(),
  z.object({ mode: z.literal("direct") }).strict(),
  z
    .object({
      mode: z.literal("manual"),
      protocol: z.enum(["http", "https", "socks4", "socks5"]),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      bypass: z.array(z.string()),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .strict(),
])
type PersistedNetworkProxy = z.infer<typeof PersistedNetworkProxySchema>

const defaultSettings: PersistedNetworkProxy = { mode: "system" }

const proxyUrl = (proxy: Extract<PersistedNetworkProxy, { mode: "manual" }>): string => {
  const host =
    proxy.host.includes(":") && !proxy.host.startsWith("[") ? `[${proxy.host}]` : proxy.host
  const url = new URL(`${proxy.protocol}://${host}:${proxy.port}`)
  if (proxy.username) url.username = proxy.username
  if (proxy.password) url.password = proxy.password
  return url.toString().replace(/\/$/u, "")
}

export class NetworkProxyStore {
  readonly #configDir: string
  #settings: PersistedNetworkProxy

  private constructor(configDir: string, settings: PersistedNetworkProxy) {
    this.#configDir = configDir
    this.#settings = settings
  }

  static async open(configDir: string): Promise<NetworkProxyStore> {
    const path = resolve(configDir, fileName)
    try {
      const settings = PersistedNetworkProxySchema.parse(JSON.parse(await readFile(path, "utf8")))
      await chmod(path, 0o600)
      return new NetworkProxyStore(configDir, settings)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new NetworkProxyStore(configDir, structuredClone(defaultSettings))
      }
      throw new Error(`Unable to load network proxy configuration: ${path}`, { cause: error })
    }
  }

  static empty(configDir: string): NetworkProxyStore {
    return new NetworkProxyStore(configDir, structuredClone(defaultSettings))
  }

  get path(): string {
    return resolve(this.#configDir, fileName)
  }

  snapshot(): NetworkProxySnapshot {
    if (this.#settings.mode !== "manual") return this.#settings
    const { password, ...settings } = this.#settings
    return { ...settings, passwordConfigured: Boolean(password) }
  }

  environment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return this.#environmentFor(this.#settings, base)
  }

  environmentForSettings(input: NetworkProxySettings, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return this.#environmentFor(this.#resolvePassword(input), base)
  }

  #environmentFor(settings: PersistedNetworkProxy, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (settings.mode === "system") return { ...base }
    const environment = { ...base }
    for (const key of proxyEnvironmentKeys) delete environment[key]
    if (settings.mode === "direct") return environment
    const url = proxyUrl(settings)
    if (settings.protocol === "socks4" || settings.protocol === "socks5") {
      environment.ALL_PROXY = url
      environment.all_proxy = url
    } else {
      environment.ALL_PROXY = url
      environment.HTTP_PROXY = url
      environment.HTTPS_PROXY = url
      environment.all_proxy = url
      environment.http_proxy = url
      environment.https_proxy = url
    }
    const bypass = [...new Set([...localBypassHosts, ...settings.bypass])].join(",")
    environment.NO_PROXY = bypass
    environment.no_proxy = bypass
    return environment
  }

  async set(input: NetworkProxySettings): Promise<NetworkProxySnapshot> {
    const settings = this.#resolvePassword(NetworkProxySettingsSchema.parse(input))
    await this.#save(settings)
    this.#settings = settings
    return this.snapshot()
  }

  #resolvePassword(input: NetworkProxySettings): PersistedNetworkProxy {
    if (input.mode !== "manual") return input
    const password =
      input.password === null
        ? undefined
        : input.password === undefined && this.#settings.mode === "manual"
          ? this.#settings.password
          : input.password
    const { password: _password, ...settings } = input
    return PersistedNetworkProxySchema.parse({
      ...settings,
      ...(password ? { password } : {}),
    })
  }

  async #save(settings: PersistedNetworkProxy): Promise<void> {
    await mkdir(this.#configDir, { mode: 0o700, recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.tmp`
    const file = await open(temporaryPath, "w", 0o600)
    try {
      await file.writeFile(`${JSON.stringify(settings, undefined, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, this.path)
  }
}
