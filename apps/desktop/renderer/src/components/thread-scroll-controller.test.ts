import { describe, expect, it } from "vitest"
import {
  getBottomDistanceRestoreOffset,
  type ThreadScrollRestoreState,
  ThreadScrollStateCache,
} from "./thread-scroll-controller"

const state = (scrollOffsetPx: number): ThreadScrollRestoreState => ({
  anchor: null,
  distanceFromBottomPx: 120,
  measurements: [],
  scrollOffsetPx,
  viewportHeightPx: 800,
  wasAtBottom: false,
})

describe("ThreadScrollStateCache", () => {
  it("retains recently used thread states and evicts the least recently used entry", () => {
    const cache = new ThreadScrollStateCache(2)
    cache.set("thread-a", state(100))
    cache.set("thread-b", state(200))

    expect(cache.get("thread-a")?.scrollOffsetPx).toBe(100)

    cache.set("thread-c", state(300))

    expect(cache.get("thread-b")).toBeNull()
    expect(cache.get("thread-a")?.scrollOffsetPx).toBe(100)
    expect(cache.get("thread-c")?.scrollOffsetPx).toBe(300)
    expect(cache.size).toBe(2)
  })

  it("replaces an existing state without consuming another retention slot", () => {
    const cache = new ThreadScrollStateCache(2)
    cache.set("thread-a", state(100))
    cache.set("thread-a", state(240))

    expect(cache.size).toBe(1)
    expect(cache.get("thread-a")?.scrollOffsetPx).toBe(240)
  })
})

describe("getBottomDistanceRestoreOffset", () => {
  it("restores a bottom-relative position after the content height changes", () => {
    expect(
      getBottomDistanceRestoreOffset({
        clientHeight: 800,
        distanceFromBottomPx: 250,
        scrollHeight: 3_000,
      })
    ).toBe(1_950)
  })

  it("clamps an unreachable offset to the start", () => {
    expect(
      getBottomDistanceRestoreOffset({
        clientHeight: 800,
        distanceFromBottomPx: 500,
        scrollHeight: 1_000,
      })
    ).toBe(0)
  })
})
