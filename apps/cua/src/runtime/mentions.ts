/** A tab the user mentioned in the composer, as the snapshot they accepted. */
export type TabMention = {
  readonly plugin: "browser" | "chrome"
  readonly browserId?: string
  readonly tabId: string
  readonly title: string
  readonly url: string
}

/**
 * Parses `plugin://browser@cypheria-bundled?mention=tab-v1&tabId=…&title=…&url=…` (a built-in
 * browser tab) or `plugin://chrome@cypheria-bundled?mention=tab-v1&browserId=…&tabId=…&…` (an
 * external browser tab). Anything else is rejected rather than guessed at.
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
  const { browserId, mention: version, tabId, title, url: pageUrl } = fields
  if (
    version !== "tab-v1" ||
    !tabId?.trim() ||
    title === undefined ||
    pageUrl === undefined ||
    (plugin === "chrome" && !browserId?.trim())
  ) {
    throw new Error("Invalid tab mention fields.")
  }
  return { browserId, plugin, tabId, title, url: pageUrl }
}

/** Fails closed when a mentioned tab changed after the user mentioned it. */
export const assertMentionCurrent = (
  mention: TabMention,
  tab: { title: string; url: string }
): void => {
  if (tab.title !== mention.title || tab.url !== mention.url) {
    throw new Error("Stale tab mention: the tab's title or URL has changed since it was mentioned.")
  }
}
