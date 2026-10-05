// Browser host adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/app/src/desktop/browser/automation/handler.ts.
import type { CypheriaClient } from "@cypheria/client"
import {
  type BrowserHostCall,
  BrowserHostRequestSchema,
  isBrowserMember,
  supports,
  type TabInfo,
} from "@cypheria/cua/browser"
import type { BrowserAutomationOutcomeInput, BrowserAutomationRequest } from "@cypheria/protocol"

import type { BrowserCallOutcome } from "../../../ipc/src/index.js"
import { mountedMcpApp, mountedMcpApps } from "./mcp-app-registry.js"
import {
  ensureResidentBrowserWebview,
  getResidentBrowserWebview,
  isBrowserAvailable,
  removeResidentBrowserWebview,
  setResidentBrowserViewport,
  waitForBrowserRegistration,
} from "./resident-webviews.js"
import { type BrowserTabRecord, RESPONSIVE_VIEWPORT } from "./state.js"
import { browserTabsStore } from "./store.js"
import { isBrowserPaneShown, requestBrowserPane } from "./visibility.js"

type Bridge = NonNullable<NonNullable<Window["cypheria"]>["browser"]>

/** An error the model reads, with the code the Server reports. */
class HostError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

const VISIBILITY = {
  description:
    "Whether the built-in browser is shown beside the conversation. get() reads it; set(visible) shows or hides it.",
  id: "visibility",
}
const VIEWPORT = {
  description:
    "An explicit viewport size for the Thread's tabs. set({ width, height }) applies it; reset() returns to the pane's size.",
  id: "viewport",
}
const MAX_VIEWPORT = 10_000

/** Each Thread's viewport override, which its new tabs take too. */
const viewports = new Map<string, { width: number; height: number }>()

const applyViewport = (tab: BrowserTabRecord, size: { width: number; height: number } | null) => {
  browserTabsStore.patch(
    tab.browserId,
    size ? { viewport: { mode: "fixed", ...size } } : { viewport: RESPONSIVE_VIEWPORT }
  )
  setResidentBrowserViewport(tab.browserId, size)
}

/** Sets or clears the viewport of every tab of the Thread. */
const setViewport = (threadId: string, value: unknown): void => {
  let size: { width: number; height: number } | null = null
  if (value !== null) {
    const { height, width } = (value ?? {}) as { height?: unknown; width?: unknown }
    const valid = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= MAX_VIEWPORT
    if (!valid(width) || !valid(height)) {
      throw new HostError(
        "invalid",
        `viewport.set needs { width, height } between 1 and ${MAX_VIEWPORT} pixels.`
      )
    }
    size = { height: Math.round(height), width: Math.round(width) }
    viewports.set(threadId, size)
  } else {
    viewports.delete(threadId)
  }
  for (const tab of browserTabsStore.getSnapshot().tabs) {
    if (tab.threadId === threadId) applyViewport(tab, size)
  }
}

const tabInfo = (tab: BrowserTabRecord): TabInfo => ({
  id: tab.browserId,
  title: tab.title,
  url: tab.url,
})

/** A tab the request may address: callers only see tabs of their Thread. */
const scopedTab = (threadId: string, browserId: string | undefined): BrowserTabRecord => {
  const tab = browserId ? browserTabsStore.get(browserId) : undefined
  if (!tab || tab.threadId !== threadId) {
    throw new HostError(
      "not_found",
      `Built-in browser tab ${browserId ?? ""} is not open. List the tabs again.`
    )
  }
  return tab
}

const unwrap = (outcome: BrowserCallOutcome): unknown => {
  if (outcome.ok) return outcome.value
  throw new HostError(outcome.error.code, outcome.error.message, outcome.error.retryable)
}

/**
 * The Thread's tabs this window answers for: tabs it shows, and restored tabs no window has
 * started yet. A tab live in another window is that window's to report.
 */
const listTabs = async (threadId: string, bridge: Bridge): Promise<TabInfo[]> => {
  await browserTabsStore.load()
  const live = new Set((await bridge.listLive().catch(() => ({ browserIds: [] }))).browserIds)
  return browserTabsStore
    .getSnapshot()
    .tabs.filter((tab) => tab.threadId === threadId)
    .filter((tab) => getResidentBrowserWebview(tab.browserId) || !live.has(tab.browserId))
    .map(tabInfo)
}

const newTab = async (threadId: string): Promise<TabInfo> => {
  // A new tab comes to the front when the person is looking at the Thread's browser.
  const record = browserTabsStore.create({
    activate: isBrowserPaneShown(threadId),
    kind: "web",
    threadId,
    url: null,
  })
  const viewport = viewports.get(threadId)
  if (viewport) applyViewport(record, viewport)
  ensureResidentBrowserWebview(browserTabsStore.get(record.browserId) ?? record)
  if (!(await waitForBrowserRegistration(record.browserId))) {
    browserTabsStore.remove(record.browserId)
    removeResidentBrowserWebview(record.browserId)
    throw new HostError("timeout", "The new browser tab did not start. Try again.", true)
  }
  return tabInfo(record)
}

/** Starts a restored tab that has not been opened since launch before its page is used. */
const materialize = async (tab: BrowserTabRecord): Promise<void> => {
  ensureResidentBrowserWebview(tab)
  if (!(await waitForBrowserRegistration(tab.browserId))) {
    throw new HostError("timeout", `Browser tab ${tab.browserId} did not start.`, true)
  }
}

const builtInBrowser = async (
  request: BrowserAutomationRequest,
  call: BrowserHostCall,
  bridge: Bridge
): Promise<unknown> => {
  const { threadId } = request
  const args = call.args
  switch (call.member) {
    case "tabs.list":
      return listTabs(threadId, bridge)
    case "tabs.new":
      return newTab(threadId)
    case "tabs.get":
      return tabInfo(scopedTab(threadId, String(args[0])))
    case "tabs.selected": {
      const selected = browserTabsStore.getSnapshot().activeByThread[threadId]
      const tab = selected ? browserTabsStore.get(selected) : undefined
      return tab?.threadId === threadId ? tabInfo(tab) : null
    }
    // Built-in browser tabs have no tab groups to name.
    case "browser.nameSession":
      return null
    case "browser.capabilities":
      return [VISIBILITY, VIEWPORT]
    case "browser.capability": {
      const [id, method, values] = args as [string, string, unknown[]]
      if (id === VISIBILITY.id && method === "get") return isBrowserPaneShown(threadId)
      if (id === VISIBILITY.id && method === "set") {
        requestBrowserPane(threadId, values[0] === true)
        return null
      }
      if (id === VIEWPORT.id && (method === "set" || method === "reset")) {
        setViewport(threadId, method === "set" ? values[0] : null)
        return null
      }
      throw new HostError("unsupported", `The built-in browser has no capability ${id}.${method}.`)
    }
    default:
      break
  }
  const tab = scopedTab(threadId, call.tab)
  switch (call.member) {
    case "tab.info":
      return { title: tab.title, url: tab.url }
    case "tab.close":
      browserTabsStore.remove(tab.browserId)
      removeResidentBrowserWebview(tab.browserId)
      return null
    // The Server keeps the marks; the window has nothing to change.
    case "tab.markDeliverable":
    case "tab.markHandoff":
      return null
    case "tab.requestManualHandoff":
      browserTabsStore.activate(tab.browserId)
      requestBrowserPane(threadId, true)
      return null
    default:
      break
  }
  await materialize(tab)
  return unwrap(
    await bridge.executeAutomation({
      args: call.args,
      browserId: tab.browserId,
      member: call.member,
      threadId,
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(call.handle ? { handle: call.handle } : {}),
      ...(call.selector ? { selector: call.selector } : {}),
    })
  )
}

/** MCP Apps this window shows, for the Thread or outside any Thread. */
const mcpApps = async (
  request: BrowserAutomationRequest,
  call: BrowserHostCall,
  bridge: Bridge
): Promise<unknown> => {
  if (call.member === "tabs.list") {
    return mountedMcpApps().map((app) => ({ id: app.appId, threadId: app.threadId }))
  }
  const appId = call.member === "tabs.get" ? String(call.args[0]) : call.tab
  const app = appId ? mountedMcpApp(request.threadId, appId) : undefined
  if (!app) {
    throw new HostError("not_found", `MCP App ${appId ?? ""} is not open in this window.`)
  }
  if (call.member === "tabs.get") return { id: app.appId } satisfies TabInfo
  return unwrap(
    await bridge.executeMcpApp({
      appId: app.appId,
      args: call.args,
      member: call.member,
      origin: app.origin,
      ...(call.selector ? { selector: call.selector } : {}),
    })
  )
}

const dispatch = async (request: BrowserAutomationRequest): Promise<unknown> => {
  const bridge = globalThis.window?.cypheria?.browser
  if (!bridge) throw new HostError("unsupported", "This window cannot host browser tabs.")
  const parsed = BrowserHostRequestSchema.safeParse(request.request)
  if (!parsed.success) {
    throw new HostError(
      "invalid",
      `Invalid browser request: ${parsed.error.issues[0]?.message ?? "malformed"}`
    )
  }
  const call = parsed.data
  if (call.op !== "browser.call" || call.backend !== request.backend) {
    throw new HostError("invalid", "The window only answers calls to its own browsers.")
  }
  if (!isBrowserMember(call.member) || !supports(request.backend, call.member)) {
    throw new HostError("unsupported", `${call.member} is not available in this browser.`)
  }
  return request.backend === "iab"
    ? builtInBrowser(request, call, bridge)
    : mcpApps(request, call, bridge)
}

/** Answers one browser request the Server routed to this window. */
export const executeBrowserHostCommand = async (
  request: BrowserAutomationRequest
): Promise<BrowserAutomationOutcomeInput> => {
  try {
    return { automationId: request.automationId, ok: true, value: await dispatch(request) }
  } catch (error) {
    const coded = error as { code?: unknown; retryable?: unknown }
    return {
      automationId: request.automationId,
      error: {
        code: typeof coded?.code === "string" ? coded.code : "browser_error",
        message: error instanceof Error && error.message ? error.message : String(error),
        retryable: coded?.retryable === true,
      },
      ok: false,
    }
  }
}

/**
 * Registers this window as a browser host for its built-in browser tabs and the MCP Apps it
 * shows. Every window registers on its own connection and gets its own host, even though windows
 * share a client ID. Returns a disposer; outside Desktop this is a no-op.
 */
export const mountBrowserAutomationHost = (client: CypheriaClient): (() => void) => {
  if (!isBrowserAvailable()) return () => undefined
  const host = client.browserHost.register({
    onCommand: executeBrowserHostCommand,
    onRegistrationError: (error) => console.warn("[browser] host registration failed", error),
    registration: async () => {
      const status = await globalThis.window?.cypheria?.computerUse.status().catch(() => undefined)
      return {
        backends: ["iab", "mcpapps"],
        ...(status ? { name: status.deviceName } : {}),
      }
    },
  })
  return () => void host.release()
}
