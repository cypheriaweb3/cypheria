import type { CypheriaClient } from "@cypheria/client"
import { useEffect } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { mountBrowserAutomationHost } from "./automation-host.js"
import {
  getResidentBrowserWebview,
  isBrowserAvailable,
  removeResidentBrowserWebview,
} from "./resident-webviews.js"
import { browserTabsStore } from "./store.js"

const listThreadIds = async (client: CypheriaClient): Promise<Set<string>> => {
  const ids = new Set<string>()
  for (const archived of [false, true]) {
    let cursor: string | null = null
    do {
      const page = await client.threads.list({ archived, cursor, limit: 200 })
      for (const thread of page.data) ids.add(thread.id)
      cursor = page.nextCursor
    } while (cursor)
  }
  return ids
}

/** Closes tabs of Threads deleted while this window was not listening. */
const pruneDeletedThreadTabs = async (client: CypheriaClient) => {
  const listedAt = Date.now()
  const threadIds = await listThreadIds(client)
  for (const browserId of await browserTabsStore.pruneDeletedThreads(threadIds, listedAt)) {
    removeResidentBrowserWebview(browserId)
  }
}

/**
 * Browser wiring for each Desktop window: registers the window as a browser host with the
 * Server, opens tabs requested by pages, and drops tabs of deleted Threads. Deletion notifications
 * can be missed while disconnected, so every (re)connection also reconciles against the Server.
 */
export function BrowserRuntime() {
  useEffect(() => {
    const bridge = window.cypheria?.browser
    if (!bridge || !isBrowserAvailable()) return
    let disposed = false
    const disposers: Array<() => void> = []

    void browserTabsStore.load()
    // Another window may close a tab this window also shows; drop this window's guest for it.
    let known = new Set(browserTabsStore.getSnapshot().tabs.map((tab) => tab.browserId))
    disposers.push(
      browserTabsStore.subscribe(() => {
        const current = new Set(browserTabsStore.getSnapshot().tabs.map((tab) => tab.browserId))
        for (const browserId of known) {
          if (!current.has(browserId) && getResidentBrowserWebview(browserId)) {
            removeResidentBrowserWebview(browserId)
          }
        }
        known = current
      })
    )
    // Browser pages keep every shortcut except the reserved address-bar and reload keys, which
    // Electron main handles directly.
    void bridge.setShortcutPolicy({ menuPrefixes: [], prefixes: [] }).catch(() => undefined)

    disposers.push(
      bridge.onNewTabRequest(({ sourceBrowserId, url }) => {
        const source = browserTabsStore.get(sourceBrowserId)
        if (!source) return
        try {
          browserTabsStore.create({
            activate: true,
            afterBrowserId: sourceBrowserId,
            kind: source.kind,
            threadId: source.threadId,
            url,
          })
        } catch {
          // Non-web URLs are ignored.
        }
      })
    )

    void ensureCypheriaClient().then((client) => {
      if (disposed) return
      disposers.push(mountBrowserAutomationHost(client))
      disposers.push(
        client.on("thread.deleted.notification", ({ payload }) => {
          for (const browserId of browserTabsStore.removeThread(payload.threadId)) {
            removeResidentBrowserWebview(browserId)
          }
        })
      )
      disposers.push(
        client.subscribeConnectionStatus((state) => {
          if (state.status !== "connected") return
          pruneDeletedThreadTabs(client).catch((error: unknown) => {
            // A failed listing proves nothing about which Threads exist; keep every tab.
            console.warn("[browser] could not reconcile tabs with threads", error)
          })
        })
      )
    })

    return () => {
      disposed = true
      for (const dispose of disposers) dispose()
    }
  }, [])
  return null
}
