import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { BrowserToolsBroker } from "./broker.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const window = (broker: BrowserToolsBroker, id: string, clientId = "desktop") => {
  const sent: BrowserAutomationRequest[] = []
  const release = broker.registerClient({
    backends: ["iab"],
    clientId,
    id,
    name: "Studio",
    send: (request) => sent.push(request),
  })
  return { release, sent }
}

describe("browser tools broker", () => {
  it("sends a request to one window and resolves with its answer", async () => {
    const broker = new BrowserToolsBroker({ createAutomationId: () => "a-1" })
    const { sent } = window(broker, "w1")
    const pending = broker.send({
      backend: "iab",
      hostId: "w1",
      repeatable: true,
      request: { member: "tabs.list", op: "browser.call" },
      threadId,
    })
    expect(sent).toEqual([
      {
        automationId: "a-1",
        backend: "iab",
        request: { member: "tabs.list", op: "browser.call" },
        threadId,
      },
    ])
    expect(broker.receiveOutcome("w2", { automationId: "a-1", ok: true, value: [] })).toBe(false)
    expect(broker.receiveOutcome("w1", { automationId: "a-1", ok: true, value: ["tab"] })).toBe(
      true
    )
    expect(await pending).toEqual({ automationId: "a-1", ok: true, value: ["tab"] })
    expect(broker.pendingCount).toBe(0)
  })

  it("fails requests whose window leaves, saying whether they may have run", async () => {
    const broker = new BrowserToolsBroker({ createAutomationId: () => "a-2" })
    const { release } = window(broker, "w1")
    const pending = broker.send({
      backend: "iab",
      hostId: "w1",
      repeatable: false,
      request: { member: "ax.click", op: "browser.call" },
      threadId,
    })
    release()
    const outcome = await pending
    expect(outcome).toMatchObject({
      error: { code: "browser_no_host", retryable: false },
      ok: false,
    })
    expect(outcome.ok ? "" : outcome.error.message).toMatch(/may have run/u)
  })

  it("times out and remembers which window holds a tab until it leaves", async () => {
    const broker = new BrowserToolsBroker({ defaultTimeoutMs: 10 })
    const { release } = window(broker, "w1")
    broker.rememberTab("iab", "tab-1", "w1")
    expect(broker.hostOfTab("iab", "tab-1")?.id).toBe("w1")
    expect(broker.hostOfTab("mcpapps", "tab-1")).toBeUndefined()
    const outcome = await broker.send({
      backend: "iab",
      hostId: "w1",
      repeatable: true,
      request: {},
      threadId,
    })
    expect(outcome).toMatchObject({
      error: { code: "browser_timeout", retryable: true },
      ok: false,
    })
    release()
    expect(broker.hostOfTab("iab", "tab-1")).toBeUndefined()
    expect(
      await broker.send({ backend: "iab", hostId: "w1", repeatable: true, request: {}, threadId })
    ).toMatchObject({ error: { code: "browser_no_host" }, ok: false })
  })
})
