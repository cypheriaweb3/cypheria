import type { IabCommand, IabTabInfo } from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { absoluteUrl, call, decodeBase64, emitImage, scriptSource, writeText } from "./host.ts"
import { assertMentionCurrent, parseTabMention } from "./mentions.ts"

type Point = [x: number, y: number]
type Ref = string
type EmitOption = { emit?: boolean }
type Modifier = "Alt" | "Control" | "Meta" | "Shift"
type CommandResult = { result: Record<string, unknown>; notice?: string }

const pointObject = (point: Point) => ({ x: point[0], y: point[1] })
const target = (value: Ref | Point) =>
  Array.isArray(value) ? { point: pointObject(value) } : { ref: normalizeRef(value) }
const normalizeRef = (ref: Ref) => (ref.startsWith("@") ? ref : `@${ref}`)

/** A tab in Cypheria's built-in browser. Refs such as `@e12` come from its latest snapshot. */
export class IabTab {
  readonly id: string
  #info: IabTabInfo
  readonly #history: SnapshotHistory

  constructor(info: IabTabInfo, history: SnapshotHistory) {
    this.id = info.id
    this.#info = info
    this.#history = history
  }

  get kind(): "web" | "dapp" {
    return this.#info.kind
  }
  url(): string {
    return this.#info.url
  }
  title(): string {
    return this.#info.title
  }

  /** The page as an accessibility tree, as changes since the last snapshot unless `full`. */
  async snapshot(options: EmitOption & { full?: boolean } = {}): Promise<string> {
    const { result } = await this.#command("snapshot", {})
    this.#info = { ...this.#info, title: String(result.title), url: String(result.url) }
    const header = `Tab ${this.id}: ${result.title || "(untitled)"} — ${result.url}${result.truncated ? " (snapshot truncated)" : ""}`
    const body = this.#history.render(
      `iab:${this.id}`,
      "this tab",
      String(result.snapshot),
      options.full
    )
    const text = `${header}\n${body}`
    if (options.emit !== false) writeText(text)
    return text
  }

  async screenshot(options: EmitOption & { fullPage?: boolean } = {}): Promise<Uint8Array> {
    const { result } = await this.#command("screenshot", { fullPage: options.fullPage ?? false })
    const image = { dataBase64: String(result.dataBase64), mimeType: String(result.mimeType) }
    if (options.emit !== false) await emitImage(image)
    return decodeBase64(image.dataBase64)
  }

  async click(
    at: Ref | Point,
    options: { button?: "left" | "right" | "middle"; double?: boolean; modifiers?: Modifier[] } = {}
  ): Promise<void> {
    await this.#command("click", {
      ...target(at),
      button: options.button,
      doubleClick: options.double,
      modifiers: options.modifiers,
    })
  }

  async fill(ref: Ref, value: string): Promise<void> {
    await this.#command("fill", { ref: normalizeRef(ref), value })
  }

  /** Types into `ref`, or into the focused element. */
  async type(text: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#command("type", {
      text,
      ...(options.ref ? { ref: normalizeRef(options.ref) } : {}),
    })
  }

  /** Presses a key such as `"Enter"`, `"Escape"`, or `"ArrowDown"`. */
  async press(key: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#command("keypress", {
      key,
      ...(options.ref ? { ref: normalizeRef(options.ref) } : {}),
    })
  }

  async hover(at: Ref | Point): Promise<void> {
    await this.#command("hover", target(at))
  }

  async select(ref: Ref, value: string): Promise<void> {
    await this.#command("select", { ref: normalizeRef(ref), value })
  }

  async drag(from: Ref | Point, to: Ref | Point): Promise<void> {
    await this.#command("drag", {
      ...(Array.isArray(from)
        ? { sourcePoint: pointObject(from) }
        : { sourceRef: normalizeRef(from) }),
      ...(Array.isArray(to) ? { targetPoint: pointObject(to) } : { targetRef: normalizeRef(to) }),
    })
  }

  async scroll(options: { dx?: number; dy: number; ref?: Ref }): Promise<void> {
    await this.#command("scroll", {
      deltaX: options.dx ?? 0,
      deltaY: options.dy,
      ...(options.ref ? { ref: normalizeRef(options.ref) } : {}),
    })
  }

  /** Sets files on a file input; paths must be inside the task's working directory. */
  async upload(ref: Ref, filePaths: string[]): Promise<void> {
    await this.#command("upload", { filePaths, ref: normalizeRef(ref) })
  }

  /** Runs a function in the page and returns its JSON result. With `ref`, the element is its argument. */
  async evaluate(
    script: string | ((...args: never[]) => unknown),
    options: { ref?: Ref } = {}
  ): Promise<unknown> {
    const { result } = await this.#command("evaluate", {
      function: scriptSource(script),
      ...(options.ref ? { ref: normalizeRef(options.ref) } : {}),
    })
    const json = String(result.resultJson)
    try {
      return JSON.parse(json)
    } catch {
      return json
    }
  }

  async waitFor(condition: { text: string } | { url: string }, timeoutMs?: number): Promise<void> {
    await this.#command("wait", { ...condition, ...(timeoutMs ? { timeoutMs } : {}) })
  }

  async logs(options: EmitOption & { maxEntries?: number } = {}): Promise<unknown> {
    const { result } = await this.#command("logs", { maxEntries: options.maxEntries ?? 50 })
    const logs = { console: result.console, network: result.network }
    if (options.emit !== false) writeText(JSON.stringify(logs))
    return logs
  }

  async resize(width: number, height: number): Promise<void> {
    await this.#command("resize", { height, width })
  }

  async goto(url: string): Promise<void> {
    const absolute = absoluteUrl(url)
    await this.#command("navigate", { url: absolute })
    this.#info = { ...this.#info, url: absolute }
  }
  async back(): Promise<void> {
    await this.#command("back", {})
  }
  async forward(): Promise<void> {
    await this.#command("forward", {})
  }
  async reload(): Promise<void> {
    await this.#command("reload", {})
  }
  async close(): Promise<void> {
    await this.#command("close_tab", {})
    this.#history.forget(`iab:${this.id}`)
  }
  /** Keeps the tab open after the turn as a result for the user. */
  async markDeliverable(): Promise<void> {
    await this.#command("mark_deliverable", {})
  }
  /** Keeps the tab open after the turn because work continues there later. */
  async markHandoff(): Promise<void> {
    await this.#command("mark_handoff", {})
  }
  /** Shows the tab to the user and waits for them to finish a step only they should do. */
  async requestHandoff(reason: string): Promise<"completed" | "dismissed"> {
    const { result } = await this.#command("request_manual_handoff", { reason })
    return result.status as "completed" | "dismissed"
  }
  async scanQr(options: { ref?: Ref } = {}): Promise<string | null> {
    const { result } = await this.#command("scan_qr", {
      ...(options.ref ? { ref: normalizeRef(options.ref) } : {}),
    })
    return result.found ? String(result.text) : null
  }
  async extractAssets(
    options: EmitOption & { kinds?: ("image" | "svg" | "font" | "stylesheet")[] } = {}
  ): Promise<unknown> {
    const { result } = await this.#command("extract_assets", {
      ...(options.kinds ? { kinds: options.kinds } : {}),
    })
    if (options.emit !== false) writeText(JSON.stringify(result.assets))
    return result.assets
  }

  async #command(command: IabCommand, args: Record<string, unknown>): Promise<CommandResult> {
    const response = await call<CommandResult>({
      args: Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)),
      command,
      op: "iab.command",
      tabId: this.id,
    })
    if (response.notice) writeText(response.notice)
    return response
  }
}

export const createIabApi = (history: SnapshotHistory, docs: Documentation) => {
  const enter = async (tab: IabTab) => {
    history.forget(`iab:${tab.id}`)
    await tab.snapshot()
    return tab
  }
  const listTabs = () => call<IabTabInfo[]>({ op: "iab.tabs" })
  return {
    async listTabs(options: EmitOption = {}): Promise<IabTabInfo[]> {
      docs.enter("iab")
      const tabs = await listTabs()
      if (options.emit !== false) writeText(JSON.stringify(tabs))
      return tabs
    },

    /** Binds an existing tab by ID, by a tab mention, or by its exact URL. */
    async getTab(reference: string | { mention: string } | { url: string }): Promise<IabTab> {
      docs.enter("iab")
      const tabs = await listTabs()
      let matches: IabTabInfo[]
      if (typeof reference === "string") {
        matches = tabs.filter((tab) => tab.id === reference)
      } else if ("mention" in reference) {
        const mention = parseTabMention(reference.mention)
        if (mention.plugin !== "browser") {
          throw new Error("This mention names an external browser tab; use cua.browsers.getTab().")
        }
        matches = tabs.filter((tab) => tab.id === mention.tabId)
        if (matches[0]) assertMentionCurrent(mention, matches[0])
      } else {
        matches = tabs.filter((tab) => tab.url === reference.url)
      }
      if (matches.length === 0) throw new Error("No matching built-in browser tab is open.")
      if (matches.length > 1) {
        throw new Error(`Several built-in browser tabs match: ${JSON.stringify(matches)}`)
      }
      return enter(new IabTab(matches[0] as IabTabInfo, history))
    },

    /** Opens a background tab: `kind: "dapp"` for a wallet-enabled dApp tab. */
    async newTab(url?: string, options: { kind?: "web" | "dapp" } = {}): Promise<IabTab> {
      docs.enter("iab")
      const info = await call<IabTabInfo>({
        kind: options.kind,
        op: "iab.new",
        url: url ? absoluteUrl(url) : undefined,
      })
      return enter(new IabTab(info, history))
    },
  }
}
