/** A tab the user mentioned in the composer, as the snapshot they accepted. */
export type TabMention = {
  /** The browser's backend: the built-in browser or the user's Chromium browsers. */
  readonly source: "iab" | "chrome"
  /** The browser: `iab`, or the ID of one of the user's browsers. */
  readonly browserId: string
  /** The browser's own tab ID. */
  readonly tabId: string
  readonly title: string
  readonly url: string
  /** The device the browser runs on, when the mention names one. */
  readonly host?: string
}

/**
 * Parses `plugin://browser@cypheria-bundled?mention=tab-v1&source=…&browserId=…&tabId=…&title=…&url=…`
 * or the same under `plugin://chrome@cypheria-bundled` for the user's browser. Anything else is
 * rejected rather than guessed at.
 */
export const parseTabMention = (mention: string): TabMention => {
  let url: URL
  try {
    url = new URL(mention)
  } catch {
    throw new Error("Invalid tab mention URL.")
  }
  const plugin = url.username
  if (
    url.protocol !== "plugin:" ||
    url.hostname !== "cypheria-bundled" ||
    (plugin !== "browser" && plugin !== "chrome") ||
    url.password ||
    (url.pathname && url.pathname !== "/") ||
    url.hash
  ) {
    throw new Error("Invalid tab mention URL.")
  }
  const fields = Object.fromEntries(url.searchParams)
  const source = fields.source ?? (plugin === "browser" ? "iab" : "chrome")
  const browserId = fields.browserId ?? (source === "iab" ? "iab" : undefined)
  if (
    fields.mention !== "tab-v1" ||
    (source !== "iab" && source !== "chrome") ||
    !browserId?.trim() ||
    !fields.tabId?.trim() ||
    fields.title === undefined ||
    fields.url === undefined
  ) {
    throw new Error("Invalid tab mention fields.")
  }
  return {
    browserId,
    ...(fields.host?.trim() ? { host: fields.host } : {}),
    source,
    tabId: fields.tabId,
    title: fields.title,
    url: fields.url,
  }
}
