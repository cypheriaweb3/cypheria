import type { ChromeApi, ChromeTab, ChromeWindow } from "./chrome-api.ts"
import { PeerError } from "./peer.ts"
import {
  type BrowserInfo,
  type DesktopMethod,
  type DesktopParams,
  DesktopRequests,
  type DesktopResult,
  type ExtensionNotification,
  type ExtensionNotificationParams,
  type Tab,
} from "./protocol.ts"

const CDP_VERSION = "1.3"
const BLANK = "about:blank"
const GROUPS_KEY = "groups"
const INSTANCE_KEY = "instanceId"
const DEFAULT_GROUP_TITLE = "Cypheria"

/** Pages of the browser itself and of other extensions, which the agent never sees or claims. */
const INTERNAL_URL = /^(chrome|edge|brave|opera|vivaldi|chrome-extension|devtools|chrome-search):/

type Notify = <N extends ExtensionNotification>(
  method: N,
  params: ExtensionNotificationParams<N>
) => void

/** The Chromium family this extension runs in, from what the browser tells pages. */
export const detectFamily = (navigatorLike: {
  readonly userAgent: string
  readonly userAgentData?: { readonly brands?: readonly { readonly brand: string }[] }
  readonly brave?: unknown
}): string => {
  if (navigatorLike.brave !== undefined) return "brave"
  const brands = (navigatorLike.userAgentData?.brands ?? []).map(({ brand }) => brand)
  if (brands.includes("Microsoft Edge") || / Edg\//.test(navigatorLike.userAgent)) return "edge"
  if (brands.includes("Opera") || / OPR\//.test(navigatorLike.userAgent)) return "opera"
  if (/ Vivaldi\//.test(navigatorLike.userAgent)) return "vivaldi"
  if (brands.includes("Google Chrome")) return "chrome"
  return brands.includes("Chromium") ? "chromium" : "chrome"
}

/**
 * What Desktop asks of this browser profile. It stays thin: tabs, tab groups, and the debugger.
 * Desktop owns Thread scoping, leases, and every page behavior, which it runs over the CDP this
 * forwards.
 */
export class ExtensionBackend {
  readonly #chrome: ChromeApi
  readonly #family: string
  readonly #notify: Notify
  readonly #attached = new Set<number>()

  constructor(options: {
    readonly chrome: ChromeApi
    readonly family: string
    readonly notify: Notify
  }) {
    this.#chrome = options.chrome
    this.#family = options.family
    this.#notify = options.notify
    const { debugger: debug, downloads } = this.#chrome
    debug.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined || source.sessionId || !this.#attached.has(source.tabId))
        return
      this.#notify("cdpEvent", {
        method,
        tabId: source.tabId,
        ...(params ? { params: params as Record<string, unknown> } : {}),
      })
    })
    debug.onDetach.addListener((source, reason) => {
      if (source.tabId === undefined || !this.#attached.delete(source.tabId)) return
      this.#notify("cdpDetached", { reason, tabId: source.tabId })
    })
    downloads.onCreated.addListener((item) => {
      this.#notify("downloadChanged", {
        id: item.id,
        state: "in_progress",
        url: item.url,
        ...(item.filename ? { filename: item.filename } : {}),
      })
    })
    downloads.onChanged.addListener((delta) => {
      const state = delta.state?.current
      if (state !== "complete" && state !== "interrupted") return
      void (async () => {
        const [item] = await this.#chrome.downloads.search({ id: delta.id }).catch(() => [])
        this.#notify("downloadChanged", {
          id: delta.id,
          state,
          ...(item?.filename ? { filename: item.filename } : {}),
          ...(item?.url ? { url: item.url } : {}),
          ...(delta.error?.current ? { error: delta.error.current } : {}),
        })
      })()
    })
  }

  /** Validates and runs one request from Desktop. */
  async handle(method: string, params: unknown): Promise<unknown> {
    if (!Object.hasOwn(DesktopRequests, method)) {
      throw new PeerError("invalid", `Unknown method ${method}.`)
    }
    const name = method as DesktopMethod
    const parsed = DesktopRequests[name].params.safeParse(params ?? {})
    if (!parsed.success) {
      throw new PeerError(
        "invalid",
        `Invalid ${name} parameters: ${parsed.error.issues[0]?.message ?? "malformed"}`
      )
    }
    return this.#run(name, parsed.data)
  }

  async #run(method: DesktopMethod, params: unknown): Promise<unknown> {
    const tab = () => (params as DesktopParams<"attach">).tabId
    switch (method) {
      case "getInfo":
        return this.getInfo()
      case "listTabs":
        return this.listTabs()
      case "openTab": {
        const { group, title } = params as DesktopParams<"openTab">
        return this.openTab(group, title)
      }
      case "nameGroup": {
        const { group, title } = params as DesktopParams<"nameGroup">
        await this.nameGroup(group, title)
        return null
      }
      case "closeTab":
        await this.#detachQuietly(tab())
        await this.#chrome.tabs.remove(tab())
        return null
      case "attach":
        await this.attach(tab())
        return null
      case "detach":
        await this.#detachQuietly(tab())
        return null
      case "cdp": {
        const command = params as DesktopParams<"cdp">
        return this.cdp(command.tabId, command.method, command.params)
      }
    }
  }

  async getInfo(): Promise<DesktopResult<"getInfo">> {
    return {
      extensionVersion: this.#chrome.runtime.getManifest().version,
      family: this.#family,
      instanceId: await this.#instanceId(),
    } satisfies BrowserInfo
  }

  /** The person's open tabs in normal windows, without the browser's own pages. */
  async listTabs(): Promise<Tab[]> {
    const tabs = (await this.#chrome.tabs.query({ windowType: "normal" })).filter(
      (tab) => tab.id !== undefined && !tab.incognito && !INTERNAL_URL.test(tab.url ?? "")
    )
    const groups = new Map<number, string>()
    for (const groupId of new Set(tabs.map((tab) => tab.groupId).filter((id) => id >= 0))) {
      const group = await this.#chrome.tabGroups.get(groupId).catch(() => undefined)
      if (group?.title) groups.set(groupId, group.title)
    }
    return tabs.map((tab) => toTab(tab, groups.get(tab.groupId)))
  }

  /**
   * Opens a background tab in the group's tab group, so the person sees which tabs an agent
   * works in without the agent taking focus. The group lives in the window the person used last.
   */
  async openTab(group: string, title: string | undefined): Promise<{ id: number }> {
    const groups = await this.#groups()
    const existing = groups[group]
    const current =
      existing === undefined
        ? undefined
        : await this.#chrome.tabGroups.get(existing).catch(() => undefined)
    let windowId = current?.windowId ?? (await this.#targetWindow())?.id
    let tab: ChromeTab
    if (windowId === undefined) {
      const created = await this.#chrome.windows.create({
        focused: false,
        type: "normal",
        url: BLANK,
      })
      const first = created.tabs?.[0]
      if (first?.id === undefined || created.id === undefined) {
        throw new PeerError("failed", "The browser did not open a window.")
      }
      windowId = created.id
      tab = first
    } else {
      tab = await this.#chrome.tabs.create({ active: false, url: BLANK, windowId })
    }
    if (tab.id === undefined) throw new PeerError("failed", "The browser did not open a tab.")
    const groupId = await this.#chrome.tabs.group(
      current
        ? { groupId: current.id, tabIds: [tab.id] }
        : { createProperties: { windowId }, tabIds: [tab.id] }
    )
    if (!current) {
      await this.#chrome.tabGroups
        .update(groupId, { color: "grey", title: title || DEFAULT_GROUP_TITLE })
        .catch(() => undefined)
      await this.#setGroups({ ...groups, [group]: groupId })
    }
    return { id: tab.id }
  }

  async nameGroup(group: string, title: string): Promise<void> {
    const groupId = (await this.#groups())[group]
    if (groupId === undefined) return
    await this.#chrome.tabGroups.update(groupId, { title }).catch(() => undefined)
  }

  async attach(tabId: number): Promise<void> {
    if (this.#attached.has(tabId)) return
    const tab = await this.#chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab) throw new PeerError("failed", `Tab ${tabId} is closed.`)
    if (tab.incognito || INTERNAL_URL.test(tab.url ?? tab.pendingUrl ?? "")) {
      throw new PeerError("failed", `Tab ${tabId} is a browser page that cannot be controlled.`)
    }
    try {
      await this.#chrome.debugger.attach({ tabId }, CDP_VERSION)
    } catch (error) {
      throw new PeerError(
        "failed",
        `Could not attach to tab ${tabId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.#attached.add(tabId)
  }

  async cdp(
    tabId: number,
    method: string,
    params: Record<string, unknown> | undefined
  ): Promise<Record<string, unknown>> {
    await this.attach(tabId)
    try {
      const result = await this.#chrome.debugger.sendCommand({ tabId }, method, params)
      return (result ?? {}) as Record<string, unknown>
    } catch (error) {
      throw new PeerError("failed", error instanceof Error ? error.message : String(error))
    }
  }

  async #detachQuietly(tabId: number): Promise<void> {
    if (!this.#attached.delete(tabId)) return
    await this.#chrome.debugger.detach({ tabId }).catch(() => undefined)
  }

  async #targetWindow(): Promise<ChromeWindow | undefined> {
    const usable = (window: ChromeWindow | undefined) =>
      window?.id !== undefined && !window.incognito && (window.type ?? "normal") === "normal"
    const focused = await this.#chrome.windows
      .getLastFocused({ windowTypes: ["normal"] })
      .catch(() => undefined)
    if (usable(focused)) return focused
    return (await this.#chrome.windows.getAll({ windowTypes: ["normal"] })).find(usable)
  }

  async #instanceId(): Promise<string> {
    const stored = (await this.#chrome.storage.local.get(INSTANCE_KEY))[INSTANCE_KEY]
    if (typeof stored === "string" && stored) return stored
    const id = crypto.randomUUID()
    await this.#chrome.storage.local.set({ [INSTANCE_KEY]: id })
    return id
  }

  async #groups(): Promise<Record<string, number>> {
    const stored = (await this.#chrome.storage.session.get(GROUPS_KEY))[GROUPS_KEY]
    return typeof stored === "object" && stored !== null ? (stored as Record<string, number>) : {}
  }

  async #setGroups(groups: Record<string, number>): Promise<void> {
    await this.#chrome.storage.session.set({ [GROUPS_KEY]: groups })
  }
}

const toTab = (tab: ChromeTab, groupTitle: string | undefined): Tab => ({
  active: tab.active,
  id: tab.id ?? -1,
  title: tab.title ?? "",
  url: tab.url ?? tab.pendingUrl ?? "",
  windowId: tab.windowId,
  ...(tab.lastAccessed !== undefined ? { lastAccessed: tab.lastAccessed } : {}),
  ...(groupTitle ? { groupTitle } : {}),
})
