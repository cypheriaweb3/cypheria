/**
 * The browser backends a host reports, with ChatGPT's names: the built-in browser (`iab`), the
 * MCP Apps Desktop windows show (`mcpapps`), and the user's Chromium browsers (`chrome`). A
 * browser's type is its backend, which selects its documents and the API members it supports.
 * How a device drives `chrome` is its implementation type, which stays on the device.
 */
export const BROWSER_BACKENDS = ["iab", "mcpapps", "chrome"] as const
export type BrowserBackend = (typeof BROWSER_BACKENDS)[number]

/** A browser as `agent.browsers.list()` shows it. */
export type BrowserInfo = {
  readonly id: string
  readonly name: string
  readonly type: BrowserBackend
  readonly family?: string
  readonly profileName?: string
  /** Whether this is the profile the person used last, which a family name resolves to. */
  readonly lastUsed?: boolean
  /** The device the browser runs on; absent for browsers that span devices. */
  readonly host?: string
}

/** A `chrome` browser as a device reports it; the Server adds its type and device. */
export type ChromeBrowserInfo = Omit<BrowserInfo, "type" | "host">

/** A tab an agent controls, as `browser.tabs.list()` shows it. */
export type TabInfo = {
  readonly id: string
  /** The browser's own tab ID, which tab mentions carry. */
  readonly providerTabId?: string
  readonly title?: string
  readonly url?: string
  /** The device that shows the tab, for browsers that span devices. */
  readonly host?: string
}

/** An open tab of the user's own browser, as `browser.user.openTabs()` shows it. */
export type UserTabInfo = {
  readonly id: string
  readonly providerTabId?: string
  readonly title?: string
  readonly url?: string
  /** ISO 8601 time the tab was last opened or focused. */
  readonly lastOpened?: string
  /** The user-visible name of the tab's group. */
  readonly tabGroup?: string
}

/** An image crossing the RPC boundary. */
export type WireImage = {
  readonly type: "image"
  readonly dataBase64: string
  readonly mimeType: string
}

/** A JavaScript dialog a page is showing. */
export type DialogInfo = {
  readonly type: "alert" | "beforeunload" | "confirm" | "prompt"
  readonly message: string
  readonly defaultValue?: string
}

/** A pending download or file chooser, held by the device until it is used. */
export type EventHandleInfo =
  | { readonly kind: "download"; readonly handle: string; readonly suggestedFilename?: string }
  | { readonly kind: "filechooser"; readonly handle: string; readonly isMultiple: boolean }

export type LogEntry = {
  readonly level: "debug" | "info" | "log" | "warn" | "error"
  readonly message: string
  /** ISO 8601 time the log was captured. */
  readonly timestamp: string
  readonly url?: string
}

export type ClipboardEntry = {
  readonly mimeType: string
  readonly text?: string
  readonly base64?: string
}
export type ClipboardItem = {
  readonly entries: readonly ClipboardEntry[]
  readonly presentationStyle?: "unspecified" | "inline" | "attachment"
}
