import { type BrowserMember, supports } from "../browser/members.ts"
import type {
  BrowserBackend,
  BrowserInfo,
  ClipboardItem,
  DialogInfo,
  EventHandleInfo,
  LogEntry,
  TabInfo,
  UserTabInfo,
  WireImage,
} from "../browser/types.ts"
import type { CuaHostInfo } from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { absoluteUrl, call, decodeBase64, emitImage, scriptSource, writeText } from "./host.ts"
import {
  chain,
  ENTER_FRAME,
  type FilterOptions,
  filterSelector,
  labelSelector,
  placeholderSelector,
  roleSelector,
  type TextMatcher,
  testIdSelector,
  textSelector,
} from "./selectors.ts"

type Point = [x: number, y: number]
type Extra = { tab?: string; selector?: string; handle?: string }
type Invoke = (member: BrowserMember, args: readonly unknown[], extra?: Extra) => Promise<unknown>
type AXMode = "state" | "screenshot" | "both"
type AXStateOptions = { disableDiffing?: boolean }
type EvaluateFunction = string | ((...args: never[]) => unknown)

const bytes = (image: WireImage): Uint8Array => decodeBase64(image.dataBase64)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Drops trailing `undefined` arguments, which the member schemas treat as omitted. */
const trim = (args: readonly unknown[]) => {
  const result = [...args]
  while (result.length > 0 && result.at(-1) === undefined) result.pop()
  return result
}

const serializeUrl = (url: string | RegExp) =>
  url instanceof RegExp ? { flags: url.flags, source: url.source } : url

/** What a tab's `ax.get` returns, before the runtime renders it. */
type AXResult = { state?: string; screenshot?: WireImage }

/** The accessibility API of a tab: numeric element indices from its latest state. */
class AXAPI {
  readonly #invoke: Invoke
  readonly #history: SnapshotHistory
  readonly #key: string

  constructor(invoke: Invoke, history: SnapshotHistory, key: string) {
    this.#invoke = invoke
    this.#history = history
    this.#key = key
  }

  get(mode?: "state", options?: AXStateOptions): Promise<string>
  get(mode: "screenshot"): Promise<Uint8Array>
  get(mode: "both", options?: AXStateOptions): Promise<{ state: string; screenshot?: Uint8Array }>
  async get(
    mode: AXMode = "state",
    options: AXStateOptions = {}
  ): Promise<string | Uint8Array | { state: string; screenshot?: Uint8Array }> {
    const result = (await this.#invoke("ax.get", [mode])) as AXResult
    const state =
      result.state === undefined
        ? undefined
        : this.#history.render(this.#key, "this tab", result.state, options.disableDiffing)
    if (mode === "screenshot") return bytes(result.screenshot as WireImage)
    if (mode === "state") return state ?? ""
    return {
      state: state ?? "",
      ...(result.screenshot ? { screenshot: bytes(result.screenshot) } : {}),
    }
  }

  async write(mode: AXMode = "state", options: AXStateOptions = {}): Promise<void> {
    const result = (await this.#invoke("ax.get", [mode])) as AXResult
    if (result.state !== undefined) {
      writeText(this.#history.render(this.#key, "this tab", result.state, options.disableDiffing))
    }
    if (result.screenshot) await emitImage(result.screenshot)
  }

  /** Forgets the last state, so the next one is shown in full. */
  reset(): void {
    this.#history.forget(this.#key)
  }

  async click(target: number | Point, options?: { mouseButton?: string; clickCount?: number }) {
    await this.#invoke("ax.click", trim([target, options]))
  }
  async drag(from: Point, to: Point) {
    await this.#invoke("ax.drag", [from, to])
  }
  async paste(elementIndex: number | null, text: string, options?: { format?: string }) {
    await this.#invoke("ax.paste", trim([elementIndex, text, options]))
  }
  async performSecondaryAction(elementIndex: number, action: string) {
    await this.#invoke("ax.performSecondaryAction", [elementIndex, action])
  }
  async pressKey(elementIndex: number | null, key: string) {
    await this.#invoke("ax.pressKey", [elementIndex, key])
  }
  async scroll(target: number | Point, direction: string, pages?: number) {
    await this.#invoke("ax.scroll", trim([target, direction, pages]))
  }
  async selectText(
    elementIndex: number,
    text: string,
    options?: { prefix?: string; suffix?: string; selectionType?: string }
  ) {
    await this.#invoke("ax.selectText", trim([elementIndex, text, options]))
  }
  async setValue(elementIndex: number, value: string) {
    await this.#invoke("ax.setValue", [elementIndex, value])
  }
  async typeText(elementIndex: number | null, text: string) {
    await this.#invoke("ax.typeText", [elementIndex, text])
  }
}

/** Coordinate input in the current viewport, with OpenAI's computer-use action shapes. */
class CUAAPI {
  readonly #invoke: Invoke
  constructor(invoke: Invoke) {
    this.#invoke = invoke
  }
  async click(options: { x: number; y: number; button?: number; keypress?: string[] }) {
    await this.#invoke("cua.click", [options])
  }
  async double_click(options: { x: number; y: number; keypress?: string[] }) {
    await this.#invoke("cua.double_click", [options])
  }
  async drag(options: { path: { x: number; y: number }[]; keys?: string[] }) {
    await this.#invoke("cua.drag", [options])
  }
  async keypress(options: { keys: string[] }) {
    await this.#invoke("cua.keypress", [options])
  }
  async move(options: { x: number; y: number; keys?: string[] }) {
    await this.#invoke("cua.move", [options])
  }
  async scroll(options: {
    x: number
    y: number
    scrollX: number
    scrollY: number
    keypress?: string[]
  }) {
    await this.#invoke("cua.scroll", [options])
  }
  async type(options: { text: string }) {
    await this.#invoke("cua.type", [options])
  }
}

/** DOM-based input on node IDs from the visible DOM. */
class DomCUAAPI {
  readonly #invoke: Invoke
  constructor(invoke: Invoke) {
    this.#invoke = invoke
  }
  get_visible_dom(): Promise<unknown> {
    return this.#invoke("dom.get_visible_dom", [])
  }
  async click(options: { node_id: string }) {
    await this.#invoke("dom.click", [options])
  }
  async double_click(options: { node_id: string }) {
    await this.#invoke("dom.double_click", [options])
  }
  async keypress(options: { keys: string[] }) {
    await this.#invoke("dom.keypress", [options])
  }
  async scroll(options: { node_id?: string; x: number; y: number }) {
    await this.#invoke("dom.scroll", [options])
  }
  async type(options: { text: string }) {
    await this.#invoke("dom.type", [options])
  }
}

/** Builds locators; shared by pages, frames, and locators themselves. */
abstract class LocatorScope {
  protected readonly invoke: Invoke
  protected readonly scope: string | undefined

  constructor(invoke: Invoke, scope: string | undefined) {
    this.invoke = invoke
    this.scope = scope
  }

  locator(selector: string | PlaywrightLocator, options: FilterOptions = {}): PlaywrightLocator {
    const inner = typeof selector === "string" ? selector : selector.selector
    return new PlaywrightLocator(this.invoke, chain(this.scope, inner, filterSelector(options)))
  }
  getByRole(
    role: string,
    options: { name?: TextMatcher; exact?: boolean } = {}
  ): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.scope, roleSelector(role, options)))
  }
  getByText(text: TextMatcher, options: { exact?: boolean } = {}): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.scope, textSelector(text, options.exact)))
  }
  getByLabel(text: TextMatcher, options: { exact?: boolean } = {}): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.scope, labelSelector(text, options.exact)))
  }
  getByPlaceholder(text: TextMatcher, options: { exact?: boolean } = {}): PlaywrightLocator {
    return new PlaywrightLocator(
      this.invoke,
      chain(this.scope, placeholderSelector(text, options.exact))
    )
  }
  getByTestId(testId: string): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.scope, testIdSelector(testId)))
  }
  frameLocator(frameSelector: string): PlaywrightFrameLocator {
    return new PlaywrightFrameLocator(this.invoke, chain(this.scope, frameSelector, ENTER_FRAME))
  }
}

export class PlaywrightFrameLocator extends LocatorScope {}

type TimeoutOptions = { timeoutMs?: number }
type ClickOptions = TimeoutOptions & { button?: string; force?: boolean; modifiers?: string[] }

export class PlaywrightLocator extends LocatorScope {
  readonly selector: string

  constructor(invoke: Invoke, selector: string) {
    super(invoke, selector)
    this.selector = selector
  }

  #do(member: BrowserMember, args: readonly unknown[] = []): Promise<unknown> {
    return this.invoke(member, trim(args), { selector: this.selector })
  }

  first(): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.selector, "nth=0"))
  }
  last(): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.selector, "nth=-1"))
  }
  nth(index: number): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.selector, `nth=${index}`))
  }
  filter(options: FilterOptions = {}): PlaywrightLocator {
    return new PlaywrightLocator(this.invoke, chain(this.selector, filterSelector(options)))
  }
  and(locator: PlaywrightLocator): PlaywrightLocator {
    return new PlaywrightLocator(
      this.invoke,
      chain(this.selector, `internal:and=${JSON.stringify(locator.selector)}`)
    )
  }
  or(locator: PlaywrightLocator): PlaywrightLocator {
    return new PlaywrightLocator(
      this.invoke,
      chain(this.selector, `internal:or=${JSON.stringify(locator.selector)}`)
    )
  }
  async all(): Promise<PlaywrightLocator[]> {
    const count = (await this.#do("locator.count")) as number
    return Array.from({ length: count }, (_, index) => this.nth(index))
  }
  count(): Promise<number> {
    return this.#do("locator.count") as Promise<number>
  }
  allTextContents(options?: TimeoutOptions): Promise<string[]> {
    return this.#do("locator.allTextContents", [options]) as Promise<string[]>
  }
  /** Saves the media or file the element points to and returns the saved path. */
  downloadMedia(options?: TimeoutOptions): Promise<string> {
    return this.#do("locator.downloadMedia", [options]) as Promise<string>
  }
  textContent(options?: TimeoutOptions): Promise<string | null> {
    return this.#do("locator.textContent", [options]) as Promise<string | null>
  }
  innerText(options?: TimeoutOptions): Promise<string> {
    return this.#do("locator.innerText", [options]) as Promise<string>
  }
  getAttribute(name: string, options?: TimeoutOptions): Promise<string | null> {
    return this.#do("locator.getAttribute", [name, options]) as Promise<string | null>
  }
  isEnabled(): Promise<boolean> {
    return this.#do("locator.isEnabled") as Promise<boolean>
  }
  isVisible(): Promise<boolean> {
    return this.#do("locator.isVisible") as Promise<boolean>
  }
  async waitFor(options?: TimeoutOptions & { state?: string }): Promise<void> {
    await this.#do("locator.waitFor", [options])
  }
  evaluate(fn: EvaluateFunction, arg?: unknown, options?: TimeoutOptions): Promise<unknown> {
    return this.#do("locator.evaluate", [scriptSource(fn), arg ?? null, options])
  }
  evaluateAll(fn: EvaluateFunction, arg?: unknown, options?: TimeoutOptions): Promise<unknown> {
    return this.#do("locator.evaluateAll", [scriptSource(fn), arg ?? null, options])
  }
  async click(options?: ClickOptions): Promise<void> {
    await this.#do("locator.click", [options])
  }
  async dblclick(options?: ClickOptions): Promise<void> {
    await this.#do("locator.dblclick", [options])
  }
  async fill(value: string, options?: TimeoutOptions): Promise<void> {
    await this.#do("locator.fill", [value, options])
  }
  async type(value: string, options?: TimeoutOptions): Promise<void> {
    await this.#do("locator.type", [value, options])
  }
  async pressSequentially(value: string, options?: TimeoutOptions): Promise<void> {
    await this.#do("locator.pressSequentially", [value, options])
  }
  async press(key: string, options?: TimeoutOptions): Promise<void> {
    await this.#do("locator.press", [key, options])
  }
  async check(options?: TimeoutOptions & { force?: boolean }): Promise<void> {
    await this.#do("locator.check", [options])
  }
  async uncheck(options?: TimeoutOptions & { force?: boolean }): Promise<void> {
    await this.#do("locator.uncheck", [options])
  }
  async setChecked(
    checked: boolean,
    options?: TimeoutOptions & { force?: boolean }
  ): Promise<void> {
    await this.#do("locator.setChecked", [checked, options])
  }
  selectOption(
    value: string | { value?: string; label?: string; index?: number } | (string | object)[],
    options?: TimeoutOptions
  ): Promise<string[]> {
    return this.#do("locator.selectOption", [
      Array.isArray(value) ? value : [value],
      options,
    ]) as Promise<string[]>
  }
}

class PlaywrightDownload {
  readonly #invoke: Invoke
  readonly #handle: string
  constructor(invoke: Invoke, handle: string) {
    this.#invoke = invoke
    this.#handle = handle
  }
  path(options?: TimeoutOptions): Promise<string | null> {
    return this.#invoke("download.path", trim([options]), { handle: this.#handle }) as Promise<
      string | null
    >
  }
}

class PlaywrightFileChooser {
  readonly #invoke: Invoke
  readonly #handle: string
  readonly #multiple: boolean
  constructor(invoke: Invoke, handle: string, multiple: boolean) {
    this.#invoke = invoke
    this.#handle = handle
    this.#multiple = multiple
  }
  isMultiple(): boolean {
    return this.#multiple
  }
  async setFiles(files: string | string[], options?: TimeoutOptions): Promise<void> {
    await this.#invoke(
      "fileChooser.setFiles",
      trim([Array.isArray(files) ? files : [files], options]),
      {
        handle: this.#handle,
      }
    )
  }
}

type LoadState = "load" | "domcontentloaded" | "networkidle"

export class PlaywrightAPI extends LocatorScope {
  constructor(invoke: Invoke) {
    super(invoke, undefined)
  }
  domSnapshot(): Promise<string> {
    return this.invoke("playwright.domSnapshot", []) as Promise<string>
  }
  elementInfo(options: {
    x: number
    y: number
    includeNonInteractable?: boolean
  }): Promise<unknown> {
    return this.invoke("playwright.elementInfo", [options])
  }
  async elementScreenshot(options: { x: number; y: number; includeNonInteractable?: boolean }) {
    return bytes((await this.invoke("playwright.elementScreenshot", [options])) as WireImage)
  }
  evaluate(fn: EvaluateFunction, arg?: unknown, options?: TimeoutOptions): Promise<unknown> {
    return this.invoke("playwright.evaluate", trim([scriptSource(fn), arg ?? null, options]))
  }
  async expectNavigation<T>(
    action: () => Promise<T>,
    options: TimeoutOptions & { url?: string | RegExp; waitUntil?: LoadState } = {}
  ): Promise<T> {
    const before = (await this.invoke("playwright.navigationCount", [])) as number
    const result = await action()
    const deadline = Date.now() + (options.timeoutMs ?? 30_000)
    while (((await this.invoke("playwright.navigationCount", [])) as number) <= before) {
      if (Date.now() > deadline) throw new Error("The action did not navigate.")
      await sleep(100)
    }
    const timeoutMs = Math.max(1_000, deadline - Date.now())
    if (options.url !== undefined) await this.waitForURL(options.url, { timeoutMs })
    await this.waitForLoadState({ state: options.waitUntil ?? "load", timeoutMs })
    return result
  }
  async waitForEvent(
    event: "download" | "filechooser",
    options?: TimeoutOptions
  ): Promise<PlaywrightDownload | PlaywrightFileChooser> {
    const info = (await this.invoke(
      "playwright.waitForEvent",
      trim([event, options])
    )) as EventHandleInfo
    return info.kind === "download"
      ? new PlaywrightDownload(this.invoke, info.handle)
      : new PlaywrightFileChooser(this.invoke, info.handle, info.isMultiple)
  }
  async waitForLoadState(options?: { state?: LoadState; timeoutMs?: number }): Promise<void> {
    await this.invoke("playwright.waitForLoadState", trim([options]))
  }
  async waitForTimeout(timeoutMs: number): Promise<void> {
    await sleep(Math.min(Math.max(0, timeoutMs), 60_000))
  }
  async waitForURL(
    url: string | RegExp,
    options?: TimeoutOptions & { waitUntil?: LoadState | "commit" }
  ): Promise<void> {
    await this.invoke("playwright.waitForURL", trim([serializeUrl(url), options]))
  }
}

class TabClipboardAPI {
  readonly #invoke: Invoke
  constructor(invoke: Invoke) {
    this.#invoke = invoke
  }
  read(): Promise<ClipboardItem[]> {
    return this.#invoke("clipboard.read", []) as Promise<ClipboardItem[]>
  }
  readText(): Promise<string> {
    return this.#invoke("clipboard.readText", []) as Promise<string>
  }
  async write(items: ClipboardItem[]): Promise<void> {
    await this.#invoke("clipboard.write", [items])
  }
  async writeText(text: string): Promise<void> {
    await this.#invoke("clipboard.writeText", [text])
  }
}

/** Exports of the tab's content to files the device saves. */
class TabContentAPI {
  readonly #invoke: Invoke
  constructor(invoke: Invoke) {
    this.#invoke = invoke
  }
  /** Saves the Google Docs, Sheets, or Slides document the tab shows; returns the file path. */
  exportGsuite(type: "pdf" | "md" | "xlsx" | "csv" | "docx" | "pptx"): Promise<string> {
    return this.#invoke("content.exportGsuite", [type]) as Promise<string>
  }
  /** Saves the transcript of the YouTube video the tab shows; returns the file path. */
  exportYouTubeTranscript(): Promise<string> {
    return this.#invoke("content.exportYouTubeTranscript", []) as Promise<string>
  }
}

class TabDevAPI {
  readonly #invoke: Invoke
  constructor(invoke: Invoke) {
    this.#invoke = invoke
  }
  logs(options?: { filter?: string; levels?: string[]; limit?: number }): Promise<LogEntry[]> {
    return this.#invoke("dev.logs", trim([options])) as Promise<LogEntry[]>
  }
}

/** Optional capabilities a browser or tab advertises, called by method name. */
class CapabilityCollection {
  readonly #invoke: Invoke
  readonly #list: BrowserMember
  readonly #call: BrowserMember
  readonly #onUse: ((id: string) => void) | undefined
  constructor(
    invoke: Invoke,
    list: BrowserMember,
    call: BrowserMember,
    onUse?: (id: string) => void
  ) {
    this.#invoke = invoke
    this.#list = list
    this.#call = call
    this.#onUse = onUse
  }
  list(): Promise<{ id: string; description: string }[]> {
    return this.#invoke(this.#list, []) as Promise<{ id: string; description: string }[]>
  }
  async get(id: string): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>> {
    const listed = await this.list()
    if (!listed.some((capability) => capability.id === id)) {
      throw new Error(
        `Capability ${id} is not available. Available: ${listed.map((item) => item.id).join(", ") || "none"}.`
      )
    }
    this.#onUse?.(id)
    return new Proxy(
      {},
      {
        get: (_, method) =>
          typeof method === "string"
            ? (...args: unknown[]) => this.#invoke(this.#call, [id, method, args])
            : undefined,
      }
    )
  }
}

type DialogHandle = DialogInfo & { accept?(text?: string): Promise<void>; dismiss(): Promise<void> }

export class Tab {
  readonly id: string
  readonly browserId: string
  readonly ax?: AXAPI
  readonly cua?: CUAAPI
  readonly dom_cua?: DomCUAAPI
  readonly playwright: PlaywrightAPI
  readonly clipboard?: TabClipboardAPI
  readonly dev?: TabDevAPI
  readonly content?: TabContentAPI
  readonly capabilities?: CapabilityCollection
  readonly goto?: (url: string) => Promise<void>
  readonly back?: () => Promise<void>
  readonly forward?: () => Promise<void>
  readonly reload?: () => Promise<void>
  readonly close?: () => Promise<void>
  readonly getJsDialog?: () => Promise<DialogHandle | undefined>
  readonly markDeliverable?: () => Promise<void>
  readonly markHandoff?: () => Promise<void>
  readonly requestManualHandoff?: (reason?: string) => Promise<void>
  readonly #invoke: Invoke

  constructor(browser: BrowserRef, info: TabInfo, history: SnapshotHistory) {
    this.id = info.id
    this.browserId = browser.id
    const invoke: Invoke = (member, args, extra = {}) =>
      browser.invoke(member, args, { ...extra, tab: info.id })
    this.#invoke = invoke
    const has = (member: BrowserMember) => supports(browser.type, member)
    const plain = (member: BrowserMember) => async () => {
      await invoke(member, [])
    }
    this.playwright = new PlaywrightAPI(invoke)
    if (has("ax.get")) this.ax = new AXAPI(invoke, history, `${browser.id}:${info.id}`)
    if (has("cua.click")) this.cua = new CUAAPI(invoke)
    if (has("dom.click")) this.dom_cua = new DomCUAAPI(invoke)
    if (has("clipboard.read")) this.clipboard = new TabClipboardAPI(invoke)
    if (has("dev.logs")) this.dev = new TabDevAPI(invoke)
    if (has("content.exportGsuite")) this.content = new TabContentAPI(invoke)
    if (has("tab.capabilities")) {
      this.capabilities = new CapabilityCollection(invoke, "tab.capabilities", "tab.capability")
    }
    if (has("tab.goto")) {
      this.goto = async (url) => {
        await invoke("tab.goto", [absoluteUrl(url)])
      }
    }
    if (has("tab.back")) this.back = plain("tab.back")
    if (has("tab.forward")) this.forward = plain("tab.forward")
    if (has("tab.reload")) this.reload = plain("tab.reload")
    if (has("tab.close")) {
      this.close = async () => {
        await invoke("tab.close", [])
        history.forget(`${browser.id}:${info.id}`)
      }
    }
    if (has("tab.markDeliverable")) this.markDeliverable = plain("tab.markDeliverable")
    if (has("tab.markHandoff")) this.markHandoff = plain("tab.markHandoff")
    if (has("tab.requestManualHandoff")) {
      this.requestManualHandoff = async (reason) => {
        await invoke("tab.requestManualHandoff", trim([reason]))
      }
    }
    if (has("tab.getJsDialog")) {
      this.getJsDialog = async () => {
        const dialog = (await invoke("tab.getJsDialog", [])) as DialogInfo | null
        if (!dialog) return undefined
        return {
          ...dialog,
          ...(dialog.type === "confirm" || dialog.type === "prompt"
            ? {
                accept: async (text?: string) => {
                  await invoke("dialog.accept", trim([text]))
                },
              }
            : {}),
          dismiss: async () => {
            await invoke("dialog.dismiss", [])
          },
        }
      }
    }
  }

  async title(): Promise<string | undefined> {
    return ((await this.#invoke("tab.info", [])) as { title?: string }).title
  }
  async url(): Promise<string | undefined> {
    return ((await this.#invoke("tab.info", [])) as { url?: string }).url
  }
  async screenshot(options?: { fullPage?: boolean; clip?: object }): Promise<Uint8Array> {
    return bytes((await this.#invoke("tab.screenshot", trim([options]))) as WireImage)
  }
}

/** What a tab needs from its browser. */
type BrowserRef = { readonly id: string; readonly type: BrowserBackend; readonly invoke: Invoke }

class Tabs {
  readonly #browser: BrowserRef
  readonly #history: SnapshotHistory
  readonly new?: () => Promise<Tab>
  readonly selected?: () => Promise<Tab | undefined>

  constructor(browser: BrowserRef, history: SnapshotHistory) {
    this.#browser = browser
    this.#history = history
    if (supports(browser.type, "tabs.new")) {
      this.new = async () => this.#bind((await browser.invoke("tabs.new", [])) as TabInfo)
    }
    if (supports(browser.type, "tabs.selected")) {
      this.selected = async () => {
        const info = (await browser.invoke("tabs.selected", [])) as TabInfo | null
        return info ? this.#bind(info) : undefined
      }
    }
  }

  list(): Promise<TabInfo[]> {
    return this.#browser.invoke("tabs.list", []) as Promise<TabInfo[]>
  }

  async get(id: string): Promise<Tab> {
    return this.#bind((await this.#browser.invoke("tabs.get", [id])) as TabInfo)
  }

  #bind(info: TabInfo): Tab {
    return new Tab(this.#browser, info, this.#history)
  }

  /** Binds a tab the browser returned, such as a claimed user tab. */
  bind(info: TabInfo): Tab {
    return this.#bind(info)
  }
}

class BrowserUser {
  readonly #browser: BrowserRef
  readonly #tabs: Tabs
  constructor(browser: BrowserRef, tabs: Tabs) {
    this.#browser = browser
    this.#tabs = tabs
  }
  openTabs(): Promise<UserTabInfo[]> {
    return this.#browser.invoke("user.openTabs", []) as Promise<UserTabInfo[]>
  }
  async claimTab(tab: string | UserTabInfo): Promise<Tab> {
    const id = typeof tab === "string" ? tab : tab.id
    return this.#tabs.bind((await this.#browser.invoke("user.claimTab", [id])) as TabInfo)
  }
}

export class Browser {
  readonly browserId: string
  readonly name: string
  readonly type: BrowserBackend
  readonly family?: string
  readonly profileName?: string
  readonly host?: string
  readonly tabs: Tabs
  readonly user?: BrowserUser
  readonly capabilities?: CapabilityCollection
  readonly nameSession?: (name: string) => Promise<void>
  readonly #docs: Documentation

  constructor(info: BrowserInfo, history: SnapshotHistory, docs: Documentation) {
    this.browserId = info.id
    this.name = info.name
    this.type = info.type
    if (info.family) this.family = info.family
    if (info.profileName) this.profileName = info.profileName
    if (info.host) this.host = info.host
    this.#docs = docs
    const ref: BrowserRef = {
      id: info.id,
      invoke: (member, args, extra = {}) =>
        call({ args: [...args], browser: info.id, member, op: "browser.call", ...extra }),
      type: info.type,
    }
    this.tabs = new Tabs(ref, history)
    if (supports(info.type, "user.openTabs")) this.user = new BrowserUser(ref, this.tabs)
    if (supports(info.type, "browser.capabilities")) {
      this.capabilities = new CapabilityCollection(
        ref.invoke,
        "browser.capabilities",
        "browser.capability",
        (id) => docs.enterCapability("browser", id)
      )
    }
    if (supports(info.type, "browser.nameSession")) {
      this.nameSession = async (name) => {
        await ref.invoke("browser.nameSession", [name])
      }
    }
  }

  /** This browser's guidance and API reference. */
  async documentation(): Promise<string> {
    return this.#docs.browserDocumentation(this.type)
  }
}

const isLocalUrl = (url: string) => {
  try {
    const { hostname, protocol } = new URL(url)
    return (
      protocol === "file:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    )
  } catch {
    return false
  }
}

/** `agent.browsers`: finding and selecting browsers. */
export class Browsers {
  readonly #history: SnapshotHistory
  readonly #docs: Documentation

  constructor(history: SnapshotHistory, docs: Documentation) {
    this.#history = history
    this.#docs = docs
  }

  list(): Promise<BrowserInfo[]> {
    return call<BrowserInfo[]>({ op: "browsers.list" })
  }

  /** A browser by ID, by family such as `"chrome"`, or `"iab"`. */
  async get(id: string): Promise<Browser> {
    const list = await this.list()
    const exact = list.find((browser) => browser.id === id)
    if (exact) return this.#bind(exact)
    let matches = list.filter(
      (browser) =>
        browser.id.split("@")[0] === id ||
        browser.family === id ||
        browser.name.toLowerCase() === id.toLowerCase()
    )
    if (matches.length > 1) {
      const current = (await call<CuaHostInfo[]>({ op: "hosts" })).find((host) => host.current)?.id
      const local = matches.filter((browser) => browser.host === current)
      if (local.length > 0) matches = local
      // A family with several profiles open means the profile the person used last.
      const lastUsed = matches.filter((browser) => browser.lastUsed)
      if (matches.length > 1 && lastUsed.length === 1) matches = lastUsed
    }
    if (matches.length === 1 && matches[0]) return this.#bind(matches[0])
    const ids = list.map((browser) => browser.id).join(", ") || "none"
    throw new Error(
      matches.length === 0
        ? `No browser ${id} is available. Available browsers: ${ids}.`
        : `Several browsers match ${id}: ${matches.map((browser) => browser.id).join(", ")}. Use one of these IDs.`
    )
  }

  /** The built-in browser when available, else the user's browser on the current device. */
  async getDefault(): Promise<Browser> {
    const list = await this.list()
    const choice =
      list.find((browser) => browser.type === "iab") ??
      list.find((browser) => browser.type !== "mcpapps")
    if (!choice) throw new Error("No browser is available.")
    return this.#bind(choice)
  }

  /** The browser best suited to a URL: the built-in browser for local pages, else the default. */
  async getForUrl(url: string): Promise<Browser> {
    const list = await this.list()
    if (isLocalUrl(absoluteUrl(url))) {
      const iab = list.find((browser) => browser.type === "iab")
      if (iab) return this.#bind(iab)
    }
    return this.getDefault()
  }

  #bind(info: BrowserInfo): Browser {
    return new Browser(info, this.#history, this.#docs)
  }
}

export const createAgent = (history: SnapshotHistory, docs: Documentation) => ({
  browsers: new Browsers(history, docs),
  documentation: { get: async (name: string) => docs.get(name) },
})
