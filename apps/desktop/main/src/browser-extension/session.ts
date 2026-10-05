import type { Peer } from "@cypheria/browser-extension/peer"
import {
  type BrowserInfo,
  type DesktopMethod,
  type DesktopParams,
  DesktopRequests,
  type DesktopResult,
  type ExtensionNotificationParams,
  ExtensionNotifications,
} from "@cypheria/browser-extension/protocol"
import type { CdpEvent, CdpTransport } from "@cypheria/cua/engine"

type DownloadListener = (change: ExtensionNotificationParams<"downloadChanged">) => void

/**
 * One connected browser profile with the Cypheria extension. It types Desktop's requests,
 * routes forwarded CDP events to each tab's transport, and reports downloads.
 */
export class ExtensionSession {
  readonly peer: Peer
  readonly #close: () => void
  readonly #events = new Map<number, Set<(event: CdpEvent) => void>>()
  readonly #detached = new Map<number, Set<() => void>>()
  readonly #downloads = new Set<DownloadListener>()
  #info: BrowserInfo | undefined
  #closed = false
  /** When the session connected, which orders profiles of one family. */
  readonly connectedAt = Date.now()

  constructor(options: { readonly peer: Peer; readonly close: () => void }) {
    this.peer = options.peer
    this.#close = options.close
  }

  get info(): BrowserInfo | undefined {
    return this.#info
  }

  get isClosed(): boolean {
    return this.#closed
  }

  identified(info: BrowserInfo): void {
    this.#info = info
  }

  async request<M extends DesktopMethod>(
    method: M,
    params: DesktopParams<M>
  ): Promise<DesktopResult<M>> {
    const result = await this.peer.request(method, params)
    return DesktopRequests[method].result.parse(result) as DesktopResult<M>
  }

  /** Handles a notification from the extension. */
  notification(method: string, params: unknown): void {
    switch (method) {
      case "cdpEvent": {
        const parsed = ExtensionNotifications.cdpEvent.safeParse(params)
        if (!parsed.success) return
        const event = { method: parsed.data.method, params: parsed.data.params ?? {} }
        for (const listener of this.#events.get(parsed.data.tabId) ?? []) listener(event)
        return
      }
      case "cdpDetached": {
        const parsed = ExtensionNotifications.cdpDetached.safeParse(params)
        if (parsed.success) this.#detach(parsed.data.tabId)
        return
      }
      case "downloadChanged": {
        const parsed = ExtensionNotifications.downloadChanged.safeParse(params)
        if (!parsed.success) return
        for (const listener of this.#downloads) listener(parsed.data)
        return
      }
    }
  }

  /** Subscribes to download changes; returns the unsubscribe function. */
  onDownload(listener: DownloadListener): () => void {
    this.#downloads.add(listener)
    return () => this.#downloads.delete(listener)
  }

  /**
   * The CDP transport to a tab, through the extension's `chrome.debugger`. The extension
   * attaches on the first command; detaching leaves the tab open.
   */
  async transport(tabId: number): Promise<CdpTransport> {
    await this.request("attach", { tabId })
    let open = true
    const listeners = new Set<(event: CdpEvent) => void>()
    const closers = new Set<() => void>()
    let events = this.#events.get(tabId)
    if (!events) {
      events = new Set()
      this.#events.set(tabId, events)
    }
    const forward = (event: CdpEvent) => {
      for (const listener of listeners) listener(event)
    }
    events.add(forward)
    let detached = this.#detached.get(tabId)
    if (!detached) {
      detached = new Set()
      this.#detached.set(tabId, detached)
    }
    const onDetached = () => {
      if (!open) return
      open = false
      events?.delete(forward)
      detached?.delete(onDetached)
      for (const closer of closers) closer()
    }
    detached.add(onDetached)
    return {
      detach: async () => {
        onDetached()
        await this.request("detach", { tabId }).catch(() => undefined)
      },
      onClose: (listener) => {
        closers.add(listener)
        return () => closers.delete(listener)
      },
      onEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      send: async <T = Record<string, unknown>>(
        method: string,
        params?: Record<string, unknown>
      ): Promise<T> => {
        if (!open) throw new Error(`Tab ${tabId} is no longer attached.`)
        return (await this.request("cdp", {
          method,
          tabId,
          ...(params ? { params } : {}),
        })) as T
      },
    }
  }

  close(): void {
    this.#close()
  }

  /** Called when the connection is gone. */
  closed(): void {
    this.#closed = true
    for (const tabId of [...this.#detached.keys()]) this.#detach(tabId)
    this.#downloads.clear()
  }

  #detach(tabId: number): void {
    for (const listener of [...(this.#detached.get(tabId) ?? [])]) listener()
    this.#detached.delete(tabId)
    this.#events.delete(tabId)
  }
}
