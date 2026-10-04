import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { executeBrowserHostCommand } from "./automation-host.js"
import { registerMountedMcpApp } from "./mcp-app-registry.js"
import { browserTabsStore } from "./store.js"

const threadA = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const threadB = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

const executeMcpApp = vi.fn(async () => ({ snapshot: '- button "Save" [ref=e1]' }))

const executeAutomation = vi.fn(async (request: BrowserAutomationRequest) => ({
  automationId: request.automationId,
  ok: true as const,
  result: { command: "list_tabs" as const, tabs: [] },
}))

describe("browser host commands", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      cypheria: { browser: { executeAutomation, executeMcpApp } },
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

  it("lists and operates only the MCP Apps mounted for the calling Thread", async () => {
    const dispose = registerMountedMcpApp({
      appId: "app-1",
      displayMode: "fullscreen",
      origin: "cypheria-sandbox://a1/",
      pluginId: "demo@market",
      server: "demo",
      threadId: threadA,
      title: "Demo",
    })
    try {
      await expect(
        executeBrowserHostCommand({
          automationId: "m-1",
          command: { args: {}, command: "list_mcp_apps" },
          threadId: threadB,
        })
      ).resolves.toMatchObject({ ok: true, result: { apps: [] } })
      await expect(
        executeBrowserHostCommand({
          automationId: "m-2",
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
          automationId: "m-3",
          command: { args: { action: { type: "snapshot" }, appId: "app-1" }, command: "mcp_app" },
          threadId: threadB,
        })
      ).resolves.toMatchObject({ error: { code: "browser_tab_not_found" }, ok: false })
    } finally {
      dispose()
    }
  })
})
