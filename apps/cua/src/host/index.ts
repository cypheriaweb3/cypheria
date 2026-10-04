import type {
  AppBinding,
  AppInfo,
  CuaHostInfo,
  CuaImage,
  CuaObservation,
  CuaState,
  ExternalBrowserInfo,
  IabCommand,
  IabTabInfo,
  McpAppAction,
  McpAppInfo,
  ParsedCuaDeviceRequest,
  ParsedCuaRequest,
} from "../protocol.ts"
import { CuaRequestSchema } from "../protocol.ts"
import type { CuaSurface } from "../surfaces.ts"
import { CuaHostError } from "./errors.ts"

export { ComputerBackend, type ToolCaller } from "./computer/backend.ts"
export {
  CUA_DRIVER_QUIET_ENV,
  CuaDriverClient,
  type CuaDriverConnection,
  resolveCuaDriverBinary,
} from "./computer/cua-driver.ts"
export { CuaDevice, type CuaDeviceContext, type CuaDeviceOptions } from "./device.ts"
export { CuaHostError } from "./errors.ts"
export {
  type AgentBrowserRunner,
  createAgentBrowserRunner,
  resolveAgentBrowserBinary,
} from "./external/agent-browser.ts"
export { ExternalBrowsersBackend } from "./external/backend.ts"
export { browserInstallations, readDevToolsActivePort } from "./external/discovery.ts"

/** What a Thread's request is scoped to. */
export type CuaHostContext = { readonly threadId: string; readonly cwd?: string }

/** A connected device that registered as a Computer Use host. */
export type CuaHostEntry = {
  readonly id: string
  readonly name: string
  readonly surfaces: readonly CuaSurface[]
}

/**
 * The connected Computer Use hosts, which the Server tracks. Built-in browser tabs and MCP Apps
 * go through `DesktopSurfaces`; external browsers and native apps through `device`.
 */
export interface CuaHosts {
  list(): readonly CuaHostEntry[]
  /** Sends one request to the device; the device answers with its backend's result. */
  device(host: string, context: CuaHostContext, request: ParsedCuaDeviceRequest): Promise<unknown>
}

/**
 * Built-in browser tabs and the MCP Apps clients show. The Server implements it over its host
 * broker and its App instances.
 */
export interface DesktopSurfaces {
  listTabs(context: CuaHostContext): Promise<IabTabInfo[]>
  newTab(
    context: CuaHostContext,
    options: { url?: string; kind: "web" | "dapp"; host: string }
  ): Promise<IabTabInfo>
  command(
    context: CuaHostContext,
    tabId: string,
    command: IabCommand,
    args: Record<string, unknown>
  ): Promise<{ result: Record<string, unknown>; notice?: string }>
  listMcpApps(context: CuaHostContext): Promise<McpAppInfo[]>
  /** Acts on one App, on a host that shows it; `preferredHost` wins when it shows the App. */
  mcpApp(
    context: CuaHostContext,
    appId: string,
    action: McpAppAction,
    preferredHost: string | undefined
  ): Promise<{ text?: string; image?: CuaImage; notice?: string }>
}

export type CuaAuditEvent = {
  readonly threadId: string
  readonly op: string
  readonly target?: string
  readonly ok: boolean
  readonly error?: string
}

export type CuaHostOptions = {
  /** The surfaces settings allow right now; read on every request. */
  readonly surfaces: () => ReadonlySet<CuaSurface>
  readonly hosts?: CuaHosts
  readonly desktop?: DesktopSurfaces
  /**
   * The client that sent the Thread's current turn. A new tab or app opens on that device when
   * it can host one; resources that already exist stay on the device that has them.
   */
  readonly initiator?: (threadId: string) => string | undefined
  /** Records mutations, never page or app content. */
  readonly audit?: (event: CuaAuditEvent) => void
}

const SURFACE_OF: Record<string, CuaSurface | null> = {
  apps: "computer",
  browsers: "browsers",
  hosts: null,
  iab: "iab",
  mcpapps: "mcpapps",
  state: null,
}

const SURFACE_LABELS: Record<CuaSurface, string> = {
  browsers: "External browser control",
  computer: "Native app control",
  iab: "The built-in browser",
  mcpapps: "MCP App control",
}

const READ_ONLY = new Set([
  "state",
  "hosts",
  "apps.list",
  "apps.windows",
  "apps.observe",
  "iab.tabs",
  "browsers.list",
  "browsers.tabs",
  "mcpapps.list",
])

const READ_ONLY_ACTIONS = new Set([
  "snapshot",
  "screenshot",
  "get",
  "wait",
  "logs",
  "scan_qr",
  "extract_assets",
])

const describeHost = (host: CuaHostEntry) => `${host.id} (${host.name})`

/**
 * The privileged side of `cua_repl`. It validates each request from model code, enforces the
 * enabled surfaces, scopes everything to the calling Thread, and routes each request to the
 * connected device that holds its tab, App, browser, or window.
 */
export class CuaHost {
  readonly #options: CuaHostOptions
  /** The devices each Thread used, which hear about its turn ends and its closing. */
  readonly #used = new Map<string, Set<string>>()

  constructor(options: CuaHostOptions) {
    this.#options = options
  }

  async handle(input: unknown, context: CuaHostContext): Promise<unknown> {
    const parsed = CuaRequestSchema.safeParse(input)
    if (!parsed.success) {
      throw new CuaHostError(
        "invalid",
        `Invalid cua request: ${parsed.error.issues[0]?.message ?? "malformed"}`
      )
    }
    const request = parsed.data
    const surface = SURFACE_OF[request.op.split(".")[0] as string] ?? null
    if (surface && !this.#options.surfaces().has(surface)) {
      throw new CuaHostError(
        "disabled",
        `${SURFACE_LABELS[surface]} is disabled in Cypheria's Computer Use settings.`
      )
    }
    const mutation = !READ_ONLY.has(request.op) && !this.#readOnlyAction(request)
    try {
      const result = await this.#dispatch(request, context)
      if (mutation) this.#audit(request, context, true)
      return result
    } catch (error) {
      if (mutation) this.#audit(request, context, false, error)
      throw error
    }
  }

  /** Applies end-of-turn tab rules on every device the Thread used. */
  async turnEnded(context: CuaHostContext): Promise<void> {
    await Promise.all(
      [...(this.#used.get(context.threadId) ?? [])].map((host) =>
        this.#options.hosts
          ?.device(host, context, { op: "device.turnEnded" })
          .catch(() => undefined)
      )
    )
  }

  closeThread(threadId: string): void {
    const used = this.#used.get(threadId)
    this.#used.delete(threadId)
    for (const host of used ?? []) {
      void this.#options.hosts
        ?.device(host, { threadId }, { op: "device.closeThread" })
        .catch(() => undefined)
    }
  }

  #readOnlyAction(request: ParsedCuaRequest): boolean {
    if (request.op === "iab.command") return READ_ONLY_ACTIONS.has(request.command)
    if (request.op === "browsers.act" || request.op === "mcpapps.act") {
      return READ_ONLY_ACTIONS.has(request.action.type)
    }
    return false
  }

  #audit(request: ParsedCuaRequest, context: CuaHostContext, ok: boolean, error?: unknown): void {
    const target =
      "tabId" in request
        ? request.tabId
        : "appId" in request
          ? request.appId
          : "handle" in request
            ? `${request.handle.pid}:${request.handle.windowId}`
            : undefined
    const action =
      "action" in request
        ? `${request.op}:${request.action.type}`
        : "command" in request
          ? `${request.op}:${request.command}`
          : request.op
    const host = "host" in request ? request.host : undefined
    this.#options.audit?.({
      ok,
      op: action,
      threadId: context.threadId,
      ...(target || host ? { target: [host, target].filter(Boolean).join(" ") } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    })
  }

  #desktop(): DesktopSurfaces {
    if (!this.#options.desktop) {
      throw new CuaHostError("unavailable", "Cypheria Desktop is not connected.")
    }
    return this.#options.desktop
  }

  #hostList(): readonly CuaHostEntry[] {
    return this.#options.hosts?.list() ?? []
  }

  #hostInfo(context: CuaHostContext): CuaHostInfo[] {
    const initiator = this.#options.initiator?.(context.threadId)
    return this.#hostList().map((host) => ({
      current: host.id === initiator,
      id: host.id,
      name: host.name,
      surfaces: [...host.surfaces],
    }))
  }

  /**
   * The device a request for `surface` goes to: the one named, else the device the turn came
   * from, else the only device that offers the surface. Several candidates need a choice.
   */
  #resolve(context: CuaHostContext, surface: CuaSurface, requested: string | undefined): string {
    const all = this.#hostList()
    const label = SURFACE_LABELS[surface]
    if (requested) {
      const host = all.find((candidate) => candidate.id === requested)
      if (!host) {
        throw new CuaHostError(
          "unknown_host",
          `Device ${requested} is not connected. Connected devices: ${all.map(describeHost).join(", ") || "none"}.`
        )
      }
      if (!host.surfaces.includes(surface)) {
        throw new CuaHostError("unavailable", `${label} is unavailable on ${describeHost(host)}.`)
      }
      return host.id
    }
    const candidates = all.filter((host) => host.surfaces.includes(surface))
    const initiator = this.#options.initiator?.(context.threadId)
    const current = candidates.find((host) => host.id === initiator)
    if (current) return current.id
    if (candidates.length === 1 && candidates[0]) return candidates[0].id
    if (candidates.length === 0) {
      throw new CuaHostError(
        "unavailable",
        `${label} needs a connected Cypheria Desktop that offers it. Open Cypheria Desktop on the device to use.`
      )
    }
    throw new CuaHostError(
      "choose_host",
      `Several devices offer ${label.toLowerCase()}: ${candidates.map(describeHost).join(", ")}. Pass { host } with one of these IDs, or ask the person which device to use.`
    )
  }

  async #device(
    context: CuaHostContext,
    host: string,
    request: ParsedCuaDeviceRequest
  ): Promise<unknown> {
    if (!this.#options.hosts) {
      throw new CuaHostError("unavailable", "No Computer Use host is connected.")
    }
    let used = this.#used.get(context.threadId)
    if (!used) {
      used = new Set()
      this.#used.set(context.threadId, used)
    }
    used.add(host)
    return this.#options.hosts.device(host, context, request)
  }

  async #dispatch(request: ParsedCuaRequest, context: CuaHostContext): Promise<unknown> {
    switch (request.op) {
      case "state":
        return this.#state(context)
      case "hosts":
        return this.#hostInfo(context)
      case "apps.list":
      case "apps.windows":
        return this.#device(context, this.#resolve(context, "computer", request.host), request)
      case "apps.get": {
        const host = this.#resolve(context, "computer", request.host)
        const opened = (await this.#device(context, host, request)) as {
          binding: AppBinding
          observation: CuaObservation
        }
        return { ...opened, host }
      }
      case "apps.observe":
      case "apps.act":
        return this.#device(context, this.#resolve(context, "computer", request.host), request)
      case "iab.tabs":
        return this.#desktop().listTabs(context)
      case "iab.new":
        return this.#desktop().newTab(context, {
          host: this.#resolve(context, "iab", request.host),
          kind: request.kind ?? "web",
          ...(request.url ? { url: request.url } : {}),
        })
      case "iab.command":
        return this.#desktop().command(context, request.tabId, request.command, request.args)
      case "browsers.list": {
        const host = this.#resolve(context, "browsers", request.host)
        const browsers = (await this.#device(context, host, request)) as ExternalBrowserInfo[]
        return browsers.map((browser) => ({ ...browser, host }))
      }
      case "browsers.tabs":
      case "browsers.new":
      case "browsers.claim":
      case "browsers.act":
        return this.#device(context, this.#resolve(context, "browsers", request.host), request)
      case "mcpapps.list":
        return this.#desktop().listMcpApps(context)
      case "mcpapps.act":
        return this.#desktop().mcpApp(
          context,
          request.appId,
          request.action,
          this.#options.initiator?.(context.threadId)
        )
    }
  }

  async #state(context: CuaHostContext): Promise<CuaState> {
    const surfaces = this.#options.surfaces()
    const errors: string[] = []
    const attempt = async <T>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run()
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }
    const resolve = (surface: CuaSurface) => {
      try {
        return this.#resolve(context, surface, undefined)
      } catch (error) {
        errors.push(
          `${SURFACE_LABELS[surface]}: ${error instanceof Error ? error.message : String(error)}`
        )
        return undefined
      }
    }
    const computerHost = surfaces.has("computer") ? resolve("computer") : undefined
    const browsersHost = surfaces.has("browsers") ? resolve("browsers") : undefined
    const [apps, iab, browsers, mcpApps] = await Promise.all([
      computerHost
        ? attempt("Native apps", async () =>
            ((await this.#device(context, computerHost, { op: "apps.list" })) as AppInfo[]).filter(
              (app) => app.running
            )
          )
        : undefined,
      surfaces.has("iab")
        ? attempt("Built-in browser", () => this.#desktop().listTabs(context))
        : undefined,
      browsersHost
        ? attempt("External browsers", async () => {
            const list = (await this.#device(context, browsersHost, {
              op: "browsers.list",
            })) as ExternalBrowserInfo[]
            return Promise.all(
              list.map(async (browser) => {
                const hosted = { ...browser, host: browsersHost }
                if (!browser.connectable) return hosted
                const tabs = await this.#device(context, browsersHost, {
                  browserId: browser.id,
                  host: browsersHost,
                  op: "browsers.tabs",
                }).catch(() => [])
                return { ...hosted, tabs: tabs as never }
              })
            )
          })
        : undefined,
      surfaces.has("mcpapps")
        ? attempt("MCP Apps", () => this.#desktop().listMcpApps(context))
        : undefined,
    ])
    const host = computerHost ?? browsersHost
    return {
      hosts: this.#hostInfo(context),
      ...(host ? { host } : {}),
      ...(apps ? { apps } : {}),
      ...(iab ? { iab } : {}),
      ...(browsers ? { browsers } : {}),
      ...(mcpApps ? { mcpApps } : {}),
      ...(errors.length > 0 ? { errors } : {}),
    }
  }
}
