// Tab record model adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/app/src/desktop/browser/store/state.ts.
import { z } from "zod"

import { BrowserThreadIdSchema } from "../../../ipc/src/browser.js"

export type BrowserTabKind = "web" | "dapp"

export type BrowserViewport =
  | { mode: "responsive" }
  | { mode: "fixed"; width: number; height: number }

export type BrowserTabRecord = {
  browserId: string
  threadId: string
  kind: BrowserTabKind
  url: string
  title: string
  faviconUrl: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastError: string | null
  viewport: BrowserViewport
  createdAt: number
}

export type BrowserTabsState = {
  /** Tabs in display order. */
  tabs: BrowserTabRecord[]
  activeByThread: Record<string, string>
}

export type BrowserTabPatch = Partial<
  Omit<BrowserTabRecord, "browserId" | "createdAt" | "threadId">
>

export const BROWSER_TABS_STORAGE_KEY = "browserTabs"
/** At most this many tabs are persisted; the oldest are dropped first. */
export const BROWSER_TABS_LIMIT = 200
export const DEFAULT_BROWSER_URL = "about:blank"
export const RESPONSIVE_VIEWPORT: BrowserViewport = { mode: "responsive" }

const ViewportSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("responsive") }).strict(),
  z
    .object({
      height: z.int().positive().max(10_000),
      mode: z.literal("fixed"),
      width: z.int().positive().max(10_000),
    })
    .strict(),
])

const BrowserTabRecordSchema = z
  .object({
    browserId: z.uuid(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    createdAt: z.number(),
    faviconUrl: z.string().nullable(),
    isLoading: z.boolean(),
    kind: z.enum(["web", "dapp"]),
    lastError: z.string().nullable(),
    threadId: BrowserThreadIdSchema,
    title: z.string(),
    url: z.string(),
    viewport: ViewportSchema,
  })
  .strict()

/** Records are validated one by one so a single bad entry cannot discard every tab. */
const StoredBrowserTabsSchema = z.object({
  activeByThread: z.record(z.string(), z.unknown()),
  tabs: z.array(z.unknown()),
  version: z.literal(1),
})

export const emptyBrowserTabsState = (): BrowserTabsState => ({ activeByThread: {}, tabs: [] })

/** Normalizes what a user typed into an address bar. Returns null for unsupported schemes. */
export const normalizeBrowserUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_BROWSER_URL
  if (trimmed === DEFAULT_BROWSER_URL) return trimmed
  const candidate = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/iu.test(trimmed)
    ? `http://${trimmed}`
    : /^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^[^/:]+:\d+(\/|$)/u.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

/** Keeps the newest `BROWSER_TABS_LIMIT` tabs in display order. */
const capBrowserTabs = (tabs: BrowserTabRecord[]): BrowserTabRecord[] => {
  if (tabs.length <= BROWSER_TABS_LIMIT) return tabs
  const kept = new Set(
    [...tabs]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, BROWSER_TABS_LIMIT)
      .map((tab) => tab.browserId)
  )
  return tabs.filter((tab) => kept.has(tab.browserId))
}

/** Drops active-tab entries that no longer point at a tab of the same Thread. */
const withValidActiveTabs = (
  tabs: BrowserTabRecord[],
  activeByThread: Record<string, unknown>
): BrowserTabsState => {
  const threadByTab = new Map(tabs.map((tab) => [tab.browserId, tab.threadId]))
  return {
    activeByThread: Object.fromEntries(
      Object.entries(activeByThread).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && threadByTab.get(entry[1]) === entry[0]
      )
    ),
    tabs,
  }
}

export const parseBrowserTabsState = (value: unknown): BrowserTabsState => {
  const stored = StoredBrowserTabsSchema.safeParse(value)
  if (!stored.success) return emptyBrowserTabsState()
  const ids = new Set<string>()
  const tabs: BrowserTabRecord[] = []
  for (const candidate of stored.data.tabs) {
    const tab = BrowserTabRecordSchema.safeParse(candidate)
    if (!tab.success || ids.has(tab.data.browserId)) continue
    ids.add(tab.data.browserId)
    tabs.push(tab.data)
  }
  return withValidActiveTabs(capBrowserTabs(tabs), stored.data.activeByThread)
}

/** Transient page state is not persisted: a restored tab reloads from its URL. */
export const serializeBrowserTabsState = (state: BrowserTabsState) => {
  const { activeByThread, tabs } = withValidActiveTabs(
    capBrowserTabs(state.tabs),
    state.activeByThread
  )
  return {
    activeByThread,
    tabs: tabs.map((tab) => ({ ...tab, isLoading: false, lastError: null })),
    version: 1 as const,
  }
}

export const addBrowserTab = (
  state: BrowserTabsState,
  record: BrowserTabRecord,
  options: { activate: boolean; afterBrowserId?: string }
): BrowserTabsState => {
  const tabs = [...state.tabs]
  const anchor = options.afterBrowserId
    ? tabs.findIndex((tab) => tab.browserId === options.afterBrowserId)
    : -1
  if (anchor >= 0) tabs.splice(anchor + 1, 0, record)
  else tabs.push(record)
  const activeByThread =
    options.activate || !state.activeByThread[record.threadId]
      ? { ...state.activeByThread, [record.threadId]: record.browserId }
      : state.activeByThread
  return { activeByThread, tabs }
}

export const patchBrowserTab = (
  state: BrowserTabsState,
  browserId: string,
  patch: BrowserTabPatch
): BrowserTabsState => {
  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.browserId !== browserId) return tab
    const next = { ...tab, ...patch }
    changed = (Object.keys(patch) as Array<keyof BrowserTabPatch>).some(
      (key) => JSON.stringify(tab[key]) !== JSON.stringify(next[key])
    )
    return next
  })
  return changed ? { ...state, tabs } : state
}

export const removeBrowserTab = (state: BrowserTabsState, browserId: string): BrowserTabsState => {
  const removed = state.tabs.find((tab) => tab.browserId === browserId)
  if (!removed) return state
  const siblings = state.tabs.filter((tab) => tab.threadId === removed.threadId)
  const tabs = state.tabs.filter((tab) => tab.browserId !== browserId)
  const activeByThread = { ...state.activeByThread }
  if (activeByThread[removed.threadId] === browserId) {
    const index = siblings.findIndex((tab) => tab.browserId === browserId)
    const next = siblings.filter((tab) => tab.browserId !== browserId)[Math.max(0, index - 1)]
    if (next) activeByThread[removed.threadId] = next.browserId
    else delete activeByThread[removed.threadId]
  }
  return { activeByThread, tabs }
}

export const activateBrowserTab = (
  state: BrowserTabsState,
  browserId: string
): BrowserTabsState => {
  const tab = state.tabs.find((candidate) => candidate.browserId === browserId)
  if (!tab || state.activeByThread[tab.threadId] === browserId) return state
  return { ...state, activeByThread: { ...state.activeByThread, [tab.threadId]: browserId } }
}

export const tabsForThread = (state: BrowserTabsState, threadId: string): BrowserTabRecord[] =>
  state.tabs.filter((tab) => tab.threadId === threadId)
