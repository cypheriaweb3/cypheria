import { chmod, mkdir, open, readFile, rename } from "node:fs/promises"
import { resolve } from "node:path"

import {
  type AgentAdditionalSettings,
  type AgentId,
  type NetworkProxyDraft,
  type NetworkProxyListPatch,
  NetworkProxyListPatchSchema,
  type NetworkProxyListSnapshot,
  type NetworkProxySnapshot,
} from "@cypheria/protocol"
import { z } from "zod"

const fileName = "network-proxies.json"
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

const PersistedManualProxySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mode: z.literal("manual"),
    protocol: z.enum(["http", "https", "socks4", "socks5"]),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    bypass: z.array(z.string()),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .strict()
const PersistedProxySchema = z.discriminatedUnion("mode", [
  z.object({ id: z.string().min(1), name: z.string().min(1), mode: z.literal("system") }).strict(),
  z.object({ id: z.string().min(1), name: z.string().min(1), mode: z.literal("direct") }).strict(),
  PersistedManualProxySchema,
])
const PersistedNetworkProxyListSchema = z
  .object({
    version: z.literal(1),
    defaultProxyId: z.string().min(1).nullable(),
    proxies: z.record(z.string(), PersistedProxySchema),
  })
  .strict()
type PersistedNetworkProxyList = z.infer<typeof PersistedNetworkProxyListSchema>
type PersistedProxy = z.infer<typeof PersistedProxySchema>

const defaultList: PersistedNetworkProxyList = {
  version: 1,
  defaultProxyId: null,
  proxies: {},
}

const proxyUrl = (proxy: Extract<PersistedProxy, { mode: "manual" }>): string => {
  const host =
    proxy.host.includes(":") && !proxy.host.startsWith("[") ? `[${proxy.host}]` : proxy.host
  const url = new URL(`${proxy.protocol}://${host}:${proxy.port}`)
  if (proxy.username) url.username = proxy.username
  if (proxy.password) url.password = proxy.password
  return url.toString().replace(/\/$/u, "")
}

export class NetworkProxyStore {
  readonly #configDir: string
  #list: PersistedNetworkProxyList

  private constructor(configDir: string, list: PersistedNetworkProxyList) {
    this.#configDir = configDir
    this.#list = list
  }

  static async open(configDir: string): Promise<NetworkProxyStore> {
    const path = resolve(configDir, fileName)
    try {
      const list = PersistedNetworkProxyListSchema.parse(JSON.parse(await readFile(path, "utf8")))
      await chmod(path, 0o600)
      return new NetworkProxyStore(configDir, list)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new NetworkProxyStore(configDir, structuredClone(defaultList))
      }
      throw new Error(`Unable to load network proxy configuration: ${path}`, { cause: error })
    }
  }

  static empty(configDir: string): NetworkProxyStore {
    return new NetworkProxyStore(configDir, structuredClone(defaultList))
  }

  get path(): string {
    return resolve(this.#configDir, fileName)
  }

  has(id: string): boolean {
    return Object.hasOwn(this.#list.proxies, id)
  }

  snapshot(): NetworkProxyListSnapshot {
    return {
      version: 1,
      defaultProxyId: this.#list.defaultProxyId,
      proxies: Object.values(this.#list.proxies)
        .map((proxy): NetworkProxySnapshot => {
          if (proxy.mode !== "manual") return proxy
          const { password, ...publicProxy } = proxy
          return { ...publicProxy, passwordConfigured: Boolean(password) }
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    }
  }

  resolve(settings: AgentAdditionalSettings | undefined): PersistedProxy | null {
    const id = settings?.networkProxyId ?? this.#list.defaultProxyId
    if (id === null) return null
    const proxy = this.#list.proxies[id]
    if (!proxy) throw new Error(`Unknown network proxy: ${id}`)
    return proxy
  }

  environment(
    agentId: AgentId,
    settings: AgentAdditionalSettings | undefined,
    base: NodeJS.ProcessEnv
  ): NodeJS.ProcessEnv {
    void agentId
    const proxy = this.resolve(settings)
    return this.#environmentForProxy(proxy, base)
  }

  environmentForDraft(
    agentId: AgentId,
    draft: NetworkProxyDraft,
    base: NodeJS.ProcessEnv
  ): NodeJS.ProcessEnv {
    void agentId
    return this.#environmentForProxy(this.draftForTest(draft), base)
  }

  #environmentForProxy(proxy: PersistedProxy | null, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (!proxy || proxy.mode === "system") return { ...base }
    const environment = { ...base }
    for (const key of proxyEnvironmentKeys) delete environment[key]
    if (proxy.mode === "direct") return environment
    const url = proxyUrl(proxy)
    if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
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
    const bypass = [...new Set([...localBypassHosts, ...proxy.bypass])].join(",")
    environment.NO_PROXY = bypass
    environment.no_proxy = bypass
    return environment
  }

  async patch(input: NetworkProxyListPatch): Promise<NetworkProxyListSnapshot> {
    const patch = NetworkProxyListPatchSchema.parse(input)
    const proxies = { ...this.#list.proxies }
    for (const [id, draft] of Object.entries(patch.proxies ?? {})) {
      if (draft === null) {
        delete proxies[id]
        continue
      }
      if (draft.id !== id) throw new Error("Proxy map key must match the proxy id")
      if (draft.mode !== "manual") {
        proxies[id] = draft
        continue
      }
      const existing = proxies[id]
      const password =
        draft.password === null
          ? undefined
          : draft.password === undefined && existing?.mode === "manual"
            ? existing.password
            : draft.password
      const { password: _password, ...withoutPassword } = draft
      proxies[id] = { ...withoutPassword, ...(password ? { password } : {}) }
    }
    const defaultProxyId = Object.hasOwn(patch, "defaultProxyId")
      ? (patch.defaultProxyId ?? null)
      : this.#list.defaultProxyId
    if (defaultProxyId !== null && !proxies[defaultProxyId]) {
      throw new Error(`Default network proxy does not exist: ${defaultProxyId}`)
    }
    for (const [id, proxy] of Object.entries(proxies)) {
      if (proxy.id !== id) throw new Error("Proxy map key must match the proxy id")
    }
    const next = PersistedNetworkProxyListSchema.parse({ version: 1, defaultProxyId, proxies })
    await this.#save(next)
    this.#list = next
    return this.snapshot()
  }

  draftForTest(draft: NetworkProxyDraft): PersistedProxy {
    if (draft.mode !== "manual") return draft
    const existing = this.#list.proxies[draft.id]
    const password =
      draft.password === null
        ? undefined
        : draft.password === undefined && existing?.mode === "manual"
          ? existing.password
          : draft.password
    const { password: _password, ...withoutPassword } = draft
    return { ...withoutPassword, ...(password ? { password } : {}) }
  }

  async #save(list: PersistedNetworkProxyList): Promise<void> {
    await mkdir(this.#configDir, { mode: 0o700, recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.tmp`
    const file = await open(temporaryPath, "w", 0o600)
    try {
      await file.writeFile(`${JSON.stringify(list, undefined, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, this.path)
  }
}
