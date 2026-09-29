// Resident webview host adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/app/src/desktop/browser/resident-webviews.ts.
//
// Browser guests live in one permanent fixed-position host instead of inside React panes. A pane
// only positions its tab's surface over its own bounds; hidden tabs are parked at 1×1 so pages
// keep running, keep their state across panel switches, and remain drivable by Agents.
import type { BrowserTabRecord, BrowserViewport } from "./state.js"
import { browserTabsStore } from "./store.js"

const HOST_ID = "cypheria-browser-resident-webviews"
const BROWSER_ID_ATTRIBUTE = "data-cypheria-browser-id"
const SURFACE_ATTRIBUTE = "data-cypheria-browser-surface"
const PARKED_WIDTH = 1280
const PARKED_HEIGHT = 800
/** Above page content, below popovers and dialogs (which use z-50). */
const HOST_Z_INDEX = "20"

export type BrowserWebviewElement = HTMLElement & {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getWebContentsId(): number
  goBack(): void
  goForward(): void
  isLoading(): boolean
  loadURL(url: string): Promise<void>
  reload(): void
  stop(): void
}

type Resident = {
  readonly kind: BrowserTabRecord["kind"]
  readonly surface: HTMLElement
  readonly webview: BrowserWebviewElement
  registered: boolean
  waiters: Array<(registered: boolean) => void>
}

const residents = new Map<string, Resident>()
const fixedSizes = new Map<string, { width: number; height: number }>()

const browserBridge = () => globalThis.window?.cypheria?.browser

export const isBrowserAvailable = (): boolean => browserBridge() !== undefined

const hostElement = (): HTMLElement => {
  const existing = document.getElementById(HOST_ID)
  if (existing) return existing
  const host = document.createElement("div")
  host.id = HOST_ID
  Object.assign(host.style, {
    height: "100vh",
    left: "0",
    overflow: "visible",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: "100vw",
    zIndex: HOST_Z_INDEX,
  })
  document.body.appendChild(host)
  return host
}

const park = (resident: Resident, browserId: string): void => {
  const { surface, webview } = resident
  surface.setAttribute("aria-hidden", "true")
  Object.assign(surface.style, {
    display: "block",
    height: "1px",
    left: "0",
    overflow: "hidden",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    visibility: "visible",
    width: "1px",
  })
  const size = fixedSizes.get(browserId) ?? { height: PARKED_HEIGHT, width: PARKED_WIDTH }
  Object.assign(webview.style, {
    border: "0",
    display: "inline-flex",
    height: `${size.height}px`,
    left: "0",
    position: "absolute",
    top: "0",
    width: `${size.width}px`,
  })
}

const errorMessage = (description: string, url: string) =>
  description ? `${description}${url ? ` (${url})` : ""}` : "The page could not be loaded."

const trackPageState = (webview: BrowserWebviewElement, browserId: string): void => {
  const sync = (patch: Parameters<typeof browserTabsStore.patch>[1] = {}) => {
    try {
      browserTabsStore.patch(browserId, {
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
        ...patch,
      })
    } catch {
      // The guest is not attached yet.
    }
  }
  webview.addEventListener("did-start-loading", () => sync({ isLoading: true, lastError: null }))
  webview.addEventListener("did-stop-loading", () => sync({ isLoading: false }))
  webview.addEventListener("did-navigate", (event) => {
    sync({ faviconUrl: null, url: (event as Event & { url: string }).url })
  })
  webview.addEventListener("did-navigate-in-page", (event) => {
    const detail = event as Event & { isMainFrame: boolean; url: string }
    if (detail.isMainFrame) sync({ url: detail.url })
  })
  webview.addEventListener("page-title-updated", (event) => {
    sync({ title: (event as Event & { title: string }).title })
  })
  webview.addEventListener("page-favicon-updated", (event) => {
    const favicons = (event as Event & { favicons: string[] }).favicons
    sync({ faviconUrl: favicons.find((url) => /^https?:/u.test(url)) ?? null })
  })
  webview.addEventListener("did-fail-load", (event) => {
    const detail = event as Event & {
      errorCode: number
      errorDescription: string
      isMainFrame: boolean
      validatedURL: string
    }
    // -3 is ERR_ABORTED, reported when a navigation is replaced by another.
    if (!detail.isMainFrame || detail.errorCode === -3) return
    sync({
      isLoading: false,
      lastError: errorMessage(detail.errorDescription, detail.validatedURL),
    })
  })
}

const settle = (resident: Resident, registered: boolean): void => {
  resident.registered = registered
  for (const waiter of resident.waiters.splice(0)) waiter(registered)
}

/** Creates the guest for a tab if needed. Returns null outside the main Desktop window. */
export const ensureResidentBrowserWebview = (
  record: BrowserTabRecord
): BrowserWebviewElement | null => {
  const bridge = browserBridge()
  if (!bridge) return null
  const existing = residents.get(record.browserId)
  if (existing?.webview.isConnected && existing.kind === record.kind) return existing.webview
  if (existing) removeResidentBrowserWebview(record.browserId, { unregister: false })

  const surface = document.createElement("div")
  surface.setAttribute(SURFACE_ATTRIBUTE, record.browserId)
  const webview = document.createElement("webview") as BrowserWebviewElement
  webview.setAttribute(BROWSER_ID_ATTRIBUTE, record.browserId)
  webview.setAttribute(
    "partition",
    record.kind === "dapp" ? bridge.dappPartition : bridge.webPartition
  )
  webview.setAttribute("allowpopups", "true")
  webview.setAttribute("spellcheck", "false")
  const resident: Resident = { kind: record.kind, registered: false, surface, waiters: [], webview }
  residents.set(record.browserId, resident)
  if (record.viewport.mode === "fixed") {
    fixedSizes.set(record.browserId, {
      height: record.viewport.height,
      width: record.viewport.width,
    })
  }
  trackPageState(webview, record.browserId)
  // Reparenting can replace the guest WebContents, so every attachment registers again.
  webview.addEventListener("did-attach", () => {
    resident.registered = false
    void bridge
      .registerAttached({
        browserId: record.browserId,
        kind: record.kind,
        threadId: record.threadId,
        webContentsId: webview.getWebContentsId(),
      })
      .then(() => settle(resident, true))
      .catch((error: unknown) => {
        console.error("[browser] tab registration failed", error)
        settle(resident, false)
      })
  })
  webview.src = record.url
  surface.appendChild(webview)
  hostElement().appendChild(surface)
  park(resident, record.browserId)
  return webview
}

export const getResidentBrowserWebview = (browserId: string): BrowserWebviewElement | null =>
  residents.get(browserId)?.webview ?? null

/** Resolves once the main process has accepted the tab, or false after the timeout. */
export const waitForBrowserRegistration = (
  browserId: string,
  timeoutMs = 10_000
): Promise<boolean> => {
  const resident = residents.get(browserId)
  if (!resident) return Promise.resolve(false)
  if (resident.registered) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resident.waiters = resident.waiters.filter((waiter) => waiter !== done)
      resolve(false)
    }, timeoutMs)
    const done = (registered: boolean) => {
      clearTimeout(timer)
      resolve(registered)
    }
    resident.waiters.push(done)
  })
}

/** Positions a tab over the intersection of its pane anchor and clipping container. */
export const presentBrowserWebview = (
  browserId: string,
  anchor: HTMLElement,
  clip: HTMLElement,
  viewport: BrowserViewport
): void => {
  const resident = residents.get(browserId)
  if (!resident) return
  const anchorBounds = anchor.getBoundingClientRect()
  const clipBounds = clip.getBoundingClientRect()
  const left = Math.ceil(Math.max(anchorBounds.left, clipBounds.left))
  const top = Math.ceil(Math.max(anchorBounds.top, clipBounds.top))
  const right = Math.floor(Math.min(anchorBounds.right, clipBounds.right))
  const bottom = Math.floor(Math.min(anchorBounds.bottom, clipBounds.bottom))
  const visible = right > left && bottom > top
  resident.surface.setAttribute("aria-hidden", "false")
  Object.assign(resident.surface.style, {
    display: "block",
    height: `${Math.max(0, bottom - top)}px`,
    left: `${left}px`,
    overflow: "hidden",
    pointerEvents: visible ? "auto" : "none",
    position: "fixed",
    top: `${top}px`,
    width: `${Math.max(0, right - left)}px`,
  })
  const size =
    viewport.mode === "fixed"
      ? viewport
      : { height: anchorBounds.height, width: anchorBounds.width }
  Object.assign(resident.webview.style, {
    display: "flex",
    height: `${Math.max(1, Math.round(size.height))}px`,
    left: `${Math.round(anchorBounds.left - left)}px`,
    position: "absolute",
    top: `${Math.round(anchorBounds.top - top)}px`,
    width: `${Math.max(1, Math.round(size.width))}px`,
  })
}

export const parkBrowserWebview = (browserId: string): void => {
  const resident = residents.get(browserId)
  if (resident) park(resident, browserId)
}

/** Sets a fixed viewport for a tab, including a parked tab driven by an Agent. */
export const resizeResidentBrowserWebview = (
  browserId: string,
  width: number,
  height: number
): { width: number; height: number } | null => {
  const resident = residents.get(browserId)
  if (!resident || width <= 0 || height <= 0) return null
  const size = { height: Math.round(height), width: Math.round(width) }
  fixedSizes.set(browserId, size)
  resident.webview.style.width = `${size.width}px`
  resident.webview.style.height = `${size.height}px`
  return size
}

export const removeResidentBrowserWebview = (
  browserId: string,
  options: { unregister?: boolean } = {}
): void => {
  const resident = residents.get(browserId)
  residents.delete(browserId)
  fixedSizes.delete(browserId)
  if (resident) {
    settle(resident, false)
    resident.webview.remove()
    resident.surface.remove()
  }
  if (options.unregister !== false) {
    void browserBridge()
      ?.unregister(browserId)
      .catch(() => undefined)
  }
}
