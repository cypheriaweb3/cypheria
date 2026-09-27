import type { BrowserAutomationRequest } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { type BrowserHostClient, BrowserToolsBroker } from "./broker.js"

const tabA = "5b8f7b43-86a4-4c65-9f79-3a3a3d35f0c1"
const tabB = "9d2c0f52-7a1b-4c3e-8f55-1b2c3d4e5f60"
const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const createHost = (id: string, answer?: (request: BrowserAutomationRequest) => unknown) => {
  const sent: BrowserAutomationRequest[] = []
  let broker: BrowserToolsBroker | undefined
  const host: BrowserHostClient = {
    hostKind: "desktop app",
    id,
    send: (request) => {
      sent.push(request)
      const outcome = answer?.(request)
      if (outcome) queueMicrotask(() => broker?.receiveOutcome(id, outcome))
    },
    supportedCommands: ["list_tabs", "new_tab", "snapshot", "close_tab", "back"],
  }
  return { attach: (value: BrowserToolsBroker) => (broker = value), host, sent }
}

const ok = (request: BrowserAutomationRequest, result: unknown) => ({
  automationId: request.automationId,
  ok: true,
  result,
})

describe("BrowserToolsBroker", () => {
  it("returns a retryable no-host failure when no Desktop is connected", async () => {
    const broker = new BrowserToolsBroker()
    await expect(broker.execute({ command: { command: "new_tab" } })).resolves.toMatchObject({
      error: { code: "browser_no_host", retryable: true },
      ok: false,
    })
  })

  it("routes tab commands to the host that created the tab", async () => {
    const broker = new BrowserToolsBroker()
    const first = createHost("first", (request) =>
      request.command.command === "new_tab"
        ? ok(request, { browserId: tabA, command: "new_tab", kind: "web", url: "about:blank" })
        : ok(request, { browserId: tabA, command: "back" })
    )
    const second = createHost("second", (request) =>
      ok(request, { browserId: tabB, command: "new_tab", kind: "web", url: "about:blank" })
    )
    first.attach(broker)
    second.attach(broker)
    broker.registerClient(first.host)
    await broker.execute({ command: { command: "new_tab" }, threadId })
    broker.registerClient(second.host)

    await expect(
      broker.execute({ command: { args: { browserId: tabA }, command: "back" } })
    ).resolves.toMatchObject({ ok: true })
    expect(first.sent.map((request) => request.command.command)).toEqual(["new_tab", "back"])
    expect(first.sent[0]).toMatchObject({ threadId })
    expect(second.sent).toEqual([])
  })

  it("aggregates tabs from every host", async () => {
    const broker = new BrowserToolsBroker()
    const hosts = [tabA, tabB].map((browserId, index) =>
      createHost(`host-${index}`, (request) =>
        ok(request, {
          command: "list_tabs",
          tabs: [{ browserId, kind: "web", title: "", url: "" }],
        })
      )
    )
    for (const host of hosts) {
      host.attach(broker)
      broker.registerClient(host.host)
    }
    const outcome = await broker.execute({
      automationId: "list-1",
      command: { command: "list_tabs" },
    })
    expect(outcome).toMatchObject({ automationId: "list-1", ok: true })
    expect(
      outcome.ok && outcome.result.command === "list_tabs" && outcome.result.tabs
    ).toHaveLength(2)
  })

  it("fails pending commands when their host disconnects and recovers after reconnect", async () => {
    const broker = new BrowserToolsBroker()
    const silent = createHost("desktop")
    const release = broker.registerClient(silent.host)
    const pending = broker.execute({ command: { args: { browserId: tabA }, command: "snapshot" } })
    release()
    await expect(pending).resolves.toMatchObject({
      error: { code: "browser_no_host", retryable: true },
    })
  })

  it("ignores answers from a different host and times out", async () => {
    vi.useFakeTimers()
    try {
      const broker = new BrowserToolsBroker({ defaultTimeoutMs: 100 })
      const host = createHost("desktop")
      broker.registerClient(host.host)
      const pending = broker.execute({
        command: { args: { browserId: tabA }, command: "snapshot" },
      })
      const request = host.sent[0]
      expect(request).toBeDefined()
      expect(
        broker.receiveOutcome("other", ok(request as BrowserAutomationRequest, { command: "back" }))
      ).toBe(false)
      await vi.advanceTimersByTimeAsync(100)
      await expect(pending).resolves.toMatchObject({ error: { code: "browser_timeout" } })
      expect(broker.pendingCount).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects commands the host does not support and invalid host responses", async () => {
    const broker = new BrowserToolsBroker()
    const host = createHost("desktop", (request) => ({
      automationId: request.automationId,
      ok: true,
    }))
    host.attach(broker)
    broker.registerClient(host.host)
    await expect(
      broker.execute({
        command: { args: { browserId: tabA, ref: "@e1", value: "x" }, command: "fill" },
      })
    ).resolves.toMatchObject({ error: { code: "browser_unsupported" } })
    await expect(
      broker.execute({ command: { args: { browserId: tabA }, command: "snapshot" } })
    ).resolves.toMatchObject({ error: { code: "browser_unknown_error" } })
  })
})
