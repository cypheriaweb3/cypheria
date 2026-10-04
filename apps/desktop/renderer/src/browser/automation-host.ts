// Browser host adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/app/src/desktop/browser/automation/handler.ts.
import type { CypheriaClient } from "@cypheria/client"
import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  type BrowserAutomationErrorCode,
  type BrowserAutomationOutcomeInput,
  type BrowserAutomationRequest,
} from "@cypheria/protocol"
import { mountedMcpApp, mountedMcpApps } from "./mcp-app-registry.js"
import {
  ensureResidentBrowserWebview,
  isBrowserAvailable,
  removeResidentBrowserWebview,
  resizeResidentBrowserWebview,
  waitForBrowserRegistration,
} from "./resident-webviews.js"
import { browserTabsStore } from "./store.js"

type Request = BrowserAutomationRequest

const failure = (
  request: Request,
  code: BrowserAutomationErrorCode,
  message: string,
  retryable = false
): BrowserAutomationOutcomeInput => ({
  automationId: request.automationId,
  error: { code, message, retryable },
  ok: false,
})

const tabNotFound = (request: Request, browserId: string) =>
  failure(request, "browser_tab_not_found", `No browser tab found for ID: ${browserId}`)

/** Finds a tab the request may address: callers only see tabs attached to their Thread. */
const scopedTab = (threadId: string, browserId: string) => {
  const tab = browserTabsStore.get(browserId)
  return tab?.threadId === threadId ? tab : undefined
}

const newTab = async (
  request: Request,
  threadId: string,
  args: { kind: "web" | "dapp"; url?: string | undefined }
): Promise<BrowserAutomationOutcomeInput> => {
  const record = browserTabsStore.create({
    activate: false,
    kind: args.kind,
    threadId,
    url: args.url ?? null,
  })
  ensureResidentBrowserWebview(record)
  if (!(await waitForBrowserRegistration(record.browserId))) {
    return failure(
      request,
      "browser_timeout",
      `Timed out waiting for browser tab ${record.browserId} to start. Try browser_new_tab again.`,
      true
    )
  }
  return {
    automationId: request.automationId,
    ok: true,
    result: {
      browserId: record.browserId,
      command: "new_tab",
      kind: record.kind,
      threadId,
      url: record.url,
    },
  }
}

const closeTab = (
  request: Request,
  threadId: string,
  browserId: string
): BrowserAutomationOutcomeInput => {
  if (!scopedTab(threadId, browserId)) return tabNotFound(request, browserId)
  browserTabsStore.remove(browserId)
  removeResidentBrowserWebview(browserId)
  return {
    automationId: request.automationId,
    ok: true,
    result: { browserId, command: "close_tab" },
  }
}

const resize = (
  request: Request,
  threadId: string,
  args: { browserId: string; height: number; width: number }
): BrowserAutomationOutcomeInput => {
  const tab = scopedTab(threadId, args.browserId)
  if (!tab) return tabNotFound(request, args.browserId)
  ensureResidentBrowserWebview(tab)
  const size = resizeResidentBrowserWebview(args.browserId, args.width, args.height)
  if (!size) return tabNotFound(request, args.browserId)
  browserTabsStore.patch(args.browserId, { viewport: { mode: "fixed", ...size } })
  return {
    automationId: request.automationId,
    ok: true,
    result: { browserId: args.browserId, command: "resize", ...size },
  }
}

/** Starts a restored tab that has not been opened since launch before it is automated. */
const materialize = async (request: Request, threadId: string, browserId: string) => {
  const tab = scopedTab(threadId, browserId)
  if (!tab) return tabNotFound(request, browserId)
  ensureResidentBrowserWebview(tab)
  return (await waitForBrowserRegistration(browserId))
    ? null
    : failure(request, "browser_timeout", `Browser tab ${browserId} did not start.`, true)
}

/**
 * Live tabs come from the main process. Restored tabs that no window has started yet are added
 * here; a tab live in another window is that window's to report.
 */
const listTabs = async (
  request: Request,
  threadId: string,
  bridge: NonNullable<NonNullable<Window["cypheria"]>["browser"]>
): Promise<BrowserAutomationOutcomeInput> => {
  await browserTabsStore.load()
  const [live, anywhere] = await Promise.all([
    bridge.executeAutomation(request),
    bridge.listLive().catch(() => ({ browserIds: [] })),
  ])
  if (!live.ok || live.result.command !== "list_tabs") return live
  const liveIds = new Set([...live.result.tabs.map((tab) => tab.browserId), ...anywhere.browserIds])
  const state = browserTabsStore.getSnapshot()
  const restored = state.tabs
    .filter((tab) => !liveIds.has(tab.browserId))
    .filter((tab) => tab.threadId === threadId)
    .map((tab) => ({
      browserId: tab.browserId,
      isActive: state.activeByThread[tab.threadId] === tab.browserId,
      isLoading: false,
      kind: tab.kind,
      threadId: tab.threadId,
      title: tab.title,
      url: tab.url,
    }))
  return { ...live, result: { ...live.result, tabs: [...live.result.tabs, ...restored] } }
}

/** Runs one DOM action in an MCP App this window shows, for the Thread or outside any Thread. */
const runMcpApp = async (
  request: Request,
  threadId: string,
  args: Extract<Request["command"], { command: "mcp_app" }>["args"],
  bridge: NonNullable<NonNullable<Window["cypheria"]>["browser"]>
): Promise<BrowserAutomationOutcomeInput> => {
  const app = mountedMcpApp(threadId, args.appId)
  if (!app) {
    return failure(
      request,
      "browser_tab_not_found",
      `MCP App ${args.appId} is not open in this window.`
    )
  }
  try {
    const result = await bridge.executeMcpApp({
      action: args.action,
      appId: args.appId,
      origin: app.origin,
    })
    return {
      automationId: request.automationId,
      ok: true,
      result: { action: args.action.type, appId: args.appId, command: "mcp_app", ...result },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failure(
      request,
      /latest snapshot/u.test(message) ? "browser_stale_ref" : "browser_unknown_error",
      message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, "")
    )
  }
}

export const executeBrowserHostCommand = async (
  request: Request
): Promise<BrowserAutomationOutcomeInput> => {
  const bridge = globalThis.window?.cypheria?.browser
  if (!bridge) {
    return failure(request, "browser_unsupported", "This window cannot host browser tabs.")
  }
  // Browser tabs always belong to a Thread; a request without one has no tabs to address.
  const { command, threadId } = request
  if (!threadId) {
    return failure(request, "browser_denied", "Browser tabs belong to a Cypheria thread.")
  }
  switch (command.command) {
    case "new_tab":
      return newTab(request, threadId, command.args)
    case "close_tab":
      return closeTab(request, threadId, command.args.browserId)
    case "resize":
      return resize(request, threadId, command.args)
    case "list_tabs":
      return listTabs(request, threadId, bridge)
    case "list_mcp_apps":
      return {
        automationId: request.automationId,
        ok: true,
        result: { apps: mountedMcpApps(), command: "list_mcp_apps" },
      }
    case "mcp_app":
      return runMcpApp(request, threadId, command.args, bridge)
    default: {
      const pending = await materialize(request, threadId, command.args.browserId)
      if (pending) return pending
    }
  }
  return bridge.executeAutomation(request)
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
        hostKind: "Cypheria Desktop",
        ...(status ? { name: status.deviceName } : {}),
        supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
      }
    },
  })
  return () => void host.release()
}
