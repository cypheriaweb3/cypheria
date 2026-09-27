import { useSyncExternalStore } from "react"

import type { BrowserScopeId } from "../../../ipc/src/browser.js"
import { desktopClientStorage } from "../storage.js"
import {
  activateBrowserTab,
  addBrowserTab,
  BROWSER_TABS_STORAGE_KEY,
  type BrowserTabKind,
  type BrowserTabPatch,
  type BrowserTabRecord,
  type BrowserTabsState,
  emptyBrowserTabsState,
  normalizeBrowserUrl,
  parseBrowserTabsState,
  patchBrowserTab,
  RESPONSIVE_VIEWPORT,
  removeBrowserTab,
  serializeBrowserTabsState,
} from "./state.js"

type Listener = () => void

/**
 * Device-local browser tab index persisted in Desktop client KV. Page state lives in the
 * resident `<webview>` guests; this store only keeps what is needed to restore and list tabs.
 */
class BrowserTabsStore {
  #state: BrowserTabsState = emptyBrowserTabsState()
  #listeners = new Set<Listener>()
  #loaded: Promise<void> | null = null
  #saveTimer: ReturnType<typeof setTimeout> | null = null

  getSnapshot = (): BrowserTabsState => this.#state

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    void this.load()
    return () => this.#listeners.delete(listener)
  }

  load(): Promise<void> {
    this.#loaded ??= desktopClientStorage.keyValue
      .getItem(BROWSER_TABS_STORAGE_KEY)
      .then((raw) => {
        // Tabs created before the load finished win over the restored copy of the same id.
        const restored = parseBrowserTabsState(raw ? JSON.parse(raw) : null)
        const created = this.#state
        const createdIds = new Set(created.tabs.map((tab) => tab.browserId))
        this.#set(
          {
            activeByScope: { ...restored.activeByScope, ...created.activeByScope },
            tabs: [
              ...restored.tabs.filter((tab) => !createdIds.has(tab.browserId)),
              ...created.tabs,
            ],
          },
          false
        )
      })
      .catch(() => undefined)
    return this.#loaded
  }

  get(browserId: string): BrowserTabRecord | undefined {
    return this.#state.tabs.find((tab) => tab.browserId === browserId)
  }

  create(input: {
    scopeId: BrowserScopeId
    kind: BrowserTabKind
    url?: string | null
    activate?: boolean
    afterBrowserId?: string
  }): BrowserTabRecord {
    const url = normalizeBrowserUrl(input.url)
    if (!url) throw new Error("Browser tabs only open http(s) URLs.")
    const record: BrowserTabRecord = {
      browserId: crypto.randomUUID(),
      canGoBack: false,
      canGoForward: false,
      createdAt: Date.now(),
      faviconUrl: null,
      isLoading: false,
      kind: input.kind,
      lastError: null,
      scopeId: input.scopeId,
      title: "",
      url,
      viewport: RESPONSIVE_VIEWPORT,
    }
    this.#set(
      addBrowserTab(this.#state, record, {
        activate: input.activate ?? true,
        ...(input.afterBrowserId ? { afterBrowserId: input.afterBrowserId } : {}),
      })
    )
    return record
  }

  patch(browserId: string, patch: BrowserTabPatch): void {
    this.#set(patchBrowserTab(this.#state, browserId, patch))
  }

  remove(browserId: string): void {
    this.#set(removeBrowserTab(this.#state, browserId))
  }

  activate(browserId: string): void {
    this.#set(activateBrowserTab(this.#state, browserId))
  }

  removeScope(scopeId: string): string[] {
    const removed = this.#state.tabs.filter((tab) => tab.scopeId === scopeId)
    let next = this.#state
    for (const tab of removed) next = removeBrowserTab(next, tab.browserId)
    this.#set(next)
    return removed.map((tab) => tab.browserId)
  }

  #set(next: BrowserTabsState, persist = true): void {
    if (next === this.#state) return
    this.#state = next
    for (const listener of this.#listeners) listener()
    if (persist) this.#schedulePersist()
  }

  #schedulePersist(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null
      void desktopClientStorage.keyValue
        .setItem(BROWSER_TABS_STORAGE_KEY, JSON.stringify(serializeBrowserTabsState(this.#state)))
        .catch(() => undefined)
    }, 250)
  }
}

export const browserTabsStore = new BrowserTabsStore()

export const useBrowserTabsState = (): BrowserTabsState =>
  useSyncExternalStore(
    browserTabsStore.subscribe,
    browserTabsStore.getSnapshot,
    browserTabsStore.getSnapshot
  )
