// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/desktop/src/features/browser-webviews/index.ts.
import { webContents as allWebContents, type WebContents } from "electron"

import { type BrowserKind, BrowserWebviewRegistry } from "./registry.js"
import { isAllowedBrowserWebviewUrl } from "./window-open.js"

const browserRegistry = new BrowserWebviewRegistry()

type ContentsIdentity = {
  readonly id: number
  isDestroyed(): boolean
}

type RegisteredGuest = ContentsIdentity & {
  readonly hostWebContents: ContentsIdentity | null
  readonly session: object
}

export const getBrowserWebviewRegistry = (): BrowserWebviewRegistry => browserRegistry

/**
 * Validates a guest reported by a renderer before trusting it: it must be a live guest of the
 * sender window and use the session that belongs to the requested tab kind.
 */
export const registerAttachedBrowser = (input: {
  browserId: string
  kind: BrowserKind
  scopeId: string
  webContentsId: number
  sender: ContentsIdentity
  profileSession: object
  findWebContents(webContentsId: number): RegisteredGuest | null
}): boolean => {
  const guest = input.findWebContents(input.webContentsId)
  if (
    !guest ||
    guest.isDestroyed() ||
    guest.hostWebContents !== input.sender ||
    guest.session !== input.profileSession
  ) {
    return false
  }
  browserRegistry.registerWebContents({
    browserId: input.browserId,
    hostWebContentsId: input.sender.id,
    webContentsId: input.webContentsId,
  })
  browserRegistry.registerScope({
    browserId: input.browserId,
    kind: input.kind,
    scopeId: input.scopeId,
  })
  return true
}

export const prepareBrowserWebContents = (contents: {
  readonly id: number
  once(event: "destroyed", listener: () => void): void
}): void => {
  const webContentsId = contents.id
  contents.once("destroyed", () => browserRegistry.unregisterWebContents(webContentsId))
}

export const listRegisteredBrowserIds = (): string[] => browserRegistry.listBrowserIds()

export const listRegisteredBrowserIdsForScope = (scopeId: string): string[] =>
  browserRegistry.listBrowserIdsForScope(scopeId)

export const getBrowserScopeId = (browserId: string): string | null =>
  browserRegistry.getScopeId(browserId)

export const getBrowserKind = (browserId: string): BrowserKind | null =>
  browserRegistry.getKind(browserId)

export const getBrowserIdForWebContents = (contents: ContentsIdentity | null): string | null =>
  contents && !contents.isDestroyed()
    ? browserRegistry.getBrowserIdForWebContents(contents.id)
    : null

export const unregisterBrowserFromHost = (hostWebContentsId: number, browserId: string): void =>
  browserRegistry.unregisterBrowserFromHost(hostWebContentsId, browserId)

export const unregisterBrowserHost = (hostWebContentsId: number): void =>
  browserRegistry.unregisterHostWebContents(hostWebContentsId)

export const setScopeActiveBrowserId = (input: {
  hostWebContentsId: number
  scopeId: string
  browserId: string | null
}): void => browserRegistry.setScopeActiveBrowser(input)

export const getScopeActiveBrowserIdForHostWindow = (
  scopeId: string,
  hostWebContentsId: number
): string | null =>
  browserRegistry.getActiveBrowserIdForScopeInHostWindow(hostWebContentsId, scopeId)

const liveContents = (contentsId: number | null): WebContents | null => {
  if (contentsId === null) return null
  const contents = allWebContents.fromId(contentsId)
  if (contents && !contents.isDestroyed()) return contents
  browserRegistry.unregisterWebContents(contentsId)
  return null
}

export const getBrowserWebContentsForHostWindow = (
  browserId: string,
  hostWebContentsId: number
): WebContents | null =>
  liveContents(browserRegistry.getWebContentsIdForBrowserInHostWindow(hostWebContentsId, browserId))

export const getActiveBrowserWebContentsForHostWindow = (
  hostWebContentsId: number
): WebContents | null => {
  const browserId = browserRegistry.getActiveBrowserIdForHostWindow(hostWebContentsId)
  return browserId ? getBrowserWebContentsForHostWindow(browserId, hostWebContentsId) : null
}

/** Blocks navigation to anything but http(s) and about:blank in every browser guest and popup. */
export const registerBrowserNavigationGuards = (contents: WebContents): void => {
  const guard = (event: { preventDefault(): void; url: string }) => {
    if (!isAllowedBrowserWebviewUrl(event.url)) event.preventDefault()
  }
  contents.on("will-navigate", guard)
  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
}
