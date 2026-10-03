import type { BrowserServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { BrowserToolsService } from "./service.js"
import { browserToolName, browserToolSpecs } from "./tools.js"

const browserId = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"
const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const setup = (enabled = true) => {
  const append = vi.fn(async (_entry: unknown) => ({}) as never)
  const service = new BrowserToolsService({ audit: { append }, enabled: () => enabled })
  const notifications: BrowserServerMessage[] = []
  const session = {
    id: "ses_desktop",
    kind: "desktop" as const,
    notify: (message: BrowserServerMessage) => {
      notifications.push(message)
      if (message.type !== "browser.automation.command.notification") return
      const request = message.payload
      queueMicrotask(() => {
        void service.handle(
          {
            payload: {
              automationId: request.automationId,
              ok: true,
              result:
                request.command.command === "screenshot"
                  ? {
                      browserId,
                      command: "screenshot",
                      dataBase64: "iVBORw0KGgo=",
                      height: 1,
                      mimeType: "image/png",
                      width: 1,
                    }
                  : { browserId, command: "back" },
            },
            requestId: "result-1",
            type: "browser.automation.result.request",
          },
          session,
          () => undefined
        )
      })
    },
  }
  return { append, notifications, service, session }
}

const register = async (context: ReturnType<typeof setup>) => {
  const replies: BrowserServerMessage[] = []
  await context.service.handle(
    {
      payload: { hostKind: "desktop app", supportedCommands: ["back", "screenshot", "close_tab"] },
      requestId: "host-1",
      type: "browser.host.register.request",
    },
    context.session,
    (message) => replies.push(message)
  )
  return replies
}

describe("BrowserToolsService", () => {
  it("only lets Desktop sessions host browsers", async () => {
    const context = setup()
    const replies: BrowserServerMessage[] = []
    await context.service.handle(
      {
        payload: { hostKind: "cli", supportedCommands: ["back"] },
        requestId: "host-1",
        type: "browser.host.register.request",
      },
      { ...context.session, kind: "cli" },
      (message) => replies.push(message)
    )
    expect(replies[0]).toMatchObject({ payload: { ok: false } })
    expect(context.service.broker.hostCount).toBe(0)
  })

  it("refuses commands while browser tools are disabled", async () => {
    const context = setup(false)
    await register(context)
    await expect(
      context.service.execute({ command: { args: { browserId }, command: "back" }, threadId })
    ).resolves.toMatchObject({ error: { code: "browser_disabled" }, ok: false })
    expect(context.notifications).toEqual([])
  })

  it("audits mutating commands without their payload", async () => {
    const context = setup()
    await register(context)
    await expect(
      context.service.execute({
        automationId: "a-1",
        command: { args: { browserId }, command: "back" },
        threadId,
      })
    ).resolves.toMatchObject({ ok: true })
    expect(context.append.mock.calls.map(([entry]) => entry)).toEqual([
      {
        actor: `thread:${threadId}`,
        correlationId: "a-1",
        eventType: "browser.back.started",
        source: "browser",
      },
      {
        actor: `thread:${threadId}`,
        correlationId: "a-1",
        eventType: "browser.back.succeeded",
        source: "browser",
      },
    ])
  })

  it("does not start a mutating command when audit is unavailable", async () => {
    const context = setup()
    context.append.mockRejectedValueOnce(new Error("disk full"))
    await register(context)
    await expect(
      context.service.execute({ command: { args: { browserId }, command: "back" }, threadId })
    ).resolves.toMatchObject({ error: { code: "browser_denied" } })
    expect(context.notifications).toEqual([])
  })

  it("serves Codex tool calls scoped to the calling thread", async () => {
    const context = setup()
    await register(context)
    const response = await context.service.callCodexTool(
      {
        arguments: { browserId },
        callId: "call-1",
        namespace: null,
        threadId: "codex-session",
        tool: browserToolName("screenshot"),
        turnId: "turn-1",
      },
      { cwd: "/workspace", threadId }
    )
    expect(response.success).toBe(true)
    expect(response.contentItems[1]).toEqual({
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      type: "inputImage",
    })
    expect(context.notifications[0]).toMatchObject({
      payload: { cwd: "/workspace", threadId },
      type: "browser.automation.command.notification",
    })
    await expect(
      context.service.callCodexTool(
        {
          arguments: {},
          callId: "call-2",
          namespace: null,
          threadId: "codex-session",
          tool: browserToolName("list_tabs"),
          turnId: "turn-1",
        },
        {}
      )
    ).resolves.toMatchObject({ success: false })
  })

  it("drops a host when its session closes", async () => {
    const context = setup()
    await register(context)
    expect(context.service.broker.hostCount).toBe(1)
    context.service.sessionClosed(context.session.id)
    expect(context.service.broker.hostCount).toBe(0)
  })

  it("exposes MCP tools matching command definitions", () => {
    const context = setup()
    const tools = context.service.mcpTools()
    expect(tools).toHaveLength(27)
    expect(tools.some((t) => t.name === "browser_navigate")).toBe(true)
    expect(tools.some((t) => t.name === "browser_scan_qr")).toBe(true)
    expect(tools.some((t) => t.name === "browser_mark_deliverable")).toBe(true)
    expect(tools.some((t) => t.name === "browser_extract_assets")).toBe(true)
  })

  it("handles callMcpTool for MCP clients", async () => {
    const context = setup()
    await register(context)
    const result = await context.service.callMcpTool(
      "browser_screenshot",
      { browserId },
      { threadId }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content?.[0]?.type).toBe("text")
    expect(result.content?.[1]?.type).toBe("image")
  })

  it("tracks tab disposition and cleans up temporary tabs on turn end", async () => {
    const context = setup()
    await register(context)

    const tabTemp = "11111111-1111-4111-8111-111111111111"
    const tabDeliverable = "22222222-2222-4222-8222-222222222222"
    const tabHandoff = "33333333-3333-4333-8333-333333333333"

    context.service.trackTab(threadId, tabTemp)
    context.service.trackTab(threadId, tabDeliverable)
    context.service.trackTab(threadId, tabHandoff)

    context.service.setTabDisposition(threadId, tabDeliverable, "deliverable")
    context.service.setTabDisposition(threadId, tabHandoff, "handoff")

    expect(context.service.getTabDisposition(threadId, tabTemp)).toBe("temporary")
    expect(context.service.getTabDisposition(threadId, tabDeliverable)).toBe("deliverable")
    expect(context.service.getTabDisposition(threadId, tabHandoff)).toBe("handoff")

    await context.service.cleanupTurnTabs(threadId)

    // Temporary tab should have received a close_tab command notification
    const closeNotification = context.notifications.find(
      (n) =>
        n.type === "browser.automation.command.notification" &&
        n.payload.command.command === "close_tab" &&
        n.payload.command.args.browserId === tabTemp
    )
    expect(closeNotification).toBeDefined()

    // Deliverable and handoff tabs should NOT be closed
    const deliverableClose = context.notifications.find(
      (n) =>
        n.type === "browser.automation.command.notification" &&
        n.payload.command.command === "close_tab" &&
        n.payload.command.args.browserId === tabDeliverable
    )
    expect(deliverableClose).toBeUndefined()
  })
})

describe("browser tool specs", () => {
  it("exposes one JSON-schema tool per command", () => {
    const specs = browserToolSpecs()
    expect(specs).toHaveLength(27)
    const click = specs.find((spec) => spec.type === "function" && spec.name === "browser_click")
    expect(click).toMatchObject({
      inputSchema: { properties: { browserId: { type: "string" }, ref: { type: "string" } } },
      type: "function",
    })
  })
})
