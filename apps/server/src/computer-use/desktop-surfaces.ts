import {
  BROWSER_MEMBERS,
  type BrowserHostCall,
  type HostCapability,
  isBrowserMember,
  type ParsedCuaDeviceRequest,
  type TabInfo,
} from "@cypheria/cua"
import {
  type CuaHostContext,
  type CuaHostEntry,
  CuaHostError,
  type CuaHosts,
  type DesktopBrowsers,
} from "@cypheria/cua/host"
import type { BrowserAutomationOutcome, BrowserHostBackend } from "@cypheria/protocol"

import type { BrowserHostEntry } from "../browser-tools/broker.js"
import type { BrowserToolsService } from "../browser-tools/service.js"
import type { ExtensionOpenApp } from "../extensions/service.js"
import type { ComputerHostService } from "./computer-hosts.js"

/** How a Thread's built-in browser tab outlives its turn, as ChatGPT's tab cleanup defines it. */
type Disposition = "temporary" | "deliverable" | "handoff" | "stale"

/** An MCP App a window reports, with the Thread it belongs to or `null` outside any. */
type MountedApp = { readonly id: string; readonly threadId: string | null; readonly title?: string }

export type BrokeredHostsOptions = {
  readonly browser: BrowserToolsService
  readonly devices: ComputerHostService
  /** The MCP App instances the Server has open, for their titles and Threads. */
  readonly openApps: () => readonly ExtensionOpenApp[]
}

const describeWindows = (windows: readonly BrowserHostEntry[]) =>
  [...new Set(windows.map((window) => `${window.clientId} (${window.name})`))].join(", ")

const repeatable = (call: BrowserHostCall) =>
  isBrowserMember(call.member) && !BROWSER_MEMBERS[call.member].mutates

/**
 * Every Computer Use host for `cua_repl`. The built-in browser and MCP Apps live in windows,
 * reached through the browser host broker; external browsers and native apps belong to a
 * device, reached through its computer host. The model sees one host per device, named by
 * client ID, with the union of its windows' and device's capabilities.
 */
export class BrokeredComputerHosts implements DesktopBrowsers, CuaHosts {
  readonly #browser: BrowserToolsService
  readonly #devices: ComputerHostService
  readonly #openApps: () => readonly ExtensionOpenApp[]
  /** The built-in browser tabs each Thread opened, with how each outlives the turn. */
  readonly #tabs = new Map<string, Map<string, Disposition>>()

  constructor(options: BrokeredHostsOptions) {
    this.#browser = options.browser
    this.#devices = options.devices
    this.#openApps = options.openApps
  }

  list(): CuaHostEntry[] {
    const hosts = new Map<string, { name: string; capabilities: Set<HostCapability> }>()
    const entry = (id: string, name: string) => {
      const existing = hosts.get(id) ?? { capabilities: new Set<HostCapability>(), name }
      hosts.set(id, existing)
      return existing
    }
    for (const window of this.#browser.broker.hosts()) {
      const host = entry(window.clientId, window.name)
      for (const backend of window.backends) host.capabilities.add(backend)
    }
    for (const device of this.#devices.hosts()) {
      const host = entry(device.id, device.name)
      host.name = device.name
      for (const capability of device.capabilities) host.capabilities.add(capability)
    }
    return [...hosts].map(([id, host]) => ({
      capabilities: [...host.capabilities],
      id,
      name: host.name,
    }))
  }

  device(host: string, context: CuaHostContext, request: ParsedCuaDeviceRequest): Promise<unknown> {
    return this.#devices.request(host, context, request)
  }

  async call(
    context: CuaHostContext,
    backend: "iab" | "mcpapps",
    call: BrowserHostCall,
    preferredHost: string | undefined
  ): Promise<unknown> {
    return backend === "iab"
      ? this.#iab(context, call, preferredHost)
      : this.#mcpApps(context, call, preferredHost)
  }

  async turnEnded(context: CuaHostContext): Promise<void> {
    const tabs = this.#tabs.get(context.threadId)
    if (!tabs) return
    for (const [tabId, disposition] of [...tabs]) {
      if (disposition === "deliverable" || disposition === "handoff") {
        tabs.set(tabId, "stale")
        continue
      }
      if (disposition === "stale") continue
      tabs.delete(tabId)
      const owner = this.#browser.broker.hostOfTab("iab", tabId)
      if (!owner) continue
      await this.#send(owner, "iab", context, {
        args: [],
        browser: "iab",
        member: "tab.close",
        op: "browser.call",
        tab: tabId,
        backend: "iab",
      }).catch(() => undefined)
      this.#browser.broker.forgetTab("iab", tabId)
    }
  }

  // Built-in browser

  async #iab(
    context: CuaHostContext,
    call: BrowserHostCall,
    preferredHost: string | undefined
  ): Promise<unknown> {
    this.#refreshMarks(context.threadId)
    switch (call.member) {
      case "tabs.list":
        return this.#iabList(context)
      case "tabs.new": {
        const window = this.#newestWindow("iab", preferredHost)
        const tab = (await this.#send(window, "iab", context, call)) as TabInfo
        this.#browser.broker.rememberTab("iab", tab.id, window.id)
        this.#trackedTabs(context.threadId).set(tab.id, "temporary")
        return { ...tab, host: window.clientId }
      }
      case "tabs.selected":
      case "browser.capabilities":
      case "browser.capability":
      case "browser.nameSession":
        return this.#send(this.#newestWindow("iab", preferredHost), "iab", context, call)
      default:
        break
    }
    const tabId = call.member === "tabs.get" ? String(call.args[0]) : call.tab
    if (!tabId) throw new CuaHostError("invalid", `${call.member} needs a tab.`)
    const owner = await this.#owner(context, tabId)
    const result = await this.#send(owner, "iab", context, call)
    const tabs = this.#trackedTabs(context.threadId)
    switch (call.member) {
      case "tab.markDeliverable":
        tabs.set(tabId, "deliverable")
        break
      case "tab.markHandoff":
      case "tab.requestManualHandoff":
        tabs.set(tabId, "handoff")
        break
      case "tab.close":
        tabs.delete(tabId)
        this.#browser.broker.forgetTab("iab", tabId)
        break
    }
    return result
  }

  async #iabList(context: CuaHostContext): Promise<TabInfo[]> {
    const windows = this.#windows("iab")
    if (windows.length === 0) return []
    const answers = await Promise.all(
      windows.map(async (window) => ({
        tabs: (await this.#send(window, "iab", context, {
          args: [],
          browser: "iab",
          member: "tabs.list",
          op: "browser.call",
          backend: "iab",
        }).catch(() => [])) as TabInfo[],
        window,
      }))
    )
    // Windows share the device's tab index, so a restored tab no window has started is listed by
    // each of them; the earliest registered window keeps it.
    const seen = new Set<string>()
    const tabs: TabInfo[] = []
    for (const { tabs: listed, window } of answers) {
      for (const tab of listed) {
        if (seen.has(tab.id)) continue
        seen.add(tab.id)
        this.#browser.broker.rememberTab("iab", tab.id, window.id)
        tabs.push({ ...tab, host: window.clientId })
      }
    }
    return tabs
  }

  /** The window holding a tab, learning it from a fresh listing when unknown. */
  async #owner(context: CuaHostContext, tabId: string): Promise<BrowserHostEntry> {
    const known = this.#browser.broker.hostOfTab("iab", tabId)
    if (known) return known
    await this.#iabList(context)
    const found = this.#browser.broker.hostOfTab("iab", tabId)
    if (found) return found
    throw new CuaHostError(
      "not_found",
      `Built-in browser tab ${tabId} is not open in a connected window. List the tabs again and use one of the returned IDs.`
    )
  }

  #trackedTabs(threadId: string): Map<string, Disposition> {
    let tabs = this.#tabs.get(threadId)
    if (!tabs) {
      tabs = new Map()
      this.#tabs.set(threadId, tabs)
    }
    return tabs
  }

  /** Marks from an ended turn clear when a later turn uses the browser again. */
  #refreshMarks(threadId: string): void {
    const tabs = this.#tabs.get(threadId)
    for (const [tabId, disposition] of tabs ?? []) {
      if (disposition === "stale") tabs?.set(tabId, "temporary")
    }
  }

  // MCP Apps

  async #mcpApps(
    context: CuaHostContext,
    call: BrowserHostCall,
    preferredHost: string | undefined
  ): Promise<unknown> {
    const reachable = await this.#reachableApps(context)
    if (call.member === "tabs.list") {
      return reachable.map(({ app }) => ({ id: app.id, title: app.title }) satisfies TabInfo)
    }
    const appId = call.member === "tabs.get" ? String(call.args[0]) : call.tab
    if (!appId) throw new CuaHostError("invalid", `${call.member} needs an App.`)
    const found = reachable.find(({ app }) => app.id === appId)
    if (!found) {
      throw new CuaHostError(
        "not_found",
        `MCP App ${appId} is not open in any window. List the Apps again; the user may need to open it beside the conversation.`
      )
    }
    if (call.member === "tabs.get")
      return { id: found.app.id, title: found.app.title } satisfies TabInfo
    // Each window renders its own copy of an App, so act on the copy the person can see when
    // they wrote from a device whose window shows it, else on the newest window showing it.
    const window =
      found.windows.filter((candidate) => candidate.clientId === preferredHost).at(-1) ??
      found.windows.at(-1)
    if (!window) throw new CuaHostError("not_found", `MCP App ${appId} is not open in any window.`)
    return this.#send(window, "mcpapps", context, call)
  }

  /**
   * The Apps this Thread may act on, each with the windows that show it: the Thread's own Apps
   * and Apps outside any Thread, never another Thread's. Windows report what they show, and the
   * Server's instance table says which Thread an App belongs to.
   */
  async #reachableApps(
    context: CuaHostContext
  ): Promise<{ app: ExtensionOpenApp; windows: BrowserHostEntry[] }[]> {
    const windowsByApp = new Map<string, BrowserHostEntry[]>()
    await Promise.all(
      this.#windows("mcpapps").map(async (window) => {
        const mounted = (await this.#send(window, "mcpapps", context, {
          args: [],
          browser: "mcpapps",
          member: "tabs.list",
          op: "browser.call",
          backend: "mcpapps",
        }).catch(() => [])) as MountedApp[]
        for (const app of mounted) {
          windowsByApp.set(app.id, [...(windowsByApp.get(app.id) ?? []), window])
        }
      })
    )
    return this.#openApps()
      .filter((app) => app.threadId === null || app.threadId === context.threadId)
      .flatMap((app) => {
        const windows = windowsByApp.get(app.id)
        return windows ? [{ app, windows }] : []
      })
  }

  // Windows

  #windows(backend: BrowserHostBackend): BrowserHostEntry[] {
    return this.#browser.broker.hosts().filter((window) => window.backends.includes(backend))
  }

  /**
   * The window a new built-in browser resource opens in: the newest window of the device the
   * turn came from, else the newest window when every window belongs to one device.
   */
  #newestWindow(backend: BrowserHostBackend, preferredHost: string | undefined): BrowserHostEntry {
    const windows = this.#windows(backend)
    const preferred = windows.filter((window) => window.clientId === preferredHost).at(-1)
    if (preferred) return preferred
    const newest = windows.at(-1)
    if (!newest) {
      throw new CuaHostError(
        "unavailable",
        "The built-in browser needs a connected Cypheria Desktop window. Open Cypheria Desktop on the device to use."
      )
    }
    if (windows.every((window) => window.clientId === newest.clientId)) return newest
    throw new CuaHostError(
      "choose_host",
      `Several devices have the built-in browser: ${describeWindows(windows)}, and none sent this turn. Ask the user which device to use.`
    )
  }

  async #send(
    window: BrowserHostEntry,
    backend: BrowserHostBackend,
    context: CuaHostContext,
    call: BrowserHostCall
  ): Promise<unknown> {
    const outcome: BrowserAutomationOutcome = await this.#browser.broker.send({
      backend,
      hostId: window.id,
      repeatable: repeatable(call),
      request: call as unknown as Record<string, unknown>,
      threadId: context.threadId,
      ...(context.cwd ? { cwd: context.cwd } : {}),
    })
    if (outcome.ok) return outcome.value
    const retry = outcome.error.retryable ? " This error is retryable." : ""
    throw new CuaHostError(outcome.error.code, `${outcome.error.message}${retry}`)
  }
}
