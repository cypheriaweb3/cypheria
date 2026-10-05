import { z } from "zod"

import type { BrowserHostCall } from "../../browser/protocol.ts"
import type { ChromeBrowserInfo, TabInfo, UserTabInfo } from "../../browser/types.ts"
import { hideAgentCursor } from "../../engine/cursor.ts"
import { saveFile } from "../../engine/files.ts"
import { CdpTab, VirtualClipboard } from "../../engine/tab.ts"
import { CuaHostError } from "../errors.ts"
import type { ChromeDriver, DriverTab } from "./driver.ts"

type Disposition = "temporary" | "deliverable" | "handoff"
type ControlledTab = { owned: boolean; disposition: Disposition }
type ThreadBrowser = {
  readonly tabs: Map<string, ControlledTab>
  /** Marks from an ended turn; they clear when a later turn uses this browser again. */
  staleMarks: boolean
  selected?: string
  sessionName?: string
  readonly clipboard: VirtualClipboard
}

export type ChromeCallContext = { readonly threadId: string; readonly cwd?: string }

const LeaseStateSchema = z.object({
  threads: z.array(
    z.object({
      browsers: z.array(
        z.object({
          browserId: z.string(),
          selected: z.string().optional(),
          sessionName: z.string().optional(),
          staleMarks: z.boolean(),
          tabs: z.array(
            z.object({
              disposition: z.enum(["temporary", "deliverable", "handoff"]),
              owned: z.boolean(),
              tabId: z.string(),
            })
          ),
        })
      ),
      threadId: z.string(),
    })
  ),
})
/** Which Thread controls which tab, as a device keeps it between restarts. */
export type ChromeLeaseState = z.infer<typeof LeaseStateSchema>

/**
 * Where a device keeps its tab leases, so a Thread still controls its tabs after Desktop
 * restarts. A lease outlives the browser only on paper: a restarted browser has new tab IDs, and
 * leases for tabs that are gone drop the next time the Thread lists its tabs.
 */
export interface ChromeLeaseStore {
  load(): Promise<unknown>
  save(state: ChromeLeaseState): Promise<void>
}

export type ChromeSessionsOptions = {
  readonly drivers: () => Promise<readonly ChromeDriver[]>
  readonly platform: string
  readonly leases?: ChromeLeaseStore
  /**
   * The `x-browser-agent` header value, such as `Cypheria/1.2.3`, that requests from tabs a
   * Thread controls carry so sites can tell agent traffic apart. Omitted, no header is set.
   */
  readonly agentHeader?: string
  /** Where media an agent downloads is saved, such as the person's Downloads folder. */
  readonly downloadsDir?: () => string
}

const userTab = (tab: DriverTab): UserTabInfo => ({
  id: tab.id,
  providerTabId: tab.id,
  title: tab.title,
  url: tab.url,
  ...(tab.lastOpened ? { lastOpened: tab.lastOpened } : {}),
  ...(tab.tabGroup ? { tabGroup: tab.tabGroup } : {}),
})

const tabInfo = (tab: DriverTab): TabInfo => ({
  id: tab.id,
  providerTabId: tab.id,
  title: tab.title,
  url: tab.url,
})

/**
 * The `chrome` backend of one device: the browsers its drivers offer, Thread-scoped. A Thread
 * acts only in tabs it opened or claimed. At the end of a turn, unmarked tabs it opened close
 * and unmarked tabs it claimed are released and stay open. Marked tabs stay; their marks clear
 * when a later turn uses the browser again, so they must be marked again to outlive that turn.
 */
export class ChromeSessions {
  readonly #drivers: () => Promise<readonly ChromeDriver[]>
  readonly #platform: string
  readonly #options: ChromeSessionsOptions
  readonly #threads = new Map<string, Map<string, ThreadBrowser>>()
  /** Engine tabs by browser and tab ID, shared by the Threads that control them. */
  readonly #tabs = new Map<string, CdpTab>()
  #loaded: Promise<void> | undefined
  #saved = ""

  constructor(options: ChromeSessionsOptions) {
    this.#drivers = options.drivers
    this.#platform = options.platform
    this.#options = options
  }

  async list(): Promise<ChromeBrowserInfo[]> {
    return (await this.#drivers()).map((driver) => driver.info())
  }

  async call(call: BrowserHostCall, context: ChromeCallContext): Promise<unknown> {
    await this.#load()
    try {
      return await this.#call(call, context)
    } finally {
      await this.#persist()
    }
  }

  async #call(call: BrowserHostCall, context: ChromeCallContext): Promise<unknown> {
    const driver = await this.#driver(call.browser)
    const browser = this.#threadBrowser(context.threadId, call.browser)
    // The Server and device validated the arguments against the member's schema.
    const args = call.args as unknown as readonly [never, never, never]
    switch (call.member) {
      case "browser.nameSession":
        browser.sessionName = args[0]
        await driver.nameSession?.(context.threadId, args[0])
        return null
      case "browser.capabilities":
        return []
      case "browser.capability":
        throw new CuaHostError(
          "unsupported",
          `${driver.info().name} has no capability ${String(args[0])}.`
        )
      case "user.openTabs": {
        this.#userTabs(driver)
        const tabs = await driver.listTabs()
        return tabs
          .map(userTab)
          .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""))
      }
      case "user.claimTab": {
        this.#userTabs(driver)
        const tab = (await driver.listTabs()).find((candidate) => candidate.id === args[0])
        if (!tab) {
          throw new CuaHostError(
            "not_found",
            `Tab ${String(args[0])} is not open in ${driver.info().name}. List the open tabs again.`
          )
        }
        if (!browser.tabs.has(tab.id))
          browser.tabs.set(tab.id, { disposition: "temporary", owned: false })
        browser.selected = tab.id
        return tabInfo(tab)
      }
      case "tabs.list": {
        const open = new Map((await driver.listTabs()).map((tab) => [tab.id, tab]))
        for (const id of [...browser.tabs.keys()]) {
          if (!open.has(id)) this.#forget(call.browser, browser, id)
        }
        return [...browser.tabs.keys()].flatMap((id) => {
          const tab = open.get(id)
          return tab ? [tabInfo(tab)] : []
        })
      }
      case "tabs.get":
        return tabInfo(await this.#controlled(driver, browser, args[0]))
      case "tabs.new": {
        const id = await driver.openTab(context.threadId, browser.sessionName)
        browser.tabs.set(id, { disposition: "temporary", owned: true })
        browser.selected = id
        return { id, providerTabId: id, title: "", url: "about:blank" } satisfies TabInfo
      }
      case "tabs.selected": {
        if (!browser.selected || !browser.tabs.has(browser.selected)) return null
        const tab = (await driver.listTabs()).find((candidate) => candidate.id === browser.selected)
        return tab ? tabInfo(tab) : null
      }
      default:
        break
    }
    const tabId = call.tab
    if (!tabId) throw new CuaHostError("invalid", `${call.member} needs a tab.`)
    const controlled = browser.tabs.get(tabId)
    if (!controlled) {
      throw new CuaHostError(
        "not_controlled",
        `This task does not control tab ${tabId}. Claim it with browser.user.claimTab() or open a new tab first.`
      )
    }
    browser.selected = tabId
    switch (call.member) {
      case "tab.markDeliverable":
        controlled.disposition = "deliverable"
        return null
      case "tab.markHandoff":
        controlled.disposition = "handoff"
        return null
      case "tab.close":
        this.#forget(call.browser, browser, tabId)
        await driver.closeTab(tabId)
        return null
      case "tab.info": {
        const tab = (await driver.listTabs()).find((candidate) => candidate.id === tabId)
        if (tab) return { title: tab.title, url: tab.url }
        break
      }
      default:
        break
    }
    const tab = await this.#tab(driver, call.browser, tabId, browser)
    try {
      return await tab.call(call.member as never, call.args, {
        context: { ...(context.cwd ? { cwd: context.cwd } : {}) },
        ...(call.handle ? { handle: call.handle } : {}),
        ...(call.selector ? { selector: call.selector } : {}),
      })
    } catch (error) {
      if (tab.page.closed) this.#dropTab(call.browser, tabId)
      throw error
    }
  }

  /** Applies the end-of-turn tab rules for one Thread. */
  async turnEnded(threadId: string): Promise<void> {
    await this.#load()
    try {
      await this.#turnEnded(threadId)
    } finally {
      await this.#persist()
    }
  }

  async #turnEnded(threadId: string): Promise<void> {
    const browsers = this.#threads.get(threadId)
    if (!browsers) return
    for (const [browserId, browser] of browsers) {
      const driver = (await this.#drivers().catch(() => [])).find(
        (candidate) => candidate.info().id === browserId
      )
      for (const [tabId, tab] of [...browser.tabs]) {
        // The pointer shows only while the agent acts.
        const engineTab = this.#tabs.get(`${browserId}|${tabId}`)
        if (engineTab && !engineTab.page.closed) await hideAgentCursor(engineTab.page.transport)
        if (tab.disposition !== "temporary") {
          browser.staleMarks = true
          continue
        }
        this.#forget(browserId, browser, tabId)
        if (!driver) continue
        if (tab.owned) await driver.closeTab(tabId).catch(() => undefined)
        else await driver.release(tabId).catch(() => undefined)
      }
      await driver?.turnEnded?.(threadId).catch(() => undefined)
    }
  }

  /** Forgets a Thread. The browsers and the user's tabs stay open. */
  closeThread(threadId: string): void {
    void this.#load().then(() => {
      const browsers = this.#threads.get(threadId)
      this.#threads.delete(threadId)
      for (const [browserId, browser] of browsers ?? []) {
        for (const tabId of browser.tabs.keys()) this.#dropTab(browserId, tabId)
      }
      return this.#persist()
    })
  }

  /** Restores the leases the device kept, once. */
  #load(): Promise<void> {
    this.#loaded ??= (async () => {
      const parsed = LeaseStateSchema.safeParse(
        await this.#options.leases?.load().catch(() => undefined)
      )
      if (!parsed.success) return
      for (const thread of parsed.data.threads) {
        const browsers = new Map<string, ThreadBrowser>()
        for (const browser of thread.browsers) {
          browsers.set(browser.browserId, {
            clipboard: new VirtualClipboard(),
            staleMarks: browser.staleMarks,
            tabs: new Map(
              browser.tabs.map((tab) => [
                tab.tabId,
                { disposition: tab.disposition, owned: tab.owned },
              ])
            ),
            ...(browser.selected ? { selected: browser.selected } : {}),
            ...(browser.sessionName ? { sessionName: browser.sessionName } : {}),
          })
        }
        this.#threads.set(thread.threadId, browsers)
      }
      this.#saved = JSON.stringify(this.#snapshot())
    })()
    return this.#loaded
  }

  #snapshot(): ChromeLeaseState {
    return {
      threads: [...this.#threads].flatMap(([threadId, browsers]) => {
        const kept = [...browsers]
          .filter(([, browser]) => browser.tabs.size > 0 || browser.sessionName)
          .map(([browserId, browser]) => ({
            browserId,
            staleMarks: browser.staleMarks,
            tabs: [...browser.tabs].map(([tabId, tab]) => ({ tabId, ...tab })),
            ...(browser.selected ? { selected: browser.selected } : {}),
            ...(browser.sessionName ? { sessionName: browser.sessionName } : {}),
          }))
        return kept.length > 0 ? [{ browsers: kept, threadId }] : []
      }),
    }
  }

  /** Saves the leases when they changed. */
  async #persist(): Promise<void> {
    if (!this.#options.leases) return
    const state = this.#snapshot()
    const serialized = JSON.stringify(state)
    if (serialized === this.#saved) return
    this.#saved = serialized
    await this.#options.leases.save(state).catch(() => undefined)
  }

  async #driver(id: string): Promise<ChromeDriver> {
    const driver = (await this.#drivers()).find((candidate) => candidate.info().id === id)
    if (!driver)
      throw new CuaHostError(
        "not_found",
        `Browser ${id} is not available on this device. List the browsers again.`
      )
    return driver
  }

  #userTabs(driver: ChromeDriver): void {
    if (!driver.userTabs) {
      throw new CuaHostError("unsupported", `${driver.info().name} does not share the user's tabs.`)
    }
  }

  #threadBrowser(threadId: string, browserId: string): ThreadBrowser {
    let browsers = this.#threads.get(threadId)
    if (!browsers) {
      browsers = new Map()
      this.#threads.set(threadId, browsers)
    }
    let browser = browsers.get(browserId)
    if (!browser) {
      browser = { clipboard: new VirtualClipboard(), staleMarks: false, tabs: new Map() }
      browsers.set(browserId, browser)
    }
    if (browser.staleMarks) {
      browser.staleMarks = false
      for (const tab of browser.tabs.values()) tab.disposition = "temporary"
    }
    return browser
  }

  async #controlled(
    driver: ChromeDriver,
    browser: ThreadBrowser,
    tabId: string
  ): Promise<DriverTab> {
    if (!browser.tabs.has(tabId)) {
      throw new CuaHostError(
        "not_controlled",
        `This task does not control tab ${tabId}. Claim it first.`
      )
    }
    const tab = (await driver.listTabs()).find((candidate) => candidate.id === tabId)
    if (!tab) throw new CuaHostError("not_found", `Tab ${tabId} is closed.`)
    browser.selected = tabId
    return tab
  }

  async #tab(
    driver: ChromeDriver,
    browserId: string,
    tabId: string,
    browser: ThreadBrowser
  ): Promise<CdpTab> {
    const key = `${browserId}|${tabId}`
    const existing = this.#tabs.get(key)
    if (existing && !existing.page.closed) return existing
    existing?.dispose()
    const transport = await driver.transport(tabId)
    if (this.#options.agentHeader) {
      await transport.send("Network.enable").catch(() => {})
      await transport
        .send("Network.setExtraHTTPHeaders", {
          headers: { "x-browser-agent": this.#options.agentHeader },
        })
        .catch(() => {})
    }
    const downloadsDir = this.#options.downloadsDir
    const tab = new CdpTab(transport, this.#platform, {
      clipboard: browser.clipboard,
      cursor: true,
      ...(downloadsDir
        ? {
            saveFile: (filename: string, data: Uint8Array) =>
              saveFile(downloadsDir(), filename, data),
          }
        : {}),
      ...(driver.waitForDownload
        ? {
            waitForDownload: (timeoutMs: number) =>
              driver.waitForDownload?.(tabId, timeoutMs) as never,
          }
        : {}),
    })
    this.#tabs.set(key, tab)
    return tab
  }

  #forget(browserId: string, browser: ThreadBrowser, tabId: string): void {
    browser.tabs.delete(tabId)
    if (browser.selected === tabId) browser.selected = undefined
    this.#dropTab(browserId, tabId)
  }

  #dropTab(browserId: string, tabId: string): void {
    const key = `${browserId}|${tabId}`
    this.#tabs.get(key)?.dispose()
    this.#tabs.delete(key)
  }
}
