/** One Chrome DevTools Protocol event from a page target. */
export type CdpEvent = { readonly method: string; readonly params: Record<string, unknown> }

/**
 * The CDP connection to one page target, however the backend reaches it: Electron's
 * `webContents.debugger` for the built-in browser, a browser's own CDP WebSocket, or the
 * commands and events the Cypheria extension forwards from `chrome.debugger`.
 */
export interface CdpTransport {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribes to the target's events; returns the unsubscribe function. */
  onEvent(listener: (event: CdpEvent) => void): () => void
  /** Ends the session and leaves the tab open. */
  detach?(): Promise<void>
  /** Called once when the transport is gone, such as when the tab closed or detached. */
  onClose?(listener: () => void): () => void
  /**
   * Captures the viewport when the backend has a better path than `Page.captureScreenshot`,
   * such as a parked built-in browser tab that only paints on request.
   */
  captureViewport?(): Promise<{ readonly data: Uint8Array; readonly mimeType: string }>
}
