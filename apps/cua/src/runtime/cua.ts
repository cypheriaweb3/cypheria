import type { BrowserInfo, TabInfo, UserTabInfo } from "../browser/types.ts"
import type { Browser, Browsers, Tab } from "./agent.ts"
import type { Documentation } from "./docs.ts"
import { absoluteUrl, emitImage, writeText } from "./host.ts"
import { parseTabMention } from "./mentions.ts"

type Vec2 = [x: number, y: number]
type ObservationOptions = { emit?: boolean }
type StateOptions = ObservationOptions & { disableDiffing?: boolean }

/** A tab with the `Target` methods `cua` adds, as `cua.getTab()` returns it. */
export type BoundTab = Tab & {
  getAXState(options?: StateOptions): Promise<string>
  getScreenshot(options?: ObservationOptions): Promise<Uint8Array>
  getAXStateAndScreenshot(
    options?: StateOptions
  ): Promise<{ state: string; screenshot?: Uint8Array }>
  click(
    target: number | Vec2,
    options?: { mouseButton?: string; clickCount?: number }
  ): Promise<void>
  drag(from: Vec2, to: Vec2): Promise<void>
  scroll(target: number | Vec2, direction: string, pages?: number): Promise<void>
  selectText(elementIndex: number, text: string, options?: object): Promise<void>
  setValue(elementIndex: number, value: string): Promise<void>
  performSecondaryAction(elementIndex: number, action: string): Promise<void>
  paste(elementIndex: number | null, text: string, options?: { format?: string }): Promise<void>
  pressKey(elementIndex: number | null, key: string): Promise<void>
  typeText(elementIndex: number | null, text: string): Promise<void>
}

const NEW_TAB_URLS = new Set(["chrome://newtab", "chrome://newtab/", "about:blank"])

const requireIndex = (value: number | null) => {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error(
      "Browser input needs an element index from the latest accessibility state, or null to use the current focus."
    )
  }
}

/** Adds the `Target` methods to a tab; DOM-only tabs read a DOM snapshot instead. */
export const bindTab = (tab: Tab): BoundTab => {
  const ax = () => {
    if (!tab.ax)
      throw new Error("This tab does not support accessibility input. Use its Playwright API.")
    return tab.ax
  }
  const state = async (options: StateOptions = {}): Promise<string> =>
    tab.ax
      ? tab.ax.get(
          "state",
          options.disableDiffing === undefined ? {} : { disableDiffing: options.disableDiffing }
        )
      : tab.playwright.domSnapshot()
  return Object.assign(tab, {
    async getAXState(options: StateOptions = {}) {
      const text = await state(options)
      if (options.emit !== false) writeText(text)
      return text
    },
    async getScreenshot(options: ObservationOptions = {}) {
      const image = await tab.screenshot()
      if (options.emit !== false) await emitImage({ bytes: image, mimeType: "image/png" })
      return image
    },
    async getAXStateAndScreenshot(options: StateOptions = {}) {
      if (!tab.ax) {
        const [text, image] = await Promise.all([tab.playwright.domSnapshot(), tab.screenshot()])
        if (options.emit !== false) {
          writeText(text)
          await emitImage({ bytes: image, mimeType: "image/png" })
        }
        return { screenshot: image, state: text }
      }
      const both = await tab.ax.get(
        "both",
        options.disableDiffing === undefined ? {} : { disableDiffing: options.disableDiffing }
      )
      if (options.emit !== false) {
        writeText(both.state)
        if (both.screenshot) await emitImage({ bytes: both.screenshot, mimeType: "image/png" })
      }
      return both
    },
    click: (target: number | Vec2, options?: { mouseButton?: string; clickCount?: number }) =>
      ax().click(target, options),
    drag: (from: Vec2, to: Vec2) => ax().drag(from, to),
    scroll: (target: number | Vec2, direction: string, pages?: number) =>
      ax().scroll(target, direction, pages),
    selectText: (elementIndex: number, text: string, options?: object) =>
      ax().selectText(elementIndex, text, options),
    setValue: (elementIndex: number, value: string) => ax().setValue(elementIndex, value),
    performSecondaryAction: (elementIndex: number, action: string) =>
      ax().performSecondaryAction(elementIndex, action),
    paste: (elementIndex: number | null, text: string, options?: { format?: string }) => {
      requireIndex(elementIndex)
      return ax().paste(elementIndex, text, options)
    },
    pressKey: (elementIndex: number | null, key: string) => {
      requireIndex(elementIndex)
      return ax().pressKey(elementIndex, key)
    },
    typeText: (elementIndex: number | null, text: string) => {
      requireIndex(elementIndex)
      return ax().typeText(elementIndex, text)
    },
  }) as BoundTab
}

/** Shows a tab's full state once it is bound, so the model starts from fresh indices. */
const enter = async (tab: Tab): Promise<BoundTab> => {
  const bound = bindTab(tab)
  if (bound.ax) {
    bound.ax.reset()
    writeText(await bound.ax.get("state"))
  } else {
    writeText(await bound.playwright.domSnapshot())
  }
  return bound
}

/** The browser-facing half of `cua`, built on `agent.browsers`. */
export const createBrowserApi = (browsers: Browsers, docs: Documentation) => {
  const select = async (options: { browser?: string; url?: string } = {}): Promise<Browser> => {
    const browser = options.browser
      ? await browsers.get(options.browser)
      : options.url
        ? await browsers.getForUrl(options.url)
        : await browsers.getDefault()
    docs.enterBrowser(browser.type)
    return browser
  }

  const findTabs = async (browser: Browser, matches: (tab: TabInfo | UserTabInfo) => boolean) => {
    const managed = await browser.tabs.list()
    const found = managed.filter(matches)
    if (found.length > 0 || !browser.user) return { found, managed }
    const open = await browser.user.openTabs()
    return { found: open.filter(matches), managed }
  }

  const take = async (
    browser: Browser,
    managed: TabInfo[],
    tab: TabInfo | UserTabInfo
  ): Promise<Tab> => {
    if (managed.some((candidate) => candidate.id === tab.id)) return browser.tabs.get(tab.id)
    if (!browser.user)
      throw new Error(`Tab ${tab.id} cannot be claimed in browser ${browser.browserId}.`)
    return browser.user.claimTab(tab as UserTabInfo)
  }

  return {
    browsers,

    async getBrowser(options: { id?: string; url?: string } = {}) {
      return select({
        ...(options.id ? { browser: options.id } : {}),
        ...(options.url ? { url: absoluteUrl(options.url) } : {}),
      })
    },

    async createBrowserTab(
      browserId: string,
      url?: string,
      options: { visible?: boolean; sessionName?: string } = {}
    ): Promise<BoundTab> {
      if (typeof browserId !== "string" || !browserId.trim()) {
        throw new Error("createBrowserTab requires a browser ID. Select one with cua.getBrowser().")
      }
      const browser = await select({ browser: browserId })
      if (!browser.tabs.new)
        throw new Error(`Browser ${browser.browserId} does not support creating tabs.`)
      if (options.sessionName !== undefined) {
        if (!browser.nameSession)
          throw new Error(`Browser ${browser.browserId} does not support sessionName.`)
        await browser.nameSession(options.sessionName)
      }
      if (options.visible !== undefined) {
        if (!browser.capabilities) {
          throw new Error(`Browser ${browser.browserId} does not support visibility control.`)
        }
        const visibility = await browser.capabilities.get("visibility")
        await visibility.set?.(options.visible)
      }
      const tab = await browser.tabs.new()
      if (tab.goto) {
        await tab.goto(url ? absoluteUrl(url) : "about:blank")
      } else if (url) {
        await tab.close?.()
        throw new Error(`Tab ${tab.id} does not support navigation.`)
      }
      return enter(tab)
    },

    async getTab(
      reference: string | { mention: string } | { url: string },
      options: { browser?: string } = {}
    ): Promise<BoundTab> {
      let browser: Browser
      let result: { found: (TabInfo | UserTabInfo)[]; managed: TabInfo[] }
      if (typeof reference === "string") {
        if (!reference) throw new Error("getTab requires a tab reference.")
        browser = await select(options)
        result = await findTabs(
          browser,
          (tab) => tab.id === reference || tab.providerTabId === reference
        )
      } else if ("mention" in reference) {
        const mention = parseTabMention(reference.mention)
        const listed = await browsers.list()
        const candidates = listed.filter((info: BrowserInfo) =>
          mention.source === "iab"
            ? info.type === "iab"
            : info.type === "chrome" &&
              (info.id === mention.browserId || info.id === `${mention.browserId}@${mention.host}`)
        )
        if (candidates.length === 0) {
          throw new Error("The browser or profile the tab mention refers to is unavailable.")
        }
        if (candidates.length > 1) {
          throw new Error(`Several browsers match the tab mention: ${JSON.stringify(candidates)}`)
        }
        browser = await select({ browser: (candidates[0] as BrowserInfo).id })
        if (
          options.browser !== undefined &&
          (await browsers.get(options.browser)).browserId !== browser.browserId
        ) {
          throw new Error("The requested browser does not match the tab mention's browser.")
        }
        result = await findTabs(browser, (tab) => (tab.providerTabId ?? tab.id) === mention.tabId)
        const tab = result.found[0]
        if (tab && (tab.title !== mention.title || tab.url !== mention.url)) {
          throw new Error(
            "Stale tab mention: the tab's title or URL has changed since it was mentioned."
          )
        }
      } else {
        if (!URL.canParse(reference.url)) throw new Error("getTab requires an absolute URL.")
        if (!options.browser) throw new Error("getTab({ url }) requires an explicit browser.")
        browser = await select(options)
        const managed = await browser.tabs.list()
        const open = (await browser.user?.openTabs()) ?? []
        const unique = new Map([...open, ...managed].map((tab) => [tab.id, tab]))
        result = { found: [...unique.values()].filter((tab) => tab.url === reference.url), managed }
      }
      const first = result.found[0]
      if (!first) throw new Error(`Tab not found in browser ${browser.browserId}.`)
      if (result.found.length > 1) {
        throw new Error(
          `Several tabs match in browser ${browser.browserId}: ${JSON.stringify(result.found)}`
        )
      }
      const tab = await take(browser, result.managed, first)
      if (first.url && NEW_TAB_URLS.has(first.url)) {
        // A new-tab page has nothing to read; navigate with goto().
        writeText(JSON.stringify({ ...first, browserId: browser.browserId }))
        return bindTab(tab)
      }
      return enter(tab)
    },

    async listBrowsers(options: ObservationOptions = {}): Promise<BrowserInfo[]> {
      const list = await browsers.list()
      if (options.emit !== false) writeText(JSON.stringify(list))
      return list
    },

    async listTabs(options: ObservationOptions & { browser?: string } = {}) {
      const targets = options.browser
        ? [await browsers.get(options.browser)]
        : await Promise.all((await browsers.list()).map((info) => browsers.get(info.id)))
      const tabs = (
        await Promise.all(
          targets.map(async (browser) =>
            (await browser.tabs.list()).map((tab) => ({ ...tab, browserId: browser.browserId }))
          )
        )
      ).flat()
      if (options.emit !== false) writeText(JSON.stringify(tabs))
      return tabs
    },
  }
}
