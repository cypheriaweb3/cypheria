import { describe, expect, it } from "vitest"

import {
  activateBrowserTab,
  addBrowserTab,
  BROWSER_TABS_LIMIT,
  type BrowserTabRecord,
  emptyBrowserTabsState,
  normalizeBrowserUrl,
  parseBrowserTabsState,
  patchBrowserTab,
  removeBrowserTab,
  serializeBrowserTabsState,
  tabsForThread,
} from "./state.js"

const thread = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const otherThread = "01984de2-8f74-7c91-a3b2-5c5e937cf319"
const tab = (browserId: string, threadId = thread): BrowserTabRecord => ({
  browserId,
  canGoBack: false,
  canGoForward: false,
  createdAt: 1,
  faviconUrl: null,
  isLoading: true,
  kind: "web",
  lastError: "boom",
  threadId: threadId as BrowserTabRecord["threadId"],
  title: "",
  url: "https://example.com/",
  viewport: { mode: "responsive" },
})
const a = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"
const b = "9d2c0f52-7a1b-4c3e-8f55-1b2c3d4e5f60"
const c = "0f2c0f52-7a1b-4c3e-8f55-1b2c3d4e5f61"

describe("browser tab state", () => {
  it("normalizes typed addresses and rejects non-web schemes", () => {
    expect(normalizeBrowserUrl("example.com/path")).toBe("https://example.com/path")
    expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/")
    expect(normalizeBrowserUrl("")).toBe("about:blank")
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull()
  })

  it("inserts tabs after an anchor and activates the first tab of a scope", () => {
    let state = addBrowserTab(emptyBrowserTabsState(), tab(a), { activate: false })
    expect(state.activeByThread[thread]).toBe(a)
    state = addBrowserTab(state, tab(b), { activate: false })
    state = addBrowserTab(state, tab(c), { activate: true, afterBrowserId: a })
    expect(state.tabs.map((entry) => entry.browserId)).toEqual([a, c, b])
    expect(state.activeByThread[thread]).toBe(c)
  })

  it("selects a neighbor when the active tab closes", () => {
    let state = emptyBrowserTabsState()
    for (const id of [a, b, c]) state = addBrowserTab(state, tab(id), { activate: true })
    state = removeBrowserTab(activateBrowserTab(state, b), b)
    expect(state.activeByThread[thread]).toBe(a)
    state = removeBrowserTab(removeBrowserTab(state, a), c)
    expect(state.activeByThread[thread]).toBeUndefined()
  })

  it("keeps scopes separate and ignores no-op patches", () => {
    let state = addBrowserTab(emptyBrowserTabsState(), tab(a), { activate: true })
    state = addBrowserTab(state, tab(b, otherThread), { activate: true })
    expect(tabsForThread(state, otherThread).map((entry) => entry.browserId)).toEqual([b])
    expect(patchBrowserTab(state, a, { title: "" })).toBe(state)
    expect(patchBrowserTab(state, a, { title: "Docs" }).tabs[0]?.title).toBe("Docs")
  })

  it("persists without transient page state and drops invalid data", () => {
    const state = addBrowserTab(emptyBrowserTabsState(), tab(a), { activate: true })
    const restored = parseBrowserTabsState(
      JSON.parse(JSON.stringify(serializeBrowserTabsState(state)))
    )
    expect(restored.tabs[0]).toMatchObject({ isLoading: false, lastError: null })
    expect(restored.activeByThread[thread]).toBe(a)
    expect(parseBrowserTabsState({ tabs: "nope" })).toEqual(emptyBrowserTabsState())
    expect(
      parseBrowserTabsState({ ...serializeBrowserTabsState(state), activeByThread: { x: b } })
        .activeByThread
    ).toEqual({})
  })

  it("keeps valid tabs when other stored records are corrupt", () => {
    const stored = serializeBrowserTabsState(
      addBrowserTab(emptyBrowserTabsState(), tab(a), { activate: true })
    )
    const restored = parseBrowserTabsState({
      ...stored,
      activeByThread: { ...stored.activeByThread, [otherThread]: a },
      tabs: [...stored.tabs, { browserId: b, url: 42 }, stored.tabs[0]],
    })
    expect(restored.tabs.map((entry) => entry.browserId)).toEqual([a])
    expect(restored.activeByThread).toEqual({ [thread]: a })
  })

  it("persists only the newest tabs beyond the limit", () => {
    const ids = Array.from(
      { length: BROWSER_TABS_LIMIT + 2 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    )
    const state = {
      activeByThread: { [thread]: ids[0] as string },
      tabs: ids.map((id, index) => ({ ...tab(id), createdAt: index })),
    }
    const restored = parseBrowserTabsState(
      JSON.parse(JSON.stringify(serializeBrowserTabsState(state)))
    )
    expect(restored.tabs.map((entry) => entry.browserId)).toEqual(ids.slice(2))
    expect(restored.activeByThread).toEqual({})
    expect(parseBrowserTabsState({ ...state, version: 1 }).tabs).toHaveLength(BROWSER_TABS_LIMIT)
  })
})
