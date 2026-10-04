import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { executeBrowserHostCommand } from "./automation-host.js"
import { registerMountedMcpApp } from "./mcp-app-registry.js"
import { browserTabsStore } from "./store.js"

const threadA = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const threadB = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

const executeMcpApp = vi.fn(async () => ({ snapshot: '- button "Save" [ref=e1]' }))

/** Tabs live in some window; a tab live elsewhere is not reported as restored here. */
const listLive = vi.fn(async () => ({ browserIds: [] as string[] }))

const executeAutomation = vi.fn(async (request: BrowserAutomationRequest) => ({
  automationId: request.automationId,
  ok: true as const,
  result: { command: "list_tabs" as const, tabs: [] },
}))

describe("browser host commands", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      cypheria: { browser: { executeAutomation, executeMcpApp, listLive } },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    executeAutomation.mockClear()
  })

  it("denies tab commands that are not scoped to a Thread", async () => {
    await expect(
      executeBrowserHostCommand({
        automationId: "a-1",
        command: { args: { kind: "dapp" }, command: "new_tab" },
      })
    ).resolves.toMatchObject({ error: { code: "browser_denied" }, ok: false })
    expect(executeAutomation).not.toHaveBeenCalled()
  })

  it("only lists and closes tabs of the calling Thread", async () => {
    const own = browserTabsStore.create({ kind: "dapp", threadId: threadA, url: "https://a.test" })
    const other = browserTabsStore.create({ kind: "web", threadId: threadB, url: "https://b.test" })

    const listed = await executeBrowserHostCommand({
      automationId: "a-2",
      command: { args: {}, command: "list_tabs" },
      threadId: threadA,
    })
    expect(listed).toMatchObject({ ok: true })
    const tabs = listed.ok && listed.result.command === "list_tabs" ? listed.result.tabs : []
    expect(tabs.map((tab) => [tab.browserId, tab.kind, tab.threadId])).toEqual([
      [own.browserId, "dapp", threadA],
    ])

    await expect(
      executeBrowserHostCommand({
        automationId: "a-3",
        command: { args: { browserId: other.browserId }, command: "close_tab" },
        threadId: threadA,
      })
    ).resolves.toMatchObject({ error: { code: "browser_tab_not_found" } })
    expect(browserTabsStore.get(other.browserId)).toBeDefined()
  })

  it("leaves a tab live in another window to that window", async () => {
    const elsewhere = browserTabsStore.create({
      kind: "web",
      threadId: threadA,
      url: "https://elsewhere.test",
    })
    listLive.mockResolvedValueOnce({ browserIds: [elsewhere.browserId] })
    const listed = await executeBrowserHostCommand({
      automationId: "a-4",
      command: { args: {}, command: "list_tabs" },
      threadId: threadA,
    })
    const tabs = listed.ok && listed.result.command === "list_tabs" ? listed.result.tabs : []
    expect(tabs.map((tab) => tab.browserId)).not.toContain(elsewhere.browserId)
    browserTabsStore.remove(elsewhere.browserId)
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
        executeBrowserHostCommand({
          automationId: "m-1",
          command: { args: { action: { type: "snapshot" }, appId: "app-1" }, command: "mcp_app" },
          threadId: threadA,
        })
      ).resolves.toMatchObject({
        ok: true,
        result: { action: "snapshot", appId: "app-1", snapshot: '- button "Save" [ref=e1]' },
      })
      expect(executeMcpApp).toHaveBeenCalledWith({
        action: { type: "snapshot" },
        appId: "app-1",
        origin: "cypheria-sandbox://a1/",
      })
      await expect(
        executeBrowserHostCommand({
          automationId: "m-2",
          command: { args: { action: { type: "snapshot" }, appId: "app-1" }, command: "mcp_app" },
          threadId: threadB,
        })
      ).resolves.toMatchObject({ error: { code: "browser_tab_not_found" }, ok: false })
      await expect(
        executeBrowserHostCommand({
          automationId: "m-3",
          command: { args: { action: { type: "snapshot" }, appId: "page" }, command: "mcp_app" },
          threadId: threadB,
        })
      ).resolves.toMatchObject({ ok: true })
      await expect(
        executeBrowserHostCommand({
          automationId: "m-4",
          command: { args: {}, command: "list_mcp_apps" },
          threadId: threadB,
        })
      ).resolves.toMatchObject({
        result: {
          apps: [
            { appId: "app-1", threadId: threadA },
            { appId: "page", threadId: null },
          ],
        },
      })
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})
