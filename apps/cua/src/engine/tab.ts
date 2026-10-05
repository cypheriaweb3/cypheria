import { realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve as resolvePath } from "node:path"

import type { BrowserMember } from "../browser/members.ts"
import type {
  ClipboardItem,
  DialogInfo,
  EventHandleInfo,
  LogEntry,
  WireImage,
} from "../browser/types.ts"
import { AxIndex, assertIndex } from "./ax.ts"
import {
  type GsuiteExportType,
  gsuiteExportUrl,
  parseGoogleDoc,
  stripInlineImages,
  type TranscriptOutcome,
  titleFilename,
  transcriptText,
  youtubeTranscriptScript,
  youtubeVideoId,
} from "./content.ts"
import { showAgentCursor } from "./cursor.ts"
import { EngineError } from "./errors.ts"
import { axButton, cuaButton, DIALOG_OPENED, PageInput, type Point } from "./input.ts"
import { parseChord, parseModifiers } from "./keys.ts"
import { PageSession } from "./page.ts"
import type { CdpTransport } from "./transport.ts"

const DEFAULT_TIMEOUT_MS = 10_000
const NAVIGATION_TIMEOUT_MS = 30_000
const SETTLE_MS = 150
const FRAME_SEPARATOR = /\s*>>\s*internal:control=enter-frame\s*>>\s*/u
const MAX_DOM_SNAPSHOT = 200_000
const MAX_MEDIA_BYTES = 512 * 1024 * 1024

const decodeDataUrl = (url: string): Uint8Array => {
  const comma = url.indexOf(",")
  const header = url.slice(5, comma)
  const body = url.slice(comma + 1)
  return new Uint8Array(
    header.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body))
  )
}

/** A file name for media from its URL, falling back to a generic name. */
const mediaFilename = (url: string): string => {
  if (url.startsWith("data:")) {
    const type = /^data:[^/;,]+\/([\w.+-]+)/u.exec(url)?.[1] ?? "bin"
    return `download.${type}`
  }
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
    return name.replace(/[\\/:*?"<>|]/gu, "_") || "download"
  } catch {
    return "download"
  }
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new EngineError("timeout", message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

/** What a backend lends a tab: its clipboard, downloads, and the working directory for uploads. */
export type TabHooks = {
  /** The browser session's virtual clipboard, shared by its tabs. */
  readonly clipboard: VirtualClipboard
  /** Whether to show the agent's pointer in the page, as in the person's own browser. */
  readonly cursor?: boolean
  /** Saves a file the agent fetched, such as media, where the browser saves downloads. */
  readonly saveFile?: (filename: string, data: Uint8Array) => Promise<string>
  /** Waits for the next download this tab starts and returns its saved path. */
  readonly waitForDownload?: (
    timeoutMs: number
  ) => Promise<{ path: string; suggestedFilename?: string }>
}

/** The call context the device passes: the Thread's working directory bounds uploads. */
export type CallContext = { readonly cwd?: string }

export type CallOptions = {
  readonly selector?: string
  readonly handle?: string
  readonly context?: CallContext
}

export class VirtualClipboard {
  items: ClipboardItem[] = []

  text(): string {
    for (const item of this.items) {
      const entry = item.entries.find((candidate) => candidate.mimeType === "text/plain")
      if (entry?.text !== undefined) return entry.text
    }
    return ""
  }
}

type Handle =
  | { readonly kind: "filechooser"; readonly backendNodeId: number; readonly isMultiple: boolean }
  | {
      readonly kind: "download"
      readonly result: Promise<{ path: string; suggestedFilename?: string }>
    }

type ElementTarget = { objectId: string; frameId: string }

/** The center of the first quad CDP reports, in top-level viewport pixels. */
const quadCenter = (quad: readonly number[]): Point => ({
  x: ((quad[0] ?? 0) + (quad[2] ?? 0) + (quad[4] ?? 0) + (quad[6] ?? 0)) / 4,
  y: ((quad[1] ?? 0) + (quad[3] ?? 0) + (quad[5] ?? 0) + (quad[7] ?? 0)) / 4,
})

/** Arguments already checked against their member's schema. */
type Validated = readonly [never, never, never, never]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toPoint = (value: readonly [number, number]): Point => ({ x: value[0], y: value[1] })

const SCROLL_DELTAS: Record<string, [number, number]> = {
  d: [0, 1],
  down: [0, 1],
  l: [-1, 0],
  left: [-1, 0],
  r: [1, 0],
  right: [1, 0],
  u: [0, -1],
  up: [0, -1],
}

/** A Playwright text matcher for `waitForURL`: an exact string, a glob, or a regular expression. */
const urlMatcher = (
  pattern: string | { source: string; flags: string }
): ((url: string) => boolean) => {
  if (typeof pattern !== "string") {
    const regex = new RegExp(pattern.source, pattern.flags)
    return (url) => regex.test(url)
  }
  if (!pattern.includes("*")) return (url) => url === pattern
  const regex = new RegExp(
    `^${pattern
      .split("**")
      .map((part) =>
        part
          .split("*")
          .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
          .join("[^/]*")
      )
      .join(".*")}$`,
    "u"
  )
  return (url) => regex.test(url)
}

/**
 * One tab driven over CDP. It implements the page-level members of the browser API: the
 * accessibility state and its element actions, coordinate input, navigation, screenshots,
 * dialogs, Playwright locators, events, the clipboard, and console logs. Tab lifecycle and the
 * browser's own members belong to the backend that owns the tab.
 */
export class CdpTab {
  readonly page: PageSession
  readonly input: PageInput
  readonly #ax = new AxIndex()
  readonly #hooks: TabHooks
  readonly #handles = new Map<string, Handle>()
  readonly #visibleDom = new Map<string, ElementTarget>()
  #handleSeq = 0

  constructor(transport: CdpTransport, platform: string, hooks: TabHooks) {
    this.page = new PageSession(transport, platform)
    this.input = new PageInput(
      transport,
      platform,
      () => this.page.dialogOpened(),
      hooks.cursor ? (point) => showAgentCursor(transport, point) : undefined
    )
    this.#hooks = hooks
  }

  dispose(): void {
    this.page.dispose()
  }

  /** The tab's title and URL. */
  async info(): Promise<{ title: string; url: string }> {
    await this.page.ready()
    if (this.page.dialog) {
      const target = await this.page.transport.send<{ targetInfo: { title: string; url: string } }>(
        "Target.getTargetInfo"
      )
      return { title: target.targetInfo.title, url: target.targetInfo.url }
    }
    return (await this.page.call("() => ({ title: document.title, url: location.href })", [])) as {
      title: string
      url: string
    }
  }

  async call(
    member: BrowserMember,
    args: readonly unknown[],
    options: CallOptions = {}
  ): Promise<unknown> {
    await this.page.ready()
    try {
      return await this.#dispatch(member, args, options)
    } catch (error) {
      // An action that opened a dialog is done; the dialog now waits for the model.
      if (error === DIALOG_OPENED) return null
      throw error
    }
  }

  async #dispatch(
    member: BrowserMember,
    args: readonly unknown[],
    options: CallOptions
  ): Promise<unknown> {
    // The Server and device validated the arguments against the member's schema.
    const a = args as unknown as Validated
    switch (member) {
      case "tab.info":
        return this.info()
      case "tab.goto":
        return this.goto(a[0])
      case "tab.back":
        return this.#history(-1)
      case "tab.forward":
        return this.#history(1)
      case "tab.reload":
        await this.page.transport.send("Page.reload")
        return this.#afterNavigation()
      case "content.exportGsuite":
        return this.#exportGsuite(a[0] as GsuiteExportType)
      case "content.exportYouTubeTranscript":
        return this.#exportYouTubeTranscript()
      case "tab.screenshot":
        return this.screenshot(a[0])
      case "tab.getJsDialog":
        return this.page.dialog ?? null
      case "tab.capabilities":
        return []
      case "tab.capability":
        throw new EngineError("unsupported", `This tab has no capability ${String(a[0])}.`)
      case "dialog.accept":
      case "dialog.dismiss":
        return this.#handleDialog(member === "dialog.accept", a[0])
      case "ax.get":
        return this.axGet(a[0] ?? "state")
      case "ax.click":
        return this.#axClick(a[0], a[1] ?? {})
      case "ax.drag":
        await this.input.drag([toPoint(a[0]), toPoint(a[1])])
        return this.#settle()
      case "ax.paste":
        return this.#paste(a[0], a[1], (a[2] as { format?: string } | undefined)?.format)
      case "ax.performSecondaryAction":
        return this.#secondaryAction(assertIndex(a[0]), a[1])
      case "ax.pressKey":
        await this.#focusIndex(a[0])
        await this.input.press(parseChord(a[1], this.page.platform))
        return this.#settle()
      case "ax.scroll":
        return this.#axScroll(a[0], a[1], a[2] ?? 1)
      case "ax.selectText":
        return this.#selectText(assertIndex(a[0]), a[1], a[2] ?? {})
      case "ax.setValue":
        return this.#setValue(assertIndex(a[0]), a[1])
      case "ax.typeText":
        await this.#focusIndex(a[0])
        await this.input.type(a[1])
        return this.#settle()
      case "cua.click": {
        const options = a[0] as { x: number; y: number; button?: number; keypress?: string[] }
        await this.input.click(options, {
          button: cuaButton(options.button),
          modifiers: parseModifiers(options.keypress, this.page.platform),
        })
        return this.#settle()
      }
      case "cua.double_click": {
        const options = a[0] as { x: number; y: number; keypress?: string[] }
        await this.input.click(options, {
          clickCount: 2,
          modifiers: parseModifiers(options.keypress, this.page.platform),
        })
        return this.#settle()
      }
      case "cua.drag": {
        const options = a[0] as { path: Point[]; keys?: string[] }
        await this.input.drag(options.path, parseModifiers(options.keys, this.page.platform))
        return this.#settle()
      }
      case "cua.keypress":
      case "dom.keypress":
        return this.#keypress((a[0] as { keys: string[] }).keys)
      case "cua.move": {
        const options = a[0] as { x: number; y: number; keys?: string[] }
        await this.input.move(options, parseModifiers(options.keys, this.page.platform))
        return null
      }
      case "cua.scroll": {
        const options = a[0] as {
          x: number
          y: number
          scrollX: number
          scrollY: number
          keypress?: string[]
        }
        await this.input.wheel(
          options,
          { x: options.scrollX, y: options.scrollY },
          parseModifiers(options.keypress, this.page.platform)
        )
        return this.#settle()
      }
      case "cua.type":
      case "dom.type":
        await this.input.type((a[0] as { text: string }).text)
        return this.#settle()
      case "dom.get_visible_dom":
        return this.#visibleDomTree()
      case "dom.click":
      case "dom.double_click": {
        const target = this.#domNode((a[0] as { node_id: string }).node_id)
        const point = await this.#clickPoint(target)
        await this.input.click(point, { clickCount: member === "dom.double_click" ? 2 : 1 })
        return this.#settle()
      }
      case "dom.scroll":
        return this.#domScroll(a[0])
      case "playwright.domSnapshot":
        return this.#domSnapshot()
      case "playwright.elementInfo":
        return this.#elementInfo(a[0])
      case "playwright.elementScreenshot":
        return this.#elementScreenshot(a[0])
      case "playwright.evaluate":
        return this.#evaluate(a[0], a[1])
      case "playwright.navigationCount":
        return this.page.navigations
      case "playwright.waitForEvent":
        return this.#waitForEvent(a[0], (a[1] as { timeoutMs?: number } | undefined)?.timeoutMs)
      case "playwright.waitForLoadState":
        return this.#waitForLoadState(a[0] ?? {})
      case "playwright.waitForURL":
        return this.#waitForURL(a[0], a[1] ?? {})
      case "download.path":
        return this.#downloadPath(options.handle as string)
      case "fileChooser.setFiles":
        return this.#setFiles(options.handle as string, a[0], options.context)
      case "clipboard.read":
        return this.#hooks.clipboard.items
      case "clipboard.readText":
        return this.#hooks.clipboard.text()
      case "clipboard.write":
        this.#hooks.clipboard.items = a[0]
        return null
      case "clipboard.writeText":
        this.#hooks.clipboard.items = [{ entries: [{ mimeType: "text/plain", text: a[0] }] }]
        return null
      case "dev.logs":
        return this.#logs(a[0] ?? {})
      default:
        if (member.startsWith("locator.")) {
          return this.#locator(member, options.selector as string, args, options.context)
        }
        throw new EngineError("unsupported", `${member} is not available on this tab.`)
    }
  }

  // Navigation

  async goto(url: string): Promise<null> {
    const response = await this.page.transport.send<{ errorText?: string }>("Page.navigate", {
      url,
    })
    if (response.errorText && response.errorText !== "net::ERR_ABORTED") {
      throw new EngineError(
        "navigation_failed",
        `Navigation to ${url} failed: ${response.errorText}.`
      )
    }
    return this.#afterNavigation()
  }

  async #history(step: -1 | 1): Promise<null> {
    const history = await this.page.transport.send<{
      currentIndex: number
      entries: { id: number }[]
    }>("Page.getNavigationHistory")
    const entry = history.entries[history.currentIndex + step]
    if (!entry) {
      throw new EngineError(
        "no_history",
        `The tab has no page to go ${step < 0 ? "back" : "forward"} to.`
      )
    }
    await this.page.transport.send("Page.navigateToHistoryEntry", { entryId: entry.id })
    return this.#afterNavigation()
  }

  async #afterNavigation(): Promise<null> {
    await wait(SETTLE_MS)
    await this.page
      .waitFor(
        () => this.page.hasLifecycle("DOMContentLoaded") || this.page.dialog !== undefined,
        NAVIGATION_TIMEOUT_MS,
        "the page to load"
      )
      .catch(() => undefined)
    this.#ax.reset()
    return null
  }

  async #settle(): Promise<null> {
    await wait(SETTLE_MS)
    return null
  }

  // Observation

  async screenshot(
    options: {
      fullPage?: boolean
      clip?: { x: number; y: number; width: number; height: number }
    } = {}
  ): Promise<WireImage> {
    if (!options.fullPage && !options.clip && this.page.transport.captureViewport) {
      const image = await this.page.transport.captureViewport()
      return {
        dataBase64: Buffer.from(image.data).toString("base64"),
        mimeType: image.mimeType,
        type: "image",
      }
    }
    let clip = options.clip ? { ...options.clip, scale: 1 } : undefined
    if (options.fullPage) {
      const metrics = await this.page.transport.send<{
        cssContentSize: { width: number; height: number }
      }>("Page.getLayoutMetrics")
      clip = {
        height: Math.min(metrics.cssContentSize.height, 16_384),
        scale: 1,
        width: metrics.cssContentSize.width,
        x: 0,
        y: 0,
      }
    }
    const result = await this.page.transport.send<{ data: string }>("Page.captureScreenshot", {
      captureBeyondViewport: options.fullPage ?? false,
      format: "png",
      ...(clip ? { clip } : {}),
    })
    return { dataBase64: result.data, mimeType: "image/png", type: "image" }
  }

  /** The accessibility state, a screenshot, or both, as the runtime's `getAXState` reads them. */
  async axGet(
    mode: "state" | "screenshot" | "both"
  ): Promise<{ state?: string; screenshot?: WireImage }> {
    this.page.assertNoDialog()
    if (mode === "screenshot") return { screenshot: await this.screenshot() }
    const state = await this.#ax.state(this.page)
    if (mode === "state") return { state }
    return { screenshot: await this.screenshot(), state }
  }

  // Elements

  async #element(index: number): Promise<ElementTarget> {
    return this.#ax.resolve(this.page, index)
  }

  async #clickPoint(target: ElementTarget): Promise<Point> {
    await this.page.callOn(
      target.objectId,
      `(element) => element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })`
    )
    const quads = await this.page.transport
      .send<{ quads: number[][] }>("DOM.getContentQuads", { objectId: target.objectId })
      .catch(() => ({ quads: [] as number[][] }))
    const quad = quads.quads.find((candidate) => {
      const xs = [candidate[0], candidate[2], candidate[4], candidate[6]] as number[]
      return Math.max(...xs) - Math.min(...xs) > 0.5
    })
    if (!quad) {
      throw new EngineError(
        "not_visible",
        "The element is not visible, so it cannot be clicked. Scroll or use another element."
      )
    }
    return quadCenter(quad)
  }

  async #withElement<T>(index: number, run: (target: ElementTarget) => Promise<T>): Promise<T> {
    const target = await this.#element(index)
    try {
      return await run(target)
    } finally {
      await this.page.release(target.objectId)
    }
  }

  async #axClick(
    at: number | [number, number],
    options: { clickCount?: number; mouseButton?: string }
  ): Promise<null> {
    const click = { button: axButton(options.mouseButton), clickCount: options.clickCount ?? 1 }
    if (Array.isArray(at)) {
      await this.input.click(toPoint(at), click)
    } else {
      await this.#withElement(assertIndex(at), async (target) => {
        await this.input.click(await this.#clickPoint(target), click)
      })
    }
    return this.#settle()
  }

  async #focusIndex(index: unknown): Promise<void> {
    if (index === null || index === undefined) return
    await this.#withElement(assertIndex(index), (target) => this.#focus(target))
  }

  async #focus(target: ElementTarget): Promise<void> {
    const focused = await this.page.callOn(
      target.objectId,
      `(element) => {
        element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        if (typeof element.focus === "function") element.focus();
        const active = element.getRootNode().activeElement;
        return active === element || element.contains(active);
      }`
    )
    // Elements that do not take focus from script, such as custom widgets, take it from a click.
    if (!focused) await this.input.click(await this.#clickPoint(target))
  }

  async #paste(index: number | null, text: string, format: string | undefined): Promise<null> {
    await this.#focusIndex(index)
    if (format === "html") {
      const handled = await this.page.call(
        `(injected, html) => {
          const target = document.activeElement ?? document.body;
          const data = new DataTransfer();
          data.setData("text/html", html);
          const plain = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
          data.setData("text/plain", plain);
          const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
          const proceeded = target.dispatchEvent(event);
          if (proceeded && document.queryCommandSupported?.("insertHTML")) {
            return document.execCommand("insertHTML", false, html);
          }
          return !proceeded;
        }`,
        [text]
      )
      if (!handled) await this.input.insertText(text)
    } else {
      await this.input.insertText(text)
    }
    return this.#settle()
  }

  async #keypress(keys: readonly string[]): Promise<null> {
    // CUA key lists name one chord, such as ["CTRL", "A"], or one key.
    const chord = keys.length === 1 ? (keys[0] as string) : keys.join("+")
    await this.input.press(parseChord(chord, this.page.platform))
    return this.#settle()
  }

  async #axScroll(at: number | [number, number], direction: string, pages: number): Promise<null> {
    const [dx, dy] = SCROLL_DELTAS[direction] ?? [0, 1]
    const viewport = (await this.page.call(
      "() => ({ width: innerWidth, height: innerHeight })",
      []
    )) as { width: number; height: number }
    const point = Array.isArray(at)
      ? toPoint(at)
      : await this.#withElement(assertIndex(at), async (target) => {
          const quads = await this.page.transport
            .send<{ quads: number[][] }>("DOM.getContentQuads", { objectId: target.objectId })
            .catch(() => ({ quads: [] as number[][] }))
          const quad = quads.quads[0]
          if (!quad) return this.#clickPoint(target)
          const center = quadCenter(quad)
          return {
            x: Math.min(Math.max(center.x, 1), viewport.width - 1),
            y: Math.min(Math.max(center.y, 1), viewport.height - 1),
          }
        })
    await this.input.wheel(point, {
      x: dx * pages * viewport.width * 0.8,
      y: dy * pages * viewport.height * 0.8,
    })
    return this.#settle()
  }

  async #setValue(index: number, value: string): Promise<null> {
    await this.#withElement(index, async (target) => {
      const result = await this.page.callDeclaration(
        `function(value) {
          const injected = globalThis[Symbol.for("cypheria.cua.injected")];
          this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          if (this.nodeName === "SELECT") {
            return injected.selectOptions(this, [{ valueOrLabel: value }]);
          }
          if (this.getAttribute?.("role") === "slider" || this.getAttribute?.("role") === "spinbutton") {
            return "needsinput";
          }
          return injected.fill(this, value);
        }`,
        [value],
        { objectId: target.objectId }
      )
      if (typeof result === "string" && result.startsWith("error:")) {
        throw new EngineError("set_value_failed", `Could not set the value: ${result.slice(6)}.`)
      }
      if (result === "needsinput") {
        if (value) await this.input.insertText(value)
        else await this.input.press(parseChord("Delete", this.page.platform))
      }
    })
    return this.#settle()
  }

  async #selectText(
    index: number,
    text: string,
    options: { prefix?: string; suffix?: string; selectionType?: string }
  ): Promise<null> {
    await this.#withElement(index, async (target) => {
      const result = await this.page.callOn(
        target.objectId,
        `(element, text, prefix, suffix, mode) => {
          element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          element.focus?.();
          const find = (haystack) => {
            const needle = prefix + text + suffix;
            let from = 0;
            const matches = [];
            for (;;) {
              const at = haystack.indexOf(needle, from);
              if (at < 0) break;
              matches.push(at + prefix.length);
              from = at + 1;
            }
            return matches;
          };
          const place = (start) => {
            if (mode === "cursor_before") return [start, start];
            if (mode === "cursor_after") return [start + text.length, start + text.length];
            return [start, start + text.length];
          };
          if ("setSelectionRange" in element && typeof element.value === "string") {
            const matches = find(element.value);
            if (matches.length !== 1) return matches.length;
            const [start, end] = place(matches[0]);
            element.setSelectionRange(start, end);
            return 1;
          }
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const nodes = [];
          let content = "";
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            nodes.push([node, content.length]);
            content += node.data;
          }
          const matches = find(content);
          if (matches.length !== 1) return matches.length;
          const [start, end] = place(matches[0]);
          const locate = (offset) => {
            for (let i = nodes.length - 1; i >= 0; i--) {
              const [node, base] = nodes[i];
              if (offset >= base) return [node, Math.min(offset - base, node.data.length)];
            }
            return [element, 0];
          };
          const range = document.createRange();
          range.setStart(...locate(start));
          range.setEnd(...locate(end));
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return 1;
        }`,
        [text, options.prefix ?? "", options.suffix ?? "", options.selectionType ?? "text"]
      )
      if (result === 0)
        throw new EngineError("text_not_found", `"${text}" is not in element ${index}.`)
      if (result !== 1) {
        throw new EngineError(
          "ambiguous_text",
          `"${text}" occurs ${String(result)} times in element ${index}; pass a prefix or suffix to choose one.`
        )
      }
    })
    return this.#settle()
  }

  async #secondaryAction(index: number, action: string): Promise<null> {
    const name = action.toLowerCase().replace(/[\s_-]/gu, "")
    switch (name) {
      case "showmenu":
      case "contextmenu":
        await this.#withElement(index, async (target) => {
          await this.input.click(await this.#clickPoint(target), { button: "right" })
        })
        break
      case "expand":
      case "collapse":
      case "toggle":
      case "press":
        await this.#axClick(index, {})
        break
      case "increment":
      case "decrement":
        await this.#withElement(index, (target) => this.#focus(target))
        await this.input.press(
          parseChord(name === "increment" ? "ArrowUp" : "ArrowDown", this.page.platform)
        )
        break
      case "focus":
        await this.#withElement(index, (target) => this.#focus(target))
        break
      case "cancel":
      case "dismiss":
        await this.#withElement(index, (target) => this.#focus(target))
        await this.input.press(parseChord("Escape", this.page.platform))
        break
      case "hover":
        await this.#withElement(index, async (target) => {
          await this.input.move(await this.#clickPoint(target))
        })
        break
      case "scrolltovisible":
      case "scrollintoview":
        await this.#withElement(index, async (target) => {
          await this.#clickPoint(target)
        })
        break
      default:
        throw new EngineError(
          "unsupported_action",
          `Unknown action "${action}". Browser elements support ShowMenu, Expand, Collapse, Increment, Decrement, Focus, Cancel, Hover, and ScrollIntoView.`
        )
    }
    return this.#settle()
  }

  async #handleDialog(accept: boolean, promptText: string | undefined): Promise<null> {
    if (!this.page.dialog) throw new EngineError("no_dialog", "The page is not showing a dialog.")
    await this.page.transport.send("Page.handleJavaScriptDialog", {
      accept,
      ...(promptText !== undefined ? { promptText } : {}),
    })
    await this.page
      .waitFor(() => this.page.dialog === undefined, 2_000, "the dialog to close")
      .catch(() => {})
    return null
  }

  // Visible DOM

  async #visibleDomTree(): Promise<unknown> {
    for (const target of this.#visibleDom.values()) await this.page.release(target.objectId)
    this.#visibleDom.clear()
    const frameId = await this.page.mainFrameId()
    const arrayId = (await this.page.call(
      `() => {
        const selector = 'a[href], button, input, select, textarea, summary, [role], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"]), [onclick]';
        const result = [];
        for (const element of document.querySelectorAll(selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none") continue;
          result.push(element);
          if (result.length >= 500) break;
        }
        return result;
      }`,
      [],
      { frameId, handle: true }
    )) as string
    const properties = await this.page.transport.send<{
      result: { name: string; value?: { objectId?: string } }[]
    }>("Runtime.getProperties", { objectId: arrayId, ownProperties: true })
    const nodes: unknown[] = []
    for (const property of properties.result) {
      if (!/^\d+$/u.test(property.name) || !property.value?.objectId) continue
      const id = `n${Number(property.name) + 1}`
      this.#visibleDom.set(id, { frameId, objectId: property.value.objectId })
      const described = await this.page.callOn(
        property.value.objectId,
        `(element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.value || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().slice(0, 120);
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || undefined,
            type: element.getAttribute("type") || undefined,
            text: text || undefined,
            href: element.getAttribute("href") || undefined,
            bounds: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          };
        }`
      )
      nodes.push({ node_id: id, ...(described as object) })
    }
    await this.page.release(arrayId)
    return nodes
  }

  #domNode(id: string): ElementTarget {
    const target = this.#visibleDom.get(id)
    if (!target)
      throw new EngineError(
        "stale_node",
        `Node ${id} is not in the latest visible DOM. Call get_visible_dom() again.`
      )
    return target
  }

  async #domScroll(options: { node_id?: string; x: number; y: number }): Promise<null> {
    if (options.node_id) {
      await this.page.callOn(
        this.#domNode(options.node_id).objectId,
        "(element, x, y) => element.scrollBy(x, y)",
        [options.x, options.y]
      )
    } else {
      await this.page.call("(injected, x, y) => scrollBy(x, y)", [options.x, options.y])
    }
    return this.#settle()
  }

  // Playwright page API

  async #domSnapshot(): Promise<string> {
    const html = String(
      await this.page.call(
        `() => {
          const expand = (doc) => {
            const clone = doc.documentElement.cloneNode(true);
            const frames = doc.querySelectorAll("iframe, frame");
            const clones = clone.querySelectorAll("iframe, frame");
            frames.forEach((frame, i) => {
              try {
                const inner = frame.contentDocument;
                if (inner?.body && clones[i]) clones[i].setAttribute("data-cypheria-frame-body", inner.body.outerHTML);
              } catch {}
            });
            for (const script of clone.querySelectorAll("script, style, noscript")) script.remove();
            clone.querySelector("#__cypheria_agent_cursor__")?.remove();
            return "<!DOCTYPE html>\\n" + clone.outerHTML;
          };
          return expand(document);
        }`,
        []
      )
    )
    return html.length > MAX_DOM_SNAPSHOT
      ? `${html.slice(0, MAX_DOM_SNAPSHOT)}\n<!-- The DOM snapshot is truncated. -->`
      : html
  }

  async #elementInfo(options: {
    x: number
    y: number
    includeNonInteractable?: boolean
  }): Promise<unknown> {
    return this.page.call(
      `(injected, x, y, all) => {
        const interactable = (element) => element.matches?.('a[href], button, input, select, textarea, summary, label, [role], [contenteditable], [tabindex], [onclick]') || getComputedStyle(element).cursor === "pointer";
        const seen = new Set();
        const result = [];
        for (const element of document.elementsFromPoint(x, y)) {
          if (seen.has(element) || (!all && !interactable(element))) continue;
          seen.add(element);
          const rect = element.getBoundingClientRect();
          let primary = null;
          const candidates = [];
          try {
            const generated = injected.generateSelector(element, { testIdAttributeName: "data-testid" });
            primary = generated.selector;
            candidates.push(...(generated.selectors ?? [generated.selector]));
          } catch {}
          const text = (element.innerText || element.value || "").trim();
          result.push({
            ariaName: injected.utils.getElementAccessibleNameText?.(element, false) || null,
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            preview: element.outerHTML.slice(0, 200),
            role: injected.utils.getAriaRole(element) ?? null,
            selector: { candidates: candidates.slice(0, 5), primary },
            tagName: element.tagName.toLowerCase(),
            testId: element.getAttribute("data-testid"),
            visibleText: text ? text.slice(0, 200) : null,
          });
          if (result.length >= 8) break;
        }
        return result;
      }`,
      [options.x, options.y, options.includeNonInteractable ?? false]
    )
  }

  async #elementScreenshot(options: {
    x: number
    y: number
    includeNonInteractable?: boolean
  }): Promise<WireImage> {
    const infos = (await this.#elementInfo(options)) as {
      boundingBox: { x: number; y: number; width: number; height: number }
    }[]
    await this.page.call(
      `(injected, boxes, x, y) => {
        const layer = document.createElement("div");
        layer.id = "__cypheria_element_overlay__";
        layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
        boxes.forEach((box, i) => {
          const outline = document.createElement("div");
          outline.style.cssText = "position:fixed;border:2px solid " + (i === 0 ? "#e5484d" : "#3e63dd") + ";left:" + box.x + "px;top:" + box.y + "px;width:" + box.width + "px;height:" + box.height + "px";
          layer.append(outline);
        });
        const dot = document.createElement("div");
        dot.style.cssText = "position:fixed;width:8px;height:8px;border-radius:4px;background:#e5484d;left:" + (x - 4) + "px;top:" + (y - 4) + "px";
        layer.append(dot);
        document.documentElement.append(layer);
      }`,
      [infos.map((info) => info.boundingBox), options.x, options.y]
    )
    try {
      return await this.screenshot()
    } finally {
      await this.page
        .call(`() => document.getElementById("__cypheria_element_overlay__")?.remove()`, [])
        .catch(() => {})
    }
  }

  async #evaluate(source: string, arg: unknown): Promise<unknown> {
    return this.page.callDeclaration(
      `async function(arg) {
        const value = (${source});
        return typeof value === "function" ? await value(arg) : value;
      }`,
      [arg]
    )
  }

  async #waitForEvent(
    kind: "download" | "filechooser",
    timeoutMs = 30_000
  ): Promise<EventHandleInfo> {
    const handle = `h${++this.#handleSeq}`
    if (kind === "filechooser") {
      await this.page.transport.send("Page.setInterceptFileChooserDialog", { enabled: true })
      try {
        let chooser = this.page.takeFileChooser()
        await this.page.waitFor(
          () => {
            chooser ??= this.page.takeFileChooser()
            return chooser !== undefined
          },
          timeoutMs,
          "a file chooser"
        )
        if (!chooser) throw new EngineError("timeout", "No file chooser opened.")
        const isMultiple = chooser.mode === "selectMultiple"
        this.#handles.set(handle, { backendNodeId: chooser.backendNodeId, isMultiple, kind })
        return { handle, isMultiple, kind }
      } finally {
        await this.page.transport
          .send("Page.setInterceptFileChooserDialog", { enabled: false })
          .catch(() => {})
      }
    }
    if (!this.#hooks.waitForDownload) {
      throw new EngineError("unsupported", "This browser does not report downloads to Cypheria.")
    }
    const result = this.#hooks.waitForDownload(timeoutMs)
    result.catch(() => {})
    this.#handles.set(handle, { kind, result })
    return { handle, kind }
  }

  async #downloadPath(id: string): Promise<string | null> {
    const handle = this.#handles.get(id)
    if (handle?.kind !== "download")
      throw new EngineError("stale_handle", "The download is no longer available.")
    return (await handle.result).path
  }

  async #setFiles(
    id: string,
    files: readonly string[],
    context: CallContext | undefined
  ): Promise<null> {
    const handle = this.#handles.get(id)
    if (handle?.kind !== "filechooser")
      throw new EngineError("stale_handle", "The file chooser is no longer available.")
    if (!handle.isMultiple && files.length > 1) {
      throw new EngineError("invalid_files", "This file chooser accepts one file.")
    }
    const paths = await Promise.all(files.map((file) => checkUploadPath(file, context?.cwd)))
    await this.page.transport.send("DOM.setFileInputFiles", {
      backendNodeId: handle.backendNodeId,
      files: paths,
    })
    this.#handles.delete(id)
    return this.#settle()
  }

  async #waitForLoadState(options: { state?: string; timeoutMs?: number }): Promise<null> {
    const name = { domcontentloaded: "DOMContentLoaded", load: "load", networkidle: "networkIdle" }[
      options.state ?? "load"
    ] as string
    await this.page.waitFor(
      () => this.page.hasLifecycle(name),
      options.timeoutMs ?? NAVIGATION_TIMEOUT_MS,
      `the ${options.state ?? "load"} state`
    )
    return null
  }

  async #waitForURL(
    pattern: string | { source: string; flags: string },
    options: { timeoutMs?: number; waitUntil?: string }
  ): Promise<null> {
    const matches = urlMatcher(pattern)
    const deadline = Date.now() + (options.timeoutMs ?? NAVIGATION_TIMEOUT_MS)
    for (;;) {
      const { url } = await this.info().catch(() => ({ url: "" }))
      if (matches(url)) break
      if (Date.now() > deadline) {
        throw new EngineError(
          "timeout",
          `Timed out waiting for the URL to match ${typeof pattern === "string" ? pattern : `/${pattern.source}/${pattern.flags}`}. It is ${url}.`,
          { retryable: true }
        )
      }
      await wait(100)
    }
    if (options.waitUntil && options.waitUntil !== "commit") {
      await this.#waitForLoadState({
        state: options.waitUntil,
        timeoutMs: Math.max(1_000, deadline - Date.now()),
      })
    }
    return null
  }

  #logs(options: { filter?: string; levels?: string[]; limit?: number }): LogEntry[] {
    const levels = options.levels?.map((level) => (level === "warning" ? "warn" : level))
    return this.page
      .logs()
      .filter((entry) => !levels || levels.includes(entry.level))
      .filter((entry) => !options.filter || entry.message.includes(options.filter))
      .slice(-(options.limit ?? 100))
  }

  // Locators

  /** The frame a selector's last part runs in, after entering each frame it names. */
  async #enterFrames(selector: string): Promise<{ frameId: string; inner: string }> {
    const parts = selector.split(FRAME_SEPARATOR)
    let frameId = await this.page.mainFrameId()
    for (const frameSelector of parts.slice(0, -1)) {
      const objectId = (await this.page.call(
        `(injected, selector) => {
          const all = injected.querySelectorAll(injected.parseSelector(selector), document);
          if (all.length > 1) throw new Error("The frame locator matches " + all.length + " frames; make it specific.");
          return all[0] ?? null;
        }`,
        [frameSelector],
        { frameId, handle: true }
      )) as string | undefined
      if (!objectId)
        throw new EngineError("not_found", `No frame matches ${frameSelector}.`, {
          retryable: true,
        })
      try {
        frameId = await this.page.childFrame(objectId)
      } finally {
        await this.page.release(objectId)
      }
    }
    return { frameId, inner: parts.at(-1) as string }
  }

  /**
   * Resolves a locator to its one element, waiting until it exists and, for actions, until it
   * is visible and enabled.
   */
  async #single(
    selector: string,
    timeoutMs: number,
    state: "attached" | "visible" | "enabled" | "editable"
  ): Promise<ElementTarget> {
    const deadline = Date.now() + timeoutMs
    let last = "it does not exist yet"
    for (;;) {
      try {
        const { frameId, inner } = await this.#enterFrames(selector)
        const result = (await this.page.call(
          `(injected, selector, state) => {
            const all = injected.querySelectorAll(injected.parseSelector(selector), document);
            if (all.length > 1) return { error: "strict", count: all.length };
            const element = all[0];
            if (!element) return { error: "missing" };
            if (state !== "attached") {
              if (!injected.elementState(element, "visible").matches) return { error: "hidden" };
              if (state === "enabled" && !injected.elementState(element, "enabled").matches) return { error: "disabled" };
              if (state === "editable" && !injected.elementState(element, "editable").matches) return { error: "readonly" };
            }
            return { ok: true };
          }`,
          [inner, state],
          { frameId }
        )) as { ok?: true; error?: string; count?: number }
        if (result.error === "strict") {
          throw new EngineError(
            "strict_mode",
            `The locator matches ${result.count} elements; narrow it with first(), nth(), filter(), or a more specific locator.`
          )
        }
        if (result.ok) {
          const objectId = (await this.page.call(
            `(injected, selector) => injected.querySelector(injected.parseSelector(selector), document, false) ?? null`,
            [inner],
            { frameId, handle: true }
          )) as string | undefined
          if (objectId) return { frameId, objectId }
        } else {
          last =
            {
              disabled: "it is disabled",
              hidden: "it is not visible",
              missing: "it does not exist yet",
              readonly: "it is not editable",
            }[result.error as string] ?? "it is not ready"
        }
      } catch (error) {
        if (error instanceof EngineError && error.code !== "not_found" && error.code !== "timeout")
          throw error
      }
      if (Date.now() >= deadline) {
        throw new EngineError(
          "timeout",
          `Timed out after ${timeoutMs} ms waiting for the locator: ${last}.`,
          { retryable: true }
        )
      }
      await wait(100)
    }
  }

  /**
   * Saves the media or file an element points to, fetched by the browser itself so the page's
   * cookies apply, and returns the saved path.
   */
  async #downloadMedia(selector: string, timeoutMs: number): Promise<string> {
    const save = this.#hooks.saveFile
    if (!save) throw new EngineError("unsupported", "This browser does not save downloads.")
    const target = await this.#single(selector, timeoutMs, "attached")
    let url: string
    try {
      url = (await this.page.callOn(
        target.objectId,
        `(element) => {
          const usable = (value) => typeof value === "string" && value && !value.startsWith("blob:") ? value : "";
          const own = (node) => usable(node.currentSrc) || usable(node.src) || usable(node.href) || usable(node.poster) || usable(node.data);
          const found = own(element) || [...element.querySelectorAll("source, img, video, audio, a[href]")].map(own).find(Boolean) || "";
          return found ? new URL(found, document.baseURI).href : "";
        }`
      )) as string
    } finally {
      await this.page.release(target.objectId)
    }
    if (!url) {
      throw new EngineError(
        "not_found",
        "The element has no media or file URL to download; media streamed through blob: URLs cannot be saved."
      )
    }
    const data = url.startsWith("data:")
      ? decodeDataUrl(url)
      : await this.#fetchResource(target.frameId, url, timeoutMs)
    return save(mediaFilename(url), data)
  }

  /** Saves a Google Workspace document the tab shows, exported by Google in `type`. */
  async #exportGsuite(type: GsuiteExportType): Promise<string> {
    const save = this.#saver()
    const { title, url } = await this.info()
    const doc = parseGoogleDoc(url)
    if (!doc) {
      throw new EngineError(
        "unsupported",
        "The tab does not show a Google Docs, Sheets, or Slides document; open the document first."
      )
    }
    let exportUrl: string
    try {
      exportUrl = gsuiteExportUrl(doc, type)
    } catch (error) {
      throw new EngineError("invalid", error instanceof Error ? error.message : String(error))
    }
    const data = await this.#fetchResource(await this.page.mainFrameId(), exportUrl, 120_000)
    const file =
      type === "md"
        ? new TextEncoder().encode(`${stripInlineImages(new TextDecoder().decode(data))}\n`)
        : data
    return save(`${titleFilename(title, "Document")}.${type}`, file)
  }

  /** Saves the transcript of the YouTube video the tab shows as a UTF-8 text file. */
  async #exportYouTubeTranscript(): Promise<string> {
    const save = this.#saver()
    const { url } = await this.info()
    const videoId = youtubeVideoId(url)
    if (!videoId) {
      throw new EngineError(
        "unsupported",
        "The tab does not show a YouTube video (youtube.com/watch)."
      )
    }
    const outcome = (await this.page.evaluateRaw(
      youtubeTranscriptScript(videoId, 8_000)
    )) as TranscriptOutcome
    if (!outcome.ok) {
      throw new EngineError(
        outcome.reason === "fetch_failed" ? "download_failed" : "unavailable",
        {
          fetch_failed: "YouTube did not return the captions.",
          no_captions: "This video has no captions YouTube can show.",
          no_player: "The video player is not ready; wait for the video to load and try again.",
        }[outcome.reason]
      )
    }
    return save(
      `${titleFilename(outcome.title, videoId)}.txt`,
      new TextEncoder().encode(transcriptText(outcome.lines))
    )
  }

  #saver(): (filename: string, data: Uint8Array) => Promise<string> {
    const save = this.#hooks.saveFile
    if (!save) throw new EngineError("unsupported", "This browser does not save files.")
    return save
  }

  /** Fetches a URL through the browser's network stack, with the frame's cookies. */
  async #fetchResource(frameId: string, url: string, timeoutMs: number): Promise<Uint8Array> {
    const { resource } = await withTimeout(
      this.page.transport.send<{
        resource: {
          success: boolean
          httpStatusCode?: number
          netErrorName?: string
          stream?: string
        }
      }>("Network.loadNetworkResource", {
        frameId,
        options: { disableCache: false, includeCredentials: true },
        url,
      }),
      timeoutMs,
      "The download did not finish in time."
    )
    if (!resource.success || !resource.stream || (resource.httpStatusCode ?? 200) >= 400) {
      throw new EngineError(
        "download_failed",
        `Could not download ${url}: ${resource.netErrorName ?? `HTTP ${resource.httpStatusCode}`}.`
      )
    }
    const chunks: Buffer[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await this.page.transport.send<{
          data: string
          base64Encoded?: boolean
          eof: boolean
        }>("IO.read", { handle: resource.stream, size: 1 << 20 })
        const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8")
        size += bytes.length
        if (size > MAX_MEDIA_BYTES) {
          throw new EngineError("download_failed", "The file is larger than 512 MB.")
        }
        chunks.push(bytes)
        if (chunk.eof) break
      }
    } finally {
      await this.page.transport.send("IO.close", { handle: resource.stream }).catch(() => undefined)
    }
    return new Uint8Array(Buffer.concat(chunks))
  }

  async #all(selector: string): Promise<{ frameId: string; inner: string }> {
    return this.#enterFrames(selector)
  }

  async #locator(
    member: BrowserMember,
    selector: string,
    args: readonly unknown[],
    context: CallContext | undefined
  ): Promise<unknown> {
    const a = args as unknown as Validated
    const options = (args.at(-1) ?? {}) as {
      timeoutMs?: number
      force?: boolean
      button?: string
      modifiers?: string[]
    }
    const timeoutMs =
      (typeof options === "object" && options && "timeoutMs" in options
        ? options.timeoutMs
        : undefined) ?? DEFAULT_TIMEOUT_MS
    switch (member) {
      case "locator.count": {
        const { frameId, inner } = await this.#all(selector)
        return this.page.call(
          `(injected, s) => injected.querySelectorAll(injected.parseSelector(s), document).length`,
          [inner],
          { frameId }
        )
      }
      case "locator.all": {
        const count = (await this.#locator("locator.count", selector, [], context)) as number
        return Array.from({ length: count }, (_, index) => `${selector} >> nth=${index}`)
      }
      case "locator.allTextContents": {
        const { frameId, inner } = await this.#all(selector)
        return this.page.call(
          `(injected, s) => injected.querySelectorAll(injected.parseSelector(s), document).map((e) => e.textContent ?? "")`,
          [inner],
          { frameId }
        )
      }
      case "locator.textContent":
      case "locator.innerText":
      case "locator.getAttribute": {
        const target = await this.#single(selector, timeoutMs, "attached")
        try {
          if (member === "locator.textContent")
            return this.page.callOn(target.objectId, "(e) => e.textContent")
          if (member === "locator.innerText")
            return this.page.callOn(target.objectId, "(e) => e.innerText ?? e.textContent ?? ''")
          return this.page.callOn(target.objectId, "(e, name) => e.getAttribute(name)", [a[0]])
        } finally {
          await this.page.release(target.objectId)
        }
      }
      case "locator.isVisible":
      case "locator.isEnabled": {
        const { frameId, inner } = await this.#all(selector)
        return this.page.call(
          `(injected, s, state) => {
            const element = injected.querySelector(injected.parseSelector(s), document, false);
            return element ? injected.elementState(element, state).matches : false;
          }`,
          [inner, member === "locator.isVisible" ? "visible" : "enabled"],
          { frameId }
        )
      }
      case "locator.waitFor": {
        const state = (a[0] as { state?: string } | undefined)?.state ?? "visible"
        const deadline = Date.now() + timeoutMs
        for (;;) {
          const { frameId, inner } = await this.#all(selector).catch(() => ({
            frameId: "",
            inner: "",
          }))
          const matched = frameId
            ? await this.page.call(
                `(injected, s, state) => {
                  const element = injected.querySelector(injected.parseSelector(s), document, false);
                  if (state === "attached") return !!element;
                  if (state === "detached") return !element;
                  const visible = !!element && injected.elementState(element, "visible").matches;
                  return state === "visible" ? visible : !visible;
                }`,
                [inner, state],
                { frameId }
              )
            : state === "detached" || state === "hidden"
          if (matched) return null
          if (Date.now() >= deadline)
            throw new EngineError(
              "timeout",
              `Timed out after ${timeoutMs} ms waiting for the locator to be ${state}.`,
              { retryable: true }
            )
          await wait(100)
        }
      }
      case "locator.downloadMedia":
        // Media can be large; downloads wait two minutes unless the call says otherwise.
        return this.#downloadMedia(selector, options.timeoutMs ?? 120_000)
      case "locator.evaluate": {
        const target = await this.#single(selector, timeoutMs, "attached")
        try {
          return await this.page.callDeclaration(
            `async function(arg) {
              const value = (${a[0]});
              return typeof value === "function" ? await value(this, arg) : value;
            }`,
            [a[1]],
            { objectId: target.objectId }
          )
        } finally {
          await this.page.release(target.objectId)
        }
      }
      case "locator.evaluateAll": {
        const { frameId, inner } = await this.#all(selector)
        const arrayId = (await this.page.call(
          `(injected, s) => injected.querySelectorAll(injected.parseSelector(s), document)`,
          [inner],
          { frameId, handle: true }
        )) as string
        try {
          return await this.page.callDeclaration(
            `async function(arg) {
              const value = (${a[0]});
              return typeof value === "function" ? await value(this, arg) : value;
            }`,
            [a[1]],
            { objectId: arrayId }
          )
        } finally {
          await this.page.release(arrayId)
        }
      }
      case "locator.click":
      case "locator.dblclick": {
        const target = await this.#single(
          selector,
          timeoutMs,
          options.force ? "attached" : "enabled"
        )
        try {
          const point = await this.#clickPoint(target)
          await this.input.click(point, {
            button: (options.button as "left" | "right" | "middle" | undefined) ?? "left",
            clickCount: member === "locator.dblclick" ? 2 : 1,
            modifiers: parseModifiers(options.modifiers, this.page.platform),
          })
        } finally {
          await this.page.release(target.objectId)
        }
        return this.#settle()
      }
      case "locator.fill": {
        const target = await this.#single(selector, timeoutMs, "editable")
        try {
          const result = await this.page.callDeclaration(
            `function(value) {
              const injected = globalThis[Symbol.for("cypheria.cua.injected")];
              this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
              return injected.fill(this, value);
            }`,
            [a[0]],
            { objectId: target.objectId }
          )
          if (typeof result === "string" && result.startsWith("error:"))
            throw new EngineError("fill_failed", `Could not fill: ${result.slice(6)}.`)
          if (result === "needsinput") {
            if (a[0]) await this.input.insertText(a[0])
            else await this.input.press(parseChord("Delete", this.page.platform))
          }
        } finally {
          await this.page.release(target.objectId)
        }
        return this.#settle()
      }
      case "locator.type":
      case "locator.pressSequentially":
      case "locator.press": {
        const target = await this.#single(selector, timeoutMs, "attached")
        try {
          await this.#focus(target)
          if (member === "locator.press")
            await this.input.press(parseChord(a[0], this.page.platform))
          else await this.input.type(a[0])
        } finally {
          await this.page.release(target.objectId)
        }
        return this.#settle()
      }
      case "locator.check":
      case "locator.uncheck":
      case "locator.setChecked": {
        const checked =
          member === "locator.setChecked" ? (a[0] as boolean) : member === "locator.check"
        const target = await this.#single(
          selector,
          timeoutMs,
          options.force ? "attached" : "enabled"
        )
        try {
          const state = (await this.page.callDeclaration(
            `function(want) {
              const injected = globalThis[Symbol.for("cypheria.cua.injected")];
              return injected.elementState(this, want ? "checked" : "unchecked").matches;
            }`,
            [checked],
            { objectId: target.objectId }
          )) as boolean
          if (!state) {
            await this.input.click(await this.#clickPoint(target))
            await wait(SETTLE_MS)
            const now = (await this.page.callDeclaration(
              `function(want) {
                const injected = globalThis[Symbol.for("cypheria.cua.injected")];
                return injected.elementState(this, want ? "checked" : "unchecked").matches;
              }`,
              [checked],
              { objectId: target.objectId }
            )) as boolean
            if (!now)
              throw new EngineError(
                "check_failed",
                `Clicking did not ${checked ? "check" : "uncheck"} the element.`
              )
          }
        } finally {
          await this.page.release(target.objectId)
        }
        return null
      }
      case "locator.selectOption": {
        const target = await this.#single(selector, timeoutMs, "enabled")
        try {
          const values = (a[0] as (string | object)[]).map((value) =>
            typeof value === "string" ? { valueOrLabel: value } : value
          )
          const result = await this.page.callDeclaration(
            `function(values) {
              const injected = globalThis[Symbol.for("cypheria.cua.injected")];
              return injected.selectOptions(this, values);
            }`,
            [values],
            { objectId: target.objectId }
          )
          if (typeof result === "string")
            throw new EngineError(
              "select_failed",
              `Could not select: ${result.replace(/^error:/u, "")}.`
            )
          return result
        } finally {
          await this.page.release(target.objectId)
        }
      }
      default:
        throw new EngineError("unsupported", `${member} is not available on this tab.`)
    }
  }
}

/** Resolves an upload path and requires it inside the Thread's working directory. */
export const checkUploadPath = async (file: string, cwd: string | undefined): Promise<string> => {
  if (!cwd) throw new EngineError("upload_denied", "Uploads need the task's working directory.")
  const absolute = isAbsolute(file) ? file : resolvePath(cwd, file)
  const [real, root] = await Promise.all([
    realpath(absolute).catch(() => {
      throw new EngineError("upload_denied", `${file} does not exist.`)
    }),
    realpath(cwd),
  ])
  const inside = relative(root, real)
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new EngineError("upload_denied", `${file} is outside the task's working directory.`)
  }
  return real
}

export type { DialogInfo }
