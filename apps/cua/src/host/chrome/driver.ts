import type { ChromeBrowserInfo } from "../../browser/types.ts"
import type { CdpTransport } from "../../engine/transport.ts"

/** A tab of the user's browser, as a driver lists it. */
export type DriverTab = {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active?: boolean
  readonly lastOpened?: string
  readonly tabGroup?: string
}

/**
 * One Chromium browser profile the `chrome` backend drives: a profile with the Cypheria
 * extension (`extension`), or a profile of a running browser reached over its DevTools endpoint
 * (`cdp`). Drivers only manage tabs and hand out CDP transports; `ChromeSessions` owns Thread scoping and the engine owns page behavior, so both
 * drivers offer the same API and the model cannot tell them apart.
 */
export interface ChromeDriver {
  /** The browser as this device lists it; `id` is unique on the device. */
  info(): ChromeBrowserInfo
  /** Whether the agent may list and claim the user's own tabs. */
  readonly userTabs: boolean
  listTabs(): Promise<DriverTab[]>
  /** Opens a background tab for a Thread; `sessionName` labels the Thread's tab group. */
  openTab(threadId: string, sessionName: string | undefined): Promise<string>
  /** Renames the Thread's tab group, where the browser has tab groups. */
  nameSession?(threadId: string, name: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  /** A CDP transport to the tab, attaching on first use. */
  transport(tabId: string): Promise<CdpTransport>
  /** Detaches from a tab the agent no longer controls, leaving it open. */
  release(tabId: string): Promise<void>
  /** Shows the agent's pointer at a point, where the browser can draw it. */
  showCursor?(tabId: string, point: { x: number; y: number }): Promise<void>
  waitForDownload?(
    tabId: string,
    timeoutMs: number
  ): Promise<{ path: string; suggestedFilename?: string }>
  /** Lets the driver release what a Thread's turn held, such as the tab group's activity mark. */
  turnEnded?(threadId: string): Promise<void>
  dispose(): void
}
