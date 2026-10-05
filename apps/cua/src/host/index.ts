import { BROWSER_MEMBERS, type BrowserMember, supports } from "../browser/members.ts"
import { type BrowserHostCall, validateCall } from "../browser/protocol.ts"
import type {
  BrowserBackend,
  BrowserInfo,
  ChromeBrowserInfo,
  TabInfo,
  UserTabInfo,
} from "../browser/types.ts"
import type {
  AppBinding,
  AppInfo,
  BrowserState,
  CuaHostInfo,
  CuaObservation,
  CuaState,
  ParsedCuaDeviceRequest,
  ParsedCuaRequest,
} from "../protocol.ts"
import { CuaRequestSchema } from "../protocol.ts"
import type { CuaSurface, HostCapability } from "../surfaces.ts"
import { CuaHostError } from "./errors.ts"

export { CdpBrowser, CdpDrivers, type CdpDriversOptions } from "./chrome/cdp.ts"
export { browserInstallations, readDevToolsActivePort } from "./chrome/discovery.ts"
export type { ChromeDriver, DriverTab } from "./chrome/driver.ts"
export {
  CHROME_IMPLEMENTATION_TYPES,
  type ChromeDriverSource,
  type ChromeImplementationType,
  SelectedChromeDrivers,
} from "./chrome/selection.ts"
export {
  type ChromeLeaseState,
  type ChromeLeaseStore,
  ChromeSessions,
  type ChromeSessionsOptions,
} from "./chrome/sessions.ts"
export { ComputerBackend, type ToolCaller } from "./computer/backend.ts"
export {
  type AppApprovalDecision,
  type AppApprovalRequest,
  CodexComputerUseBackend,
  type CodexComputerUseOptions,
} from "./computer/codex.ts"
export {
  type CodexComputerUseDetection,
  codexComputerUseLaunch,
  detectCodexComputerUse,
  nativeCodexBinary,
} from "./computer/codex-discovery.ts"
export {
  CUA_DRIVER_QUIET_ENV,
  CuaDriverClient,
  type CuaDriverConnection,
  resolveCuaDriverBinary,
} from "./computer/cua-driver.ts"
export { type McpLaunch, McpStdioClient } from "./computer/mcp-stdio.ts"
export type { NativeAppsBackend } from "./computer/types.ts"
export { CuaDevice, type CuaDeviceContext, type CuaDeviceOptions } from "./device.ts"
export { CuaHostError } from "./errors.ts"

/** What a Thread's request is scoped to. */
export type CuaHostContext = { readonly threadId: string; readonly cwd?: string }

/** A connected device that registered as a Computer Use host. */
export type CuaHostEntry = {
  readonly id: string
  readonly name: string
  readonly capabilities: readonly HostCapability[]
}

/**
 * A tab the person may mention in the composer: one of the Thread's built-in browser tabs, or an
 * open tab of one of their own browsers.
 */
export type MentionableTab = {
  readonly source: "iab" | "chrome"
  /** The browser's ID as `agent.browsers.list()` shows it. */
  readonly browserId: string
  readonly browserName: string
  readonly profileName?: string
  readonly host?: string
  /** The browser's own tab ID, which the mention carries. */
  readonly tabId: string
  readonly title: string
  readonly url: string
}

/** The connected devices, which the Server tracks. */
export interface CuaHosts {
  list(): readonly CuaHostEntry[]
  /** Sends one request to the device; the device answers with its backend's result. */
  device(host: string, context: CuaHostContext, request: ParsedCuaDeviceRequest): Promise<unknown>
}

/**
 * The built-in browser and MCP Apps, which live in Desktop windows. The Server implements it
 * over its window broker, which knows which window holds each tab and shows each App.
 * `preferredHost` is the device that sent the current turn.
 */
export interface DesktopBrowsers {
  call(
    context: CuaHostContext,
    backend: "iab" | "mcpapps",
    call: BrowserHostCall,
    preferredHost: string | undefined
  ): Promise<unknown>
  /** Applies end-of-turn tab rules to the built-in browser tabs the Thread opened. */
  turnEnded?(context: CuaHostContext): Promise<void>
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
  /** The browser backends settings allow right now; read on every request. */
  readonly backends: () => ReadonlySet<BrowserBackend>
  /** `chrome` browser families settings block, such as `edge`; read on every request. */
  readonly blockedFamilies?: () => ReadonlySet<string>
  readonly hosts?: CuaHosts
  readonly desktop?: DesktopBrowsers
  /**
   * The client that sent the Thread's current turn. A new tab or app opens on that device when
   * it can host one; resources that already exist stay on the device that has them.
   */
  readonly initiator?: (threadId: string) => string | undefined
  /** Records mutations, never page or app content. */
  readonly audit?: (event: CuaAuditEvent) => void
}

/** Where a listed browser's calls go. */
type Route =
  | { readonly kind: "desktop"; readonly backend: "iab" | "mcpapps" }
  | { readonly kind: "device"; readonly host: string; readonly local: string }

type RoutedBrowser = BrowserInfo & { readonly route: Route }

const READ_ONLY = new Set([
  "state",
  "hosts",
  "apps.list",
  "apps.windows",
  "apps.observe",
  "apps.audio.read",
  "browsers.list",
])

const describeHost = (host: CuaHostEntry) => `${host.id} (${host.name})`

const BROWSER_DISABLED = "Browser control is disabled in Cypheria's Computer Use settings."
const COMPUTER_DISABLED = "Native app control is disabled in Cypheria's Computer Use settings."

/**
 * The privileged side of `cua_repl`. It validates each request from model code, enforces the
 * enabled surfaces and backends, scopes everything to the calling Thread, and routes each
 * request to the connected device or window that holds its browser, tab, App, or window.
 */
export class CuaHost {
  readonly #options: CuaHostOptions
  /** The devices each Thread used, which hear about its turn ends and its closing. */
  readonly #used = new Map<string, Set<string>>()
  /** The device each Thread's latest computer audio recording is on. */
  readonly #audio = new Map<string, string>()

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
    const surfaces = this.#options.surfaces()
    if (request.op.startsWith("apps.") && !surfaces.has("computer")) {
      throw new CuaHostError("disabled", COMPUTER_DISABLED)
    }
    if (request.op.startsWith("browser") && !surfaces.has("browser")) {
      throw new CuaHostError("disabled", BROWSER_DISABLED)
    }
    if (request.op === "browser.call") return this.#browserCall(request, context)
    const mutation = !READ_ONLY.has(request.op)
    try {
      const result = await this.#dispatch(request, context)
      if (mutation) this.#audit(request.op, context, true, this.#appTarget(request))
      return result
    } catch (error) {
      if (mutation) this.#audit(request.op, context, false, this.#appTarget(request), error)
      throw error
    }
  }

  /** Applies end-of-turn rules on every device the Thread used. */
  async turnEnded(context: CuaHostContext): Promise<void> {
    await Promise.all([
      this.#options.desktop?.turnEnded?.(context).catch(() => undefined),
      ...[...(this.#used.get(context.threadId) ?? [])].map((host) =>
        this.#options.hosts
          ?.device(host, context, { op: "device.turnEnded" })
          .catch(() => undefined)
      ),
    ])
  }

  /** The tabs the person may mention for a Thread, from every browser settings allow. */
  async mentionableTabs(context: CuaHostContext): Promise<MentionableTab[]> {
    if (!this.#options.surfaces().has("browser")) return []
    const { browsers } = await this.#browsers(context)
    const lists = await Promise.all(
      browsers.map(async (browser): Promise<MentionableTab[]> => {
        if (browser.type !== "iab" && browser.type !== "chrome") return []
        const tabs = (await this.#browserCall(
          {
            args: [],
            browser: browser.id,
            member: browser.type === "iab" ? "tabs.list" : "user.openTabs",
            op: "browser.call",
          },
          context
        ).catch(() => [])) as (TabInfo | UserTabInfo)[]
        return tabs.map((tab) => ({
          browserId: browser.id,
          browserName: browser.name,
          source: browser.type === "iab" ? "iab" : "chrome",
          tabId: tab.providerTabId ?? tab.id,
          title: tab.title ?? "",
          url: tab.url ?? "",
          ...(browser.host ? { host: browser.host } : {}),
          ...(browser.profileName ? { profileName: browser.profileName } : {}),
        }))
      })
    )
    return lists.flat()
  }

  closeThread(threadId: string): void {
    const used = this.#used.get(threadId)
    this.#used.delete(threadId)
    this.#audio.delete(threadId)
    for (const host of used ?? []) {
      void this.#options.hosts
        ?.device(host, { threadId }, { op: "device.closeThread" })
        .catch(() => undefined)
    }
  }

  #appTarget(request: ParsedCuaRequest): string | undefined {
    if (request.op === "apps.observe" || request.op === "apps.act") {
      return `${request.host} ${request.handle.pid}:${request.handle.windowId}`
    }
    return "host" in request && typeof request.host === "string" ? request.host : undefined
  }

  #audit(op: string, context: CuaHostContext, ok: boolean, target?: string, error?: unknown): void {
    this.#options.audit?.({
      ok,
      op,
      threadId: context.threadId,
      ...(target ? { target } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    })
  }

  #hostList(): readonly CuaHostEntry[] {
    return this.#options.hosts?.list() ?? []
  }

  #hostInfo(context: CuaHostContext): CuaHostInfo[] {
    const initiator = this.#options.initiator?.(context.threadId)
    return this.#hostList().map((host) => ({
      capabilities: [...host.capabilities],
      current: host.id === initiator,
      id: host.id,
      name: host.name,
    }))
  }

  /**
   * The device a native app request goes to: the one named, else the device the turn came from,
   * else the only device that offers native apps. Several candidates need a choice.
   */
  #resolveComputer(context: CuaHostContext, requested: string | undefined): string {
    const all = this.#hostList()
    if (requested) {
      const host = all.find((candidate) => candidate.id === requested)
      if (!host) {
        throw new CuaHostError(
          "unknown_host",
          `Device ${requested} is not connected. Connected devices: ${all.map(describeHost).join(", ") || "none"}.`
        )
      }
      if (!host.capabilities.includes("computer")) {
        throw new CuaHostError(
          "unavailable",
          `Native app control is unavailable on ${describeHost(host)}.`
        )
      }
      return host.id
    }
    const candidates = all.filter((host) => host.capabilities.includes("computer"))
    const initiator = this.#options.initiator?.(context.threadId)
    const current = candidates.find((host) => host.id === initiator)
    if (current) return current.id
    if (candidates.length === 1 && candidates[0]) return candidates[0].id
    if (candidates.length === 0) {
      throw new CuaHostError(
        "unavailable",
        "Native app control needs a connected Cypheria Desktop that offers it. Open Cypheria Desktop on the device to use."
      )
    }
    throw new CuaHostError(
      "choose_host",
      `Several devices offer native app control: ${candidates.map(describeHost).join(", ")}. Pass { host } with one of these IDs, or ask the person which device to use.`
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
      case "apps.launch":
        return this.#device(context, this.#resolveComputer(context, request.host), request)
      case "apps.get": {
        const host = this.#resolveComputer(context, request.host)
        const opened = (await this.#device(context, host, request)) as {
          binding: AppBinding
          observation: CuaObservation
        }
        return { ...opened, host }
      }
      case "apps.observe":
      case "apps.act":
        return this.#device(context, this.#resolveComputer(context, request.host), request)
      case "apps.audio.start": {
        const host = this.#resolveComputer(context, request.host)
        await this.#device(context, host, request)
        this.#audio.set(context.threadId, host)
        return null
      }
      case "apps.audio.stop":
      case "apps.audio.read": {
        // A recording stays on the device that made it.
        const host = request.host ?? this.#audio.get(context.threadId)
        if (!host) {
          throw new CuaHostError(
            "invalid",
            "No computer audio recording was started in this task; call cua.computer.start_audio_recording() first."
          )
        }
        return this.#device(context, this.#resolveComputer(context, host), request)
      }
      case "browsers.list":
        return (await this.#browsers(context)).browsers.map(({ route: _, ...info }) => info)
      case "browser.call":
        return this.#browserCall(request, context)
    }
  }

  /** Every browser the Thread may use, with unique IDs across devices. */
  async #browsers(
    context: CuaHostContext
  ): Promise<{ browsers: RoutedBrowser[]; errors: string[] }> {
    const backends = this.#options.backends()
    const hosts = this.#hostList()
    const browsers: RoutedBrowser[] = []
    const errors: string[] = []
    if (backends.has("iab") && hosts.some((host) => host.capabilities.includes("iab"))) {
      browsers.push({
        id: "iab",
        name: "Cypheria browser",
        route: { backend: "iab", kind: "desktop" },
        type: "iab",
      })
    }
    if (backends.has("mcpapps") && hosts.some((host) => host.capabilities.includes("mcpapps"))) {
      browsers.push({
        id: "mcpapps",
        name: "MCP Apps",
        route: { backend: "mcpapps", kind: "desktop" },
        type: "mcpapps",
      })
    }
    if (backends.has("chrome")) {
      const listed = await Promise.all(
        hosts
          .filter((host) => host.capabilities.includes("chrome"))
          .map(async (host) => {
            try {
              const infos = (await this.#device(context, host.id, {
                op: "browsers.list",
              })) as ChromeBrowserInfo[]
              return infos.map((info) => ({ host, info }))
            } catch (error) {
              errors.push(
                `Browsers on ${describeHost(host)}: ${error instanceof Error ? error.message : String(error)}`
              )
              return []
            }
          })
      )
      const blocked = this.#options.blockedFamilies?.() ?? new Set<string>()
      const flat = listed.flat().filter(({ info }) => !info.family || !blocked.has(info.family))
      const counts = new Map<string, number>()
      for (const { info } of flat) counts.set(info.id, (counts.get(info.id) ?? 0) + 1)
      for (const { host, info } of flat) {
        const id = (counts.get(info.id) ?? 0) > 1 ? `${info.id}@${host.id}` : info.id
        browsers.push({
          ...info,
          host: host.id,
          id,
          route: { host: host.id, kind: "device", local: info.id },
          type: "chrome",
        })
      }
    }
    return { browsers, errors }
  }

  /** Finds a browser by ID, family, or extension instance, preferring the current device. */
  async #resolveBrowser(context: CuaHostContext, requested: string): Promise<RoutedBrowser> {
    const { browsers } = await this.#browsers(context)
    const exact = browsers.find((browser) => browser.id === requested)
    if (exact) return exact
    const matches = browsers.filter(
      (browser) =>
        (browser.route.kind === "device" && browser.route.local === requested) ||
        browser.family === requested
    )
    const initiator = this.#options.initiator?.(context.threadId)
    const current = matches.filter((browser) => browser.host === initiator)
    let chosen = current.length > 0 ? current : matches
    // A family with several profiles open on one device means the profile used last.
    const lastUsed = chosen.filter((browser) => browser.lastUsed)
    if (chosen.length > 1 && lastUsed.length === 1) chosen = lastUsed
    if (chosen.length === 1 && chosen[0]) return chosen[0]
    const ids = browsers.map((browser) => browser.id).join(", ") || "none"
    if (chosen.length === 0) {
      throw new CuaHostError(
        "unknown_browser",
        `No browser ${requested} is available. Available browsers: ${ids}.`
      )
    }
    throw new CuaHostError(
      "choose_browser",
      `Several browsers match ${requested}: ${chosen.map((browser) => browser.id).join(", ")}. Use one of these IDs.`
    )
  }

  async #browserCall(
    request: Extract<ParsedCuaRequest, { op: "browser.call" }>,
    context: CuaHostContext
  ): Promise<unknown> {
    const browser = await this.#resolveBrowser(context, request.browser)
    const validated = validateCall(request)
    if ("error" in validated) throw new CuaHostError("invalid", validated.error)
    const member: BrowserMember = validated.member
    if (!supports(browser.type, member)) {
      throw new CuaHostError(
        "unsupported",
        `${member} is not supported by ${browser.name} (${browser.type}).`
      )
    }
    const call: BrowserHostCall = {
      args: [...validated.args],
      browser: browser.route.kind === "device" ? browser.route.local : browser.id,
      backend: browser.route.kind === "desktop" ? browser.route.backend : "chrome",
      member,
      op: "browser.call",
      ...(request.tab ? { tab: request.tab } : {}),
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.handle ? { handle: request.handle } : {}),
    }
    const mutates = BROWSER_MEMBERS[member].mutates
    const target = [browser.id, request.tab].filter(Boolean).join(" ")
    try {
      const result =
        browser.route.kind === "desktop"
          ? await this.#desktop().call(
              context,
              browser.route.backend,
              call,
              this.#options.initiator?.(context.threadId)
            )
          : await this.#device(context, browser.route.host, call)
      if (mutates) this.#audit(`browser.${member}`, context, true, target)
      return result
    } catch (error) {
      if (mutates) this.#audit(`browser.${member}`, context, false, target, error)
      throw error
    }
  }

  #desktop(): DesktopBrowsers {
    if (!this.#options.desktop) {
      throw new CuaHostError("unavailable", "Cypheria Desktop is not connected.")
    }
    return this.#options.desktop
  }

  async #state(context: CuaHostContext): Promise<CuaState> {
    const surfaces = this.#options.surfaces()
    const errors: string[] = []
    let computerHost: string | undefined
    if (surfaces.has("computer")) {
      try {
        computerHost = this.#resolveComputer(context, undefined)
      } catch (error) {
        errors.push(`Native apps: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const [apps, browsers] = await Promise.all([
      computerHost
        ? (this.#device(context, computerHost, { op: "apps.list" }) as Promise<AppInfo[]>)
            .then((list) => list.filter((app) => app.running))
            .catch((error: unknown) => {
              errors.push(`Native apps: ${error instanceof Error ? error.message : String(error)}`)
              return undefined
            })
        : undefined,
      surfaces.has("browser") ? this.#browserStates(context, errors) : undefined,
    ])
    return {
      hosts: this.#hostInfo(context),
      ...(computerHost ? { host: computerHost } : {}),
      ...(apps ? { apps } : {}),
      ...(browsers ? { browsers } : {}),
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  async #browserStates(context: CuaHostContext, errors: string[]): Promise<BrowserState[]> {
    const listed = await this.#browsers(context)
    errors.push(...listed.errors)
    return Promise.all(
      listed.browsers.map(async ({ route: _, ...browser }) => {
        const tabs = await this.#browserCall(
          { args: [], browser: browser.id, member: "tabs.list", op: "browser.call" },
          context
        ).catch((error: unknown) => {
          errors.push(`${browser.name}: ${error instanceof Error ? error.message : String(error)}`)
          return undefined
        })
        return tabs ? { ...browser, tabs: tabs as TabInfo[] } : browser
      })
    )
  }
}
