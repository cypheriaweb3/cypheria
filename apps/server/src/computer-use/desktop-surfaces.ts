import type { CuaSurface, IabTabInfo, McpAppInfo, ParsedCuaDeviceRequest } from "@cypheria/cua"
import {
  type CuaHostContext,
  type CuaHostEntry,
  CuaHostError,
  type CuaHosts,
  type DesktopSurfaces,
} from "@cypheria/cua/host"
import type {
  BrowserAutomationCommandInput,
  BrowserAutomationDialogEvent,
  BrowserAutomationOutcome,
  BrowserAutomationResult,
  BrowserMcpAppMount,
} from "@cypheria/protocol"

import type { BrowserHostEntry } from "../browser-tools/broker.js"
import type { BrowserToolsService } from "../browser-tools/service.js"
import type { ExtensionOpenApp } from "../extensions/service.js"
import type { ComputerHostService } from "./computer-hosts.js"

const describeDialogs = (dialogs: readonly BrowserAutomationDialogEvent[] | undefined) =>
  dialogs?.length
    ? `The page opened ${dialogs.length} dialog(s): ${dialogs
        .map((dialog) => `${dialog.type} "${dialog.message}" was ${dialog.action}`)
        .join("; ")}.`
    : undefined

/** The surfaces a window serves, from the commands it registered. */
const windowSurfaces = (host: BrowserHostEntry): CuaSurface[] => [
  ...(host.supportedCommands.includes("new_tab") ? (["iab"] as const) : []),
  ...(host.supportedCommands.includes("mcp_app") ? (["mcpapps"] as const) : []),
]

export type BrokeredHostsOptions = {
  readonly browser: BrowserToolsService
  readonly devices: ComputerHostService
  /** The MCP App instances the Server has open, for their titles and Threads. */
  readonly openApps: () => readonly ExtensionOpenApp[]
}

/**
 * Every Computer Use surface for `cua_repl`. Built-in browser tabs and MCP Apps live in windows,
 * reached through the browser host broker; external browsers and native apps belong to a device,
 * reached through its computer host. The model sees one host per device, named by client ID.
 */
export class BrokeredComputerHosts implements DesktopSurfaces, CuaHosts {
  readonly #browser: BrowserToolsService
  readonly #devices: ComputerHostService
  readonly #openApps: () => readonly ExtensionOpenApp[]

  constructor(options: BrokeredHostsOptions) {
    this.#browser = options.browser
    this.#devices = options.devices
    this.#openApps = options.openApps
  }

  list(): CuaHostEntry[] {
    const hosts = new Map<string, { name: string; surfaces: Set<CuaSurface> }>()
    const entry = (id: string, name: string) => {
      const existing = hosts.get(id) ?? { name, surfaces: new Set<CuaSurface>() }
      hosts.set(id, existing)
      return existing
    }
    for (const window of this.#browser.broker.hosts()) {
      const host = entry(window.clientId, window.name)
      for (const surface of windowSurfaces(window)) host.surfaces.add(surface)
    }
    for (const device of this.#devices.hosts()) {
      const host = entry(device.id, device.name)
      host.name = device.name
      for (const surface of device.surfaces) host.surfaces.add(surface)
    }
    return [...hosts].map(([id, host]) => ({ id, name: host.name, surfaces: [...host.surfaces] }))
  }

  device(host: string, context: CuaHostContext, request: ParsedCuaDeviceRequest): Promise<unknown> {
    return this.#devices.request(host, context, request)
  }

  async listTabs(context: CuaHostContext): Promise<IabTabInfo[]> {
    const result = await this.#run(context, { args: {}, command: "list_tabs" })
    if (result.command !== "list_tabs") return []
    return result.tabs
      .filter((tab) => tab.threadId === context.threadId)
      .map((tab) => {
        const host = this.#browser.broker.hostOfTab(tab.browserId)?.clientId
        return {
          active: tab.isActive,
          ...(host ? { host } : {}),
          id: tab.browserId,
          kind: tab.kind,
          title: tab.title,
          url: tab.url,
        }
      })
  }

  async newTab(
    context: CuaHostContext,
    options: { url?: string; kind: "web" | "dapp"; host: string }
  ): Promise<IabTabInfo> {
    const result = await this.#run(
      context,
      {
        args: { kind: options.kind, ...(options.url ? { url: options.url } : {}) },
        command: "new_tab",
      },
      { clientId: options.host }
    )
    if (result.command !== "new_tab")
      throw new CuaHostError("browser_error", "The browser did not open a tab.")
    return {
      active: false,
      host: options.host,
      id: result.browserId,
      kind: result.kind,
      title: "",
      url: result.url,
    }
  }

  async command(
    context: CuaHostContext,
    tabId: string,
    command: string,
    args: Record<string, unknown>
  ): Promise<{ result: Record<string, unknown>; notice?: string }> {
    const outcome = await this.#execute(context, {
      args: { ...args, browserId: tabId },
      command,
    } as BrowserAutomationCommandInput)
    const result = this.#unwrap(outcome)
    const notice = describeDialogs(outcome.dialogs)
    return { result: result as Record<string, unknown>, ...(notice ? { notice } : {}) }
  }

  async listMcpApps(context: CuaHostContext): Promise<McpAppInfo[]> {
    return (await this.#reachableApps(context)).map(({ app }) => ({
      displayMode: app.displayMode,
      id: app.id,
      pluginId: app.pluginId,
      server: app.server,
      threadId: app.threadId,
      title: app.title,
    }))
  }

  async mcpApp(
    context: CuaHostContext,
    appId: string,
    action: Parameters<DesktopSurfaces["mcpApp"]>[2],
    preferredHost: string | undefined
  ): Promise<{ text?: string; image?: { dataBase64: string; mimeType: string } }> {
    const found = (await this.#reachableApps(context)).find(({ app }) => app.id === appId)
    if (!found) {
      throw new CuaHostError(
        "not_found",
        `MCP App ${appId} is not open in any window. List the Apps again.`
      )
    }
    // Each window renders its own copy of an App, so act on the copy the person can see when
    // they wrote from a device whose window shows it, else on the newest window showing it.
    const window =
      found.windows.filter((candidate) => candidate.clientId === preferredHost).at(-1) ??
      found.windows.at(-1)
    const result = await this.#run(
      context,
      { args: { action, appId }, command: "mcp_app" },
      window ? { hostId: window.id } : {}
    )
    if (result.command !== "mcp_app") return {}
    return {
      ...(result.snapshot !== undefined ? { text: result.snapshot } : {}),
      ...(result.dataBase64
        ? { image: { dataBase64: result.dataBase64, mimeType: result.mimeType ?? "image/png" } }
        : {}),
    }
  }

  /**
   * The Apps this Thread may act on, each with the windows that show it: the Thread's own Apps
   * and Apps outside any Thread, never another Thread's. Windows report what they show, and the
   * Server's instance table says which Thread an App belongs to.
   */
  async #reachableApps(
    context: CuaHostContext
  ): Promise<{ app: ExtensionOpenApp; windows: BrowserHostEntry[] }[]> {
    const answers = await this.#browser.broker.broadcast({
      command: { args: {}, command: "list_mcp_apps" },
      threadId: context.threadId,
    })
    const windowsByApp = new Map<string, BrowserHostEntry[]>()
    for (const { host, outcome } of answers) {
      if (!outcome.ok || outcome.result.command !== "list_mcp_apps") continue
      for (const mount of outcome.result.apps as BrowserMcpAppMount[]) {
        windowsByApp.set(mount.appId, [...(windowsByApp.get(mount.appId) ?? []), host])
      }
    }
    return this.#openApps()
      .filter((app) => app.threadId === null || app.threadId === context.threadId)
      .flatMap((app) => {
        const windows = windowsByApp.get(app.id)
        return windows ? [{ app, windows }] : []
      })
  }

  async #run(
    context: CuaHostContext,
    command: BrowserAutomationCommandInput,
    routing: { hostId?: string; clientId?: string } = {}
  ): Promise<BrowserAutomationResult> {
    return this.#unwrap(await this.#execute(context, command, routing))
  }

  #execute(
    context: CuaHostContext,
    command: BrowserAutomationCommandInput,
    routing: { hostId?: string; clientId?: string } = {}
  ) {
    return this.#browser.execute({
      command,
      ...(context.cwd ? { cwd: context.cwd } : {}),
      ...routing,
      threadId: context.threadId,
    })
  }

  #unwrap(outcome: BrowserAutomationOutcome): BrowserAutomationResult {
    if (outcome.ok) return outcome.result
    const retry = outcome.error.retryable ? " This error is retryable." : ""
    throw new CuaHostError(outcome.error.code, `${outcome.error.message}${retry}`)
  }
}
