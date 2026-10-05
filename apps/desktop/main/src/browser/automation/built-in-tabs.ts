import { BROWSER_MEMBERS, supports, validateCall } from "@cypheria/cua/browser"
import {
  CdpTab,
  type CdpTransport,
  EngineError,
  freePath,
  saveFile,
  type TabHooks,
  VirtualClipboard,
} from "@cypheria/cua/engine"

import type { DownloadItem, NativeImage, WebContents } from "electron"

import type { BrowserCallOutcome, BrowserTabCall } from "../../../../ipc/src/index.js"

const CAPTURE_TIMEOUT_MS = 5_000
const CAPTURE_RETRY_MS = 200

/** Members that manage tabs rather than act on a page; the window answers them. */
const WINDOW_MEMBERS: ReadonlySet<string> = new Set([
  "tab.close",
  "tab.markDeliverable",
  "tab.markHandoff",
  "tab.requestManualHandoff",
])

/** The parts of a guest `WebContents` the built-in browser backend uses. */
export type TabWebContents = Pick<
  WebContents,
  | "id"
  | "session"
  | "debugger"
  | "isDestroyed"
  | "once"
  | "removeListener"
  | "invalidate"
  | "getBackgroundThrottling"
  | "setBackgroundThrottling"
  | "beginFrameSubscription"
  | "endFrameSubscription"
>

export type BuiltInTabsOptions = {
  /** The guest showing a tab in the window that sent the call, or null. */
  readonly contents: (hostId: number, browserId: string) => TabWebContents | null
  /** The Thread a tab belongs to. */
  readonly threadOf: (browserId: string) => string | null
  /** Where downloads a model waits for are saved. */
  readonly downloadsDir: () => string
  readonly platform?: string
}

/**
 * The CDP transport of a built-in browser tab, over Electron's `webContents.debugger`. Only the
 * page's own events reach the engine; child sessions stay out of it.
 */
export const debuggerTransport = (contents: TabWebContents): CdpTransport => {
  const debug = contents.debugger
  if (!debug.isAttached()) debug.attach("1.3")
  const closeListeners = new Set<() => void>()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    debug.removeListener("detach", close)
    contents.removeListener("destroyed", close)
    for (const listener of closeListeners) listener()
  }
  debug.on("detach", close)
  contents.once("destroyed", close)
  return {
    captureViewport: () => captureViewport(contents),
    onClose: (listener) => {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    onEvent: (listener) => {
      const forward = (_event: unknown, method: string, params: unknown, sessionId?: string) => {
        if (sessionId) return
        listener({ method, params: (params ?? {}) as Record<string, unknown> })
      }
      debug.on("message", forward)
      return () => debug.removeListener("message", forward)
    },
    send: async <T>(method: string, params?: Record<string, unknown>) => {
      if (closed || contents.isDestroyed()) {
        throw new EngineError("page_gone", "The tab closed.")
      }
      try {
        return (await debug.sendCommand(method, params ?? {})) as T
      } catch (error) {
        throw new EngineError(
          "cdp_error",
          `${method}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },
  }
}

/**
 * Captures what the tab paints. A parked tab only produces frames on request, so the capture
 * turns off background throttling and asks for repaints until a frame arrives.
 */
const captureViewport = async (
  contents: TabWebContents
): Promise<{ data: Uint8Array; mimeType: string }> => {
  const throttled = contents.getBackgroundThrottling()
  contents.setBackgroundThrottling(false)
  let repaint: ReturnType<typeof setInterval> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let destroyed: (() => void) | undefined
  try {
    const image = await new Promise<NativeImage>((resolve, reject) => {
      destroyed = () => reject(new EngineError("page_gone", "The tab closed."))
      contents.once("destroyed", destroyed)
      timer = setTimeout(
        () =>
          reject(
            new EngineError("timeout", "The tab has not painted yet. Retry the screenshot.", {
              retryable: true,
            })
          ),
        CAPTURE_TIMEOUT_MS
      )
      contents.beginFrameSubscription(false, (frame) => {
        if (!frame.isEmpty()) resolve(frame)
      })
      contents.invalidate()
      repaint = setInterval(() => contents.invalidate(), CAPTURE_RETRY_MS)
    })
    return { data: image.toPNG(), mimeType: "image/png" }
  } finally {
    clearInterval(repaint)
    clearTimeout(timer)
    if (destroyed) contents.removeListener("destroyed", destroyed)
    if (!contents.isDestroyed()) {
      contents.endFrameSubscription()
      contents.setBackgroundThrottling(throttled)
    }
  }
}

/** A free path in `dir` for `filename`, adding a counter before the extension when taken. */
/** A failed member call as the window reports it, keeping the engine's error code. */
export const failureOutcome = (error: unknown): BrowserCallOutcome => {
  const coded = error as { code?: unknown; retryable?: unknown }
  const message = error instanceof Error && error.message ? error.message : String(error)
  return {
    error: {
      code: typeof coded?.code === "string" ? coded.code : "browser_error",
      message,
      retryable: coded?.retryable === true,
    },
    ok: false,
  }
}

/**
 * The page side of the built-in browser: each guest a window shows gets one engine tab over its
 * debugger. The window keeps tab lifecycle and asks for page members here, scoped to the window
 * that shows the tab and the Thread that owns it.
 */
export class BuiltInBrowserTabs {
  readonly #options: BuiltInTabsOptions
  readonly #tabs = new Map<number, CdpTab>()
  /** Each Thread's virtual clipboard, which its tabs share. */
  readonly #clipboards = new Map<string, VirtualClipboard>()

  constructor(options: BuiltInTabsOptions) {
    this.#options = options
  }

  async call(hostId: number, call: BrowserTabCall): Promise<BrowserCallOutcome> {
    try {
      return { ok: true, value: await this.#call(hostId, call) }
    } catch (error) {
      return failureOutcome(error)
    }
  }

  async #call(hostId: number, call: BrowserTabCall): Promise<unknown> {
    const validated = validateCall({
      args: call.args,
      member: call.member,
      tab: call.browserId,
      ...(call.selector ? { selector: call.selector } : {}),
      ...(call.handle ? { handle: call.handle } : {}),
    })
    if ("error" in validated) throw new EngineError("invalid", validated.error)
    const { member } = validated
    const scope = BROWSER_MEMBERS[member].scope
    if (
      !supports("iab", member) ||
      WINDOW_MEMBERS.has(member) ||
      (scope !== "tab" && scope !== "locator" && scope !== "handle")
    ) {
      throw new EngineError("invalid", `${member} is not a page member of the built-in browser.`)
    }
    if (this.#options.threadOf(call.browserId) !== call.threadId) {
      throw new EngineError("not_found", `Built-in browser tab ${call.browserId} is not open.`)
    }
    const contents = this.#options.contents(hostId, call.browserId)
    if (!contents) {
      throw new EngineError(
        "not_found",
        `Built-in browser tab ${call.browserId} is not open in this window.`
      )
    }
    const tab = this.#tab(contents, call.threadId)
    try {
      return await tab.call(member, validated.args, {
        context: call.cwd ? { cwd: call.cwd } : {},
        ...(call.handle ? { handle: call.handle } : {}),
        ...(call.selector ? { selector: call.selector } : {}),
      })
    } catch (error) {
      if (tab.page.closed) this.#drop(contents.id)
      throw error
    }
  }

  #tab(contents: TabWebContents, threadId: string): CdpTab {
    const existing = this.#tabs.get(contents.id)
    if (existing && !existing.page.closed) return existing
    existing?.dispose()
    let clipboard = this.#clipboards.get(threadId)
    if (!clipboard) {
      clipboard = new VirtualClipboard()
      this.#clipboards.set(threadId, clipboard)
    }
    const hooks: TabHooks = {
      clipboard,
      saveFile: (filename, data) => saveFile(this.#options.downloadsDir(), filename, data),
      waitForDownload: (timeoutMs) => this.#waitForDownload(contents, timeoutMs),
    }
    const tab = new CdpTab(
      debuggerTransport(contents),
      this.#options.platform ?? process.platform,
      hooks
    )
    this.#tabs.set(contents.id, tab)
    contents.once("destroyed", () => this.#drop(contents.id))
    return tab
  }

  /** Saves the tab's next download into the downloads directory without asking. */
  #waitForDownload(
    contents: TabWebContents,
    timeoutMs: number
  ): Promise<{ path: string; suggestedFilename?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        contents.session.removeListener("will-download", started)
        reject(new EngineError("timeout", `No download started within ${timeoutMs} ms.`))
      }, timeoutMs)
      const started = (_event: unknown, item: DownloadItem, source: WebContents) => {
        if (source.id !== contents.id) return
        contents.session.removeListener("will-download", started)
        clearTimeout(timer)
        const suggestedFilename = item.getFilename()
        const path = freePath(this.#options.downloadsDir(), suggestedFilename)
        item.setSavePath(path)
        item.once("done", (_done, state) => {
          if (state === "completed") resolve({ path, suggestedFilename })
          else reject(new EngineError("download_failed", `The download was ${state}.`))
        })
      }
      contents.session.on("will-download", started)
    })
  }

  #drop(contentsId: number): void {
    this.#tabs.get(contentsId)?.dispose()
    this.#tabs.delete(contentsId)
  }
}
