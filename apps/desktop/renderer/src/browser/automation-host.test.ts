import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { executeBrowserHostCommand } from "./automation-host.js"
import { browserTabsStore } from "./store.js"

const threadA = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const threadB = "01984de2-8f74-7c91-a3b2-5c5e937cf319"

const executeAutomation = vi.fn(async (request: BrowserAutomationRequest) => ({
  automationId: request.automationId,
  ok: true as const,
  result: { command: "list_tabs" as const, tabs: [] },
}))

describe("browser host commands", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      cypheria: { browser: { executeAutomation } },
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
})
