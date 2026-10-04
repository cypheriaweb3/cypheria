import type { BrowserServerMessage } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { BrowserToolsService } from "./service.js"

const browserId = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"
const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const setup = (enabled = true) => {
  const append = vi.fn(async (_entry: unknown) => ({}) as never)
  const service = new BrowserToolsService({ audit: { append }, enabled: () => enabled })
  const notifications: BrowserServerMessage[] = []
  const session = {
    clientId: "cid_desktop",
    id: "ses_desktop",
    kind: "desktop" as const,
    transport: {},
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
      payload: {
        hostKind: "desktop app",
        name: "Studio Mac",
        supportedCommands: ["back", "screenshot", "close_tab"],
      },
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

  it("sends commands scoped to the calling thread", async () => {
    const context = setup()
    await register(context)
    const outcome = await context.service.execute({
      command: { args: { browserId }, command: "screenshot" },
      cwd: "/workspace",
      threadId,
    })
    expect(outcome).toMatchObject({ ok: true, result: { command: "screenshot" } })
    expect(context.notifications[0]).toMatchObject({
      payload: { cwd: "/workspace", threadId },
      type: "browser.automation.command.notification",
    })
  })

  it("drops a host when its session closes", async () => {
    const context = setup()
    await register(context)
    expect(context.service.broker.hosts()).toEqual([
      expect.objectContaining({ clientId: "cid_desktop", name: "Studio Mac" }),
    ])
    context.service.sessionClosed(context.session.id)
    expect(context.service.broker.hostCount).toBe(0)
  })

  it("registers each window of a client as its own host", async () => {
    const context = setup()
    await register(context)
    const popout = { ...context.session, transport: {} }
    await context.service.handle(
      {
        payload: { hostKind: "desktop app", name: "Studio Mac", supportedCommands: ["back"] },
        requestId: "host-2",
        type: "browser.host.register.request",
      },
      popout,
      () => undefined
    )
    const hosts = context.service.broker.hosts()
    expect(hosts.map((host) => host.clientId)).toEqual(["cid_desktop", "cid_desktop"])
    expect(new Set(hosts.map((host) => host.id)).size).toBe(2)
    context.service.transportClosed(popout.transport)
    expect(context.service.broker.hostCount).toBe(1)
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
