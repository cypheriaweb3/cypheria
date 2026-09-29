import { afterEach, describe, expect, it, vi } from "vitest"

import { browserTabsStore } from "./store.js"

const liveThread = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const deletedThread = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

describe("browser tabs store", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("prunes tabs of Threads missing from the Server listing", async () => {
    vi.useFakeTimers({ now: 1_000 })
    const live = browserTabsStore.create({ kind: "web", threadId: liveThread })
    const orphan = browserTabsStore.create({ kind: "dapp", threadId: deletedThread })
    const listedAt = 2_000
    // A tab opened after the listing started may belong to a Thread the listing missed.
    vi.setSystemTime(listedAt)
    const fresh = browserTabsStore.create({ kind: "web", threadId: deletedThread })

    const removed = await browserTabsStore.pruneDeletedThreads(new Set([liveThread]), listedAt)

    expect(removed).toEqual([orphan.browserId])
    expect(browserTabsStore.get(live.browserId)).toBeDefined()
    expect(browserTabsStore.get(orphan.browserId)).toBeUndefined()
    expect(browserTabsStore.get(fresh.browserId)).toBeDefined()
  })
})
