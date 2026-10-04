/**
 * The external Chromium browsers `cua.browsers` can attach to. Each is driven over the Chrome
 * DevTools Protocol by agent-browser once the person enables remote debugging in that browser.
 */
export const BROWSER_FAMILIES = ["chrome", "edge", "brave", "vivaldi", "opera", "chromium"] as const
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number]

export type BrowserFamilyInfo = {
  readonly family: BrowserFamily
  readonly displayName: string
  /** The page in that browser where the person turns on remote debugging. */
  readonly inspectUrl: string
}

export const BROWSER_FAMILY_INFO: Record<BrowserFamily, BrowserFamilyInfo> = {
  brave: {
    displayName: "Brave",
    family: "brave",
    inspectUrl: "brave://inspect/#remote-debugging",
  },
  chrome: {
    displayName: "Google Chrome",
    family: "chrome",
    inspectUrl: "chrome://inspect/#remote-debugging",
  },
  chromium: {
    displayName: "Chromium",
    family: "chromium",
    inspectUrl: "chrome://inspect/#remote-debugging",
  },
  edge: {
    displayName: "Microsoft Edge",
    family: "edge",
    inspectUrl: "edge://inspect/#remote-debugging",
  },
  opera: {
    displayName: "Opera",
    family: "opera",
    inspectUrl: "opera://inspect/#remote-debugging",
  },
  vivaldi: {
    displayName: "Vivaldi",
    family: "vivaldi",
    inspectUrl: "vivaldi://inspect/#remote-debugging",
  },
}

export const isBrowserFamily = (value: string): value is BrowserFamily =>
  (BROWSER_FAMILIES as readonly string[]).includes(value)
