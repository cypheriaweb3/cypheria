import { useEffect } from "react"

import { ensureCypheriaClient } from "../cypheria-client.js"
import { mountBrowserAutomationHost } from "./automation-host.js"
import { isBrowserAvailable, removeResidentBrowserWebview } from "./resident-webviews.js"
import { browserTabsStore } from "./store.js"

/**
 * App-wide browser wiring for the main Desktop window: registers this window as the Server's
 * browser host, opens tabs requested by pages, and drops tabs of deleted Threads.
 */
export function BrowserRuntime() {
  useEffect(() => {
    const bridge = window.cypheria?.browser
    if (!bridge || !isBrowserAvailable()) return
    let disposed = false
    const disposers: Array<() => void> = []

    void browserTabsStore.load()
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
    })

    return () => {
      disposed = true
      for (const dispose of disposers) dispose()
    }
  }, [])
  return null
}
