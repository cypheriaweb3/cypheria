// Browser host adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/app/src/desktop/browser/automation/handler.ts.
import type { CypheriaClient } from "@cypheria/client"
import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  type BrowserAutomationErrorCode,
  type BrowserAutomationOutcomeInput,
  type BrowserAutomationRequest,
} from "@cypheria/protocol"

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

/** Live tabs come from the main process; restored tabs that have not started are added here. */
const listTabs = async (
  request: Request,
  threadId: string,
  bridge: NonNullable<NonNullable<Window["cypheria"]>["browser"]>
): Promise<BrowserAutomationOutcomeInput> => {
  await browserTabsStore.load()
  const live = await bridge.executeAutomation(request)
  if (!live.ok || live.result.command !== "list_tabs") return live
  const liveIds = new Set(live.result.tabs.map((tab) => tab.browserId))
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
    default: {
      const pending = await materialize(request, threadId, command.args.browserId)
      if (pending) return pending
    }
  }
  return bridge.executeAutomation(request)
}

/**
 * Registers the main window as the Server's browser host. Returns a disposer; outside the main
 * Desktop window this is a no-op.
 */
export const mountBrowserAutomationHost = (client: CypheriaClient): (() => void) => {
  if (!isBrowserAvailable()) return () => undefined
  const release = client.browser.registerHost({
    hostKind: "Cypheria Desktop",
    onCommand: executeBrowserHostCommand,
    onRegistrationError: (error) => console.warn("[browser] host registration failed", error),
    supportedCommands: BROWSER_AUTOMATION_COMMAND_NAMES,
  })
  return () => {
    void release()
  }
}
