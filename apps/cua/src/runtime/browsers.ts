import type { BrowserFamily } from "../families.ts"
import type { CuaImage, ExternalBrowserInfo, ExternalTabInfo, PageAction } from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { absoluteUrl, call, decodeBase64, emitImage, scriptSource, writeText } from "./host.ts"
import { assertMentionCurrent, parseTabMention } from "./mentions.ts"

type Point = [x: number, y: number]
type Ref = string
type EmitOption = { emit?: boolean }
type ActionResponse = {
  readonly text?: string
  readonly image?: CuaImage
  readonly value?: unknown
  readonly notice?: string
  readonly tab?: ExternalTabInfo
}

/** A tab of the user's external browser that this task opened or claimed. */
export class ExternalTab {
  readonly id: string
  readonly browserId: BrowserFamily
  #info: ExternalTabInfo
  readonly #history: SnapshotHistory

  constructor(browserId: BrowserFamily, info: ExternalTabInfo, history: SnapshotHistory) {
    this.browserId = browserId
    this.id = info.id
    this.#info = info
    this.#history = history
  }

  url(): string {
    return this.#info.url
  }
  title(): string {
    return this.#info.title
  }

  /** Interactive elements with `@eN` refs, as changes since the last snapshot unless `full`. */
  async snapshot(options: EmitOption & { full?: boolean } = {}): Promise<string> {
    const response = await this.#act({ full: options.full, type: "snapshot" })
    const header = `Tab ${this.id} in ${this.browserId}: ${response.tab?.title ?? this.title()} — ${response.tab?.url ?? this.url()}`
    const body = this.#history.render(
      `browser:${this.browserId}:${this.id}`,
      "this tab",
      response.text ?? "",
      options.full
    )
    const text = `${header}\n${body}`
    if (options.emit !== false) writeText(text)
    return text
  }

  /** A viewport screenshot; `annotate` numbers the interactive elements with their refs. */
  async screenshot(
    options: EmitOption & { fullPage?: boolean; annotate?: boolean } = {}
  ): Promise<Uint8Array> {
    const response = await this.#act({
      annotate: options.annotate,
      fullPage: options.fullPage,
      type: "screenshot",
    })
    if (!response.image) throw new Error("The browser returned no screenshot.")
    if (options.emit !== false) {
      await emitImage(response.image)
      if (response.text) writeText(response.text)
    }
    return decodeBase64(response.image.dataBase64)
  }

  async click(
    target: Ref | Point,
    options: { button?: "left" | "right" | "middle"; double?: boolean } = {}
  ): Promise<void> {
    await this.#act({ ...options, target, type: "click" })
  }
  async fill(ref: Ref, value: string): Promise<void> {
    await this.#act({ ref, type: "fill", value })
  }
  async type(text: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#act({ ...options, text, type: "type" })
  }
  /** Presses a key or chord such as `"Enter"` or `"Control+a"`. */
  async press(key: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#act({ ...options, key, type: "press" })
  }
  async hover(target: Ref | Point): Promise<void> {
    await this.#act({ target, type: "hover" })
  }
  async select(ref: Ref, ...values: string[]): Promise<void> {
    await this.#act({ ref, type: "select", values })
  }
  async check(ref: Ref, checked = true): Promise<void> {
    await this.#act({ checked, ref, type: "check" })
  }
  async scroll(
    direction: "up" | "down" | "left" | "right",
    options: { pixels?: number; ref?: Ref } = {}
  ): Promise<void> {
    await this.#act({ ...options, direction, type: "scroll" })
  }
  async drag(from: Ref, to: Ref): Promise<void> {
    await this.#act({ from, to, type: "drag" })
  }
  async upload(ref: Ref, paths: string[]): Promise<void> {
    await this.#act({ paths, ref, type: "upload" })
  }
  /** Reads `text`, `html`, or `value` of an element, or the page `title` or `url`. */
  async get(what: "text" | "html" | "value" | "title" | "url", ref?: Ref): Promise<string> {
    return String((await this.#act({ ref, type: "get", what })).value ?? "")
  }
  /** Runs JavaScript in the page and returns its result. */
  async evaluate(script: string | ((...args: never[]) => unknown)): Promise<unknown> {
    const source = scriptSource(script)
    const expression = typeof script === "function" ? `(${source})()` : source
    return (await this.#act({ script: expression, type: "evaluate" })).value
  }
  async waitFor(
    condition: { text: string } | { url: string } | { selector: string } | { ms: number }
  ): Promise<void> {
    await this.#act({ ...condition, type: "wait" })
  }
  async goto(url: string): Promise<void> {
    await this.#act({ type: "goto", url: absoluteUrl(url) })
  }
  async back(): Promise<void> {
    await this.#act({ type: "back" })
  }
  async forward(): Promise<void> {
    await this.#act({ type: "forward" })
  }
  async reload(): Promise<void> {
    await this.#act({ type: "reload" })
  }
  /** Accepts the page's pending alert, confirm, or prompt, optionally with prompt text. */
  async acceptDialog(text?: string): Promise<void> {
    await this.#act({ accept: true, text, type: "dialog" })
  }
  async dismissDialog(): Promise<void> {
    await this.#act({ accept: false, type: "dialog" })
  }
  /** Closes a tab this task opened. A claimed user tab is released instead. */
  async close(): Promise<void> {
    await this.#act({ type: "close" })
    this.#history.forget(`browser:${this.browserId}:${this.id}`)
  }
  async markDeliverable(): Promise<void> {
    await this.#act({ disposition: "deliverable", type: "mark" })
  }
  async markHandoff(): Promise<void> {
    await this.#act({ disposition: "handoff", type: "mark" })
  }

  async #act(action: PageAction): Promise<ActionResponse> {
    const response = await call<ActionResponse>({
      action,
      browserId: this.browserId,
      op: "browsers.act",
      tabId: this.id,
    })
    if (response.tab) this.#info = response.tab
    if (response.notice) writeText(response.notice)
    return response
  }
}

/** One of the user's external Chromium browsers. */
export class ExternalBrowser {
  readonly id: BrowserFamily
  readonly name: string
  readonly #history: SnapshotHistory

  constructor(info: ExternalBrowserInfo, history: SnapshotHistory) {
    this.id = info.id
    this.name = info.name
    this.#history = history
  }

  /** The browser's open tabs, including the user's own. */
  async tabs(options: EmitOption = {}): Promise<ExternalTabInfo[]> {
    const tabs = await call<ExternalTabInfo[]>({ browserId: this.id, op: "browsers.tabs" })
    if (options.emit !== false) writeText(JSON.stringify(tabs))
    return tabs
  }

  /** Takes control of an open tab, by an ID from `tabs()`, leaving it where the user put it. */
  async claimTab(tabId: string): Promise<ExternalTab> {
    const info = await call<ExternalTabInfo>({ browserId: this.id, op: "browsers.claim", tabId })
    return this.#enter(info)
  }

  /** Opens a new tab this task owns; it closes when the turn ends unless marked. */
  async newTab(url?: string): Promise<ExternalTab> {
    const info = await call<ExternalTabInfo>({
      browserId: this.id,
      op: "browsers.new",
      url: url ? absoluteUrl(url) : undefined,
    })
    return this.#enter(info)
  }

  async #enter(info: ExternalTabInfo): Promise<ExternalTab> {
    const tab = new ExternalTab(this.id, info, this.#history)
    this.#history.forget(`browser:${this.id}:${tab.id}`)
    await tab.snapshot()
    return tab
  }
}

export const createBrowsersApi = (history: SnapshotHistory, docs: Documentation) => {
  const get = async (id: string): Promise<ExternalBrowser> => {
    docs.enter("browsers")
    const browsers = await call<ExternalBrowserInfo[]>({ op: "browsers.list" })
    const info = browsers.find((browser) => browser.id === id)
    if (!info) {
      throw new Error(
        `Unknown external browser "${id}". Available: ${browsers.map((browser) => browser.id).join(", ") || "none"}.`
      )
    }
    if (!info.connectable) throw new Error(info.setup ?? `${info.name} is not available.`)
    return new ExternalBrowser(info, history)
  }
  return {
    async list(options: EmitOption = {}): Promise<ExternalBrowserInfo[]> {
      docs.enter("browsers")
      const browsers = await call<ExternalBrowserInfo[]>({ op: "browsers.list" })
      if (options.emit !== false) writeText(JSON.stringify(browsers))
      return browsers
    },

    get,

    /** Claims a tab the user mentioned, failing if it changed since. */
    async getTab(reference: { mention: string }): Promise<ExternalTab> {
      const mention = parseTabMention(reference.mention)
      if (mention.plugin !== "chrome" || !mention.browserId) {
        throw new Error("This mention names a built-in browser tab; use cua.iab.getTab().")
      }
      const browser = await get(mention.browserId)
      const tab = (await browser.tabs({ emit: false })).find((item) => item.id === mention.tabId)
      if (!tab) throw new Error("The mentioned tab is no longer open.")
      assertMentionCurrent(mention, tab)
      return browser.claimTab(tab.id)
    },
  }
}
