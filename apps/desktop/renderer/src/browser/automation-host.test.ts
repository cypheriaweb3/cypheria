import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BrowserTabCall, McpAppCall } from "../../../ipc/src/index.js"
import { executeBrowserHostCommand } from "./automation-host.js"
import { registerMountedMcpApp } from "./mcp-app-registry.js"
import { browserTabsStore } from "./store.js"
import { onBrowserPaneRequest, reportBrowserPaneShown } from "./visibility.js"

const threadA = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const threadB = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

const executeMcpApp = vi.fn(async (_call: McpAppCall) => ({ ok: true as const, value: 2 }))
/** Tabs live in some window; a tab live elsewhere is not reported here. */
const listLive = vi.fn(async () => ({ browserIds: [] as string[] }))
const executeAutomation = vi.fn(async (_call: BrowserTabCall) => ({
  ok: true as const,
  value: "page",
}))
const unregister = vi.fn(async () => ({ unregistered: true as const }))

let sequence = 0
const iab = (
  threadId: string,
  call: { member: string; args?: unknown[]; tab?: string; selector?: string }
): BrowserAutomationRequest => ({
  automationId: `a-${++sequence}`,
  backend: "iab",
  request: { args: [], browser: "iab", op: "browser.call", backend: "iab", ...call },
  threadId,
})
const mcpapps = (
  threadId: string,
  call: { member: string; args?: unknown[]; tab?: string; selector?: string }
): BrowserAutomationRequest => ({
  automationId: `m-${++sequence}`,
  backend: "mcpapps",
  request: { args: [], browser: "mcpapps", op: "browser.call", backend: "mcpapps", ...call },
  threadId,
})

describe("browser host requests", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      cypheria: { browser: { executeAutomation, executeMcpApp, listLive, unregister } },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    executeAutomation.mockClear()
    executeMcpApp.mockClear()
  })

  it("rejects requests for another backend or outside the support matrix", async () => {
    await expect(
      executeBrowserHostCommand({
        ...iab(threadA, { member: "tabs.list" }),
        backend: "mcpapps",
      })
    ).resolves.toMatchObject({ error: { code: "invalid" }, ok: false })
    await expect(
      executeBrowserHostCommand(mcpapps(threadA, { member: "tab.goto", tab: "app" }))
    ).resolves.toMatchObject({ error: { code: "unsupported" }, ok: false })
  })

  it("lists, reads, and closes only the calling Thread's tabs", async () => {
    const own = browserTabsStore.create({ kind: "dapp", threadId: threadA, url: "https://a.test" })
    const other = browserTabsStore.create({ kind: "web", threadId: threadB, url: "https://b.test" })

    await expect(
      executeBrowserHostCommand(iab(threadA, { member: "tabs.list" }))
    ).resolves.toMatchObject({
      ok: true,
      value: [{ id: own.browserId, url: "https://a.test/" }],
    })
    await expect(
      executeBrowserHostCommand(iab(threadA, { member: "tab.info", tab: own.browserId }))
    ).resolves.toMatchObject({ value: { url: "https://a.test/" } })
    await expect(
      executeBrowserHostCommand(iab(threadA, { member: "tab.close", tab: other.browserId }))
    ).resolves.toMatchObject({ error: { code: "not_found" }, ok: false })
    expect(browserTabsStore.get(other.browserId)).toBeDefined()
    await expect(
      executeBrowserHostCommand(iab(threadA, { member: "tab.close", tab: own.browserId }))
    ).resolves.toMatchObject({ ok: true, value: null })
    expect(browserTabsStore.get(own.browserId)).toBeUndefined()
    browserTabsStore.remove(other.browserId)
  })

  it("leaves a tab live in another window to that window", async () => {
    const elsewhere = browserTabsStore.create({
      kind: "web",
      threadId: threadA,
      url: "https://elsewhere.test",
    })
    listLive.mockResolvedValueOnce({ browserIds: [elsewhere.browserId] })
    const listed = await executeBrowserHostCommand(iab(threadA, { member: "tabs.list" }))
    expect(listed.ok && (listed.value as { id: string }[]).map((tab) => tab.id)).toEqual([])
    browserTabsStore.remove(elsewhere.browserId)
  })

  it("advertises visibility and asks the workspace to show the browser", async () => {
    const requests: unknown[] = []
    const stop = onBrowserPaneRequest((request) => requests.push(request))
    try {
      await expect(
        executeBrowserHostCommand(iab(threadA, { member: "browser.capabilities" }))
      ).resolves.toMatchObject({ value: [{ id: "visibility" }, { id: "viewport" }] })
      reportBrowserPaneShown(threadA, true)
      await expect(
        executeBrowserHostCommand(
          iab(threadA, { args: ["visibility", "get", []], member: "browser.capability" })
        )
      ).resolves.toMatchObject({ value: true })
      await executeBrowserHostCommand(
        iab(threadA, { args: ["visibility", "set", [false]], member: "browser.capability" })
      )
      expect(requests).toEqual([{ threadId: threadA, visible: false }])
    } finally {
      stop()
      reportBrowserPaneShown(threadA, false)
    }
  })

  it("applies and resets the Thread's viewport override", async () => {
    const tab = browserTabsStore.create({ kind: "web", threadId: threadA, url: "https://a.test" })
    const other = browserTabsStore.create({ kind: "web", threadId: threadB, url: "https://b.test" })
    const viewport = (method: string, values: unknown[]) =>
      executeBrowserHostCommand(
        iab(threadA, { args: ["viewport", method, values], member: "browser.capability" })
      )
    try {
      await expect(viewport("set", [{ height: 0, width: 390 }])).resolves.toMatchObject({
        error: { code: "invalid" },
      })
      await expect(viewport("set", [{ height: 844, width: 390 }])).resolves.toMatchObject({
        ok: true,
      })
      expect(browserTabsStore.get(tab.browserId)?.viewport).toEqual({
        height: 844,
        mode: "fixed",
        width: 390,
      })
      expect(browserTabsStore.get(other.browserId)?.viewport).toEqual({ mode: "responsive" })
      await viewport("reset", [])
      expect(browserTabsStore.get(tab.browserId)?.viewport).toEqual({ mode: "responsive" })
    } finally {
      browserTabsStore.remove(tab.browserId)
      browserTabsStore.remove(other.browserId)
    }
  })

  it("operates MCP Apps of the calling Thread and Apps outside any Thread", async () => {
    const disposers = [
      registerMountedMcpApp({
        appId: "app-1",
        origin: "cypheria-sandbox://a1/",
        threadId: threadA,
      }),
      registerMountedMcpApp({ appId: "page", origin: "cypheria-sandbox://p1/", threadId: null }),
    ]
    try {
      await expect(
        executeBrowserHostCommand(
          mcpapps(threadA, { member: "locator.count", selector: "button", tab: "app-1" })
        )
      ).resolves.toMatchObject({ ok: true, value: 2 })
      expect(executeMcpApp).toHaveBeenCalledWith({
        appId: "app-1",
        args: [],
        member: "locator.count",
        origin: "cypheria-sandbox://a1/",
        selector: "button",
      })
      await expect(
        executeBrowserHostCommand(mcpapps(threadB, { member: "tab.info", tab: "app-1" }))
      ).resolves.toMatchObject({ error: { code: "not_found" }, ok: false })
      await expect(
        executeBrowserHostCommand(mcpapps(threadB, { member: "tab.info", tab: "page" }))
      ).resolves.toMatchObject({ ok: true })
      await expect(
        executeBrowserHostCommand(mcpapps(threadB, { member: "tabs.list" }))
      ).resolves.toMatchObject({
        value: [
          { id: "app-1", threadId: threadA },
          { id: "page", threadId: null },
        ],
      })
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})
