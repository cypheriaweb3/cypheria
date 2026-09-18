import { describe, expect, it } from "vitest"

import { ThreadTimelineStore } from "./timeline-store.js"

describe("ThreadTimelineStore", () => {
  it("sequences canonical rows and folds projected deltas", () => {
    const store = new ThreadTimelineStore()
    const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf399"
    store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "hel", type: "message" },
    })
    store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "lo", type: "message" },
    })

    const canonical = store.page(threadId, {
      direction: "tail",
      limit: 100,
      projection: "canonical",
    })
    expect(canonical.canonicalRows.map((row) => row.seq)).toEqual([1, 2])
    const projected = store.page(threadId, {
      direction: "tail",
      limit: 100,
      projection: "projected",
    })
    expect(projected.projectedItems).toHaveLength(1)
    expect(projected.projectedItems[0]?.item).toMatchObject({ text: "hello" })
  })

  it("changes epoch on hydration and marks stale cursors for reset", () => {
    const store = new ThreadTimelineStore()
    const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf399"
    const previous = store.head(threadId)
    const next = store.replace(threadId, [])
    expect(next.epoch).not.toBe(previous.epoch)
    expect(
      store.page(threadId, {
        cursor: { epoch: previous.epoch, seq: 0 },
        direction: "after",
        limit: 100,
        projection: "canonical",
      }).reset
    ).toBe(true)
  })
})
