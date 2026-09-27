import { getDomain } from "tldts"

/**
 * Registrable domain (eTLD+1) of a web URL. Private suffixes such as `github.io` count as public
 * suffixes, so `a.github.io` and `b.github.io` are different sites.
 */
export const siteOf = (value: string | undefined | null): string | null => {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || !url.hostname) return null
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase()
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
}

export type CookieRequestContext = {
  readonly referrer?: string
  readonly resourceType: string
  /** URL of the top-level document that caused the request, when Electron can identify it. */
  readonly topLevelUrl?: string | null
  readonly url: string
}

/**
 * True when a request is cross-site relative to its top-level document. Top-level navigations are
 * first-party by definition. Requests without a known top-level document fall back to the
 * referrer; when neither exists the request is treated as first-party.
 */
export const isThirdPartyRequest = (context: CookieRequestContext): boolean => {
  if (context.resourceType === "mainFrame") return false
  const requestSite = siteOf(context.url)
  const topSite = siteOf(context.topLevelUrl) ?? siteOf(context.referrer)
  return requestSite !== null && topSite !== null && requestSite !== topSite
}

type HeaderMap = Record<string, string | string[]>

const withoutHeader = <T extends HeaderMap>(headers: T, name: string): T =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== name)) as T

type WebRequestSession = {
  webRequest: {
    onBeforeSendHeaders(
      listener: (
        details: Electron.OnBeforeSendHeadersListenerDetails,
        callback: (response: Electron.BeforeSendResponse) => void
      ) => void
    ): void
    onHeadersReceived(
      listener: (
        details: Electron.OnHeadersReceivedListenerDetails,
        callback: (response: Electron.HeadersReceivedResponse) => void
      ) => void
    ): void
  }
}

const topLevelUrlOf = (details: {
  frame?: Electron.WebFrameMain | null
  webContents?: Electron.WebContents
}): string | null => {
  try {
    const top = details.frame?.top
    if (top && !top.detached) return top.url
  } catch {
    // A frame can be disposed while the request is in flight.
  }
  try {
    return details.webContents && !details.webContents.isDestroyed()
      ? details.webContents.getURL()
      : null
  } catch {
    return null
  }
}

/**
 * Strips cookies from cross-site requests and responses in the shared dApp profile, so a tracker
 * embedded in several dApps cannot link the wallet addresses a user connects to each of them.
 * Cookie access through `document.cookie` in a third-party frame does not pass through this
 * filter. Partitioned (CHIPS) cookies are not distinguishable in request headers and are also
 * removed.
 */
export const installThirdPartyCookieFilter = (session: WebRequestSession): void => {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const thirdParty = isThirdPartyRequest({
      referrer: details.referrer,
      resourceType: details.resourceType,
      topLevelUrl: topLevelUrlOf(details),
      url: details.url,
    })
    callback(
      thirdParty
        ? { requestHeaders: withoutHeader(details.requestHeaders, "cookie") }
        : { requestHeaders: details.requestHeaders }
    )
  })
  session.webRequest.onHeadersReceived((details, callback) => {
    const thirdParty =
      details.responseHeaders !== undefined &&
      isThirdPartyRequest({
        referrer: details.referrer,
        resourceType: details.resourceType,
        topLevelUrl: topLevelUrlOf(details),
        url: details.url,
      })
    callback(
      thirdParty && details.responseHeaders
        ? { responseHeaders: withoutHeader(details.responseHeaders, "set-cookie") }
        : {}
    )
  })
}
