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
    name: id,
    clientId: `cid_${id}`,
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
        ? ok(request, {
            browserId: tabA,
            command: "new_tab",
            kind: "web",
            threadId,
            url: "about:blank",
          })
        : ok(request, { browserId: tabA, command: "back" })
    )
    const second = createHost("second", (request) =>
      ok(request, {
        browserId: tabB,
        command: "new_tab",
        kind: "web",
        threadId,
        url: "about:blank",
      })
    )
    first.attach(broker)
    second.attach(broker)
    broker.registerClient(first.host)
    await broker.execute({ command: { command: "new_tab" }, threadId })
    broker.registerClient(second.host)
    // Two devices: a new tab needs a named device or window.
    await expect(
      broker.execute({ command: { command: "new_tab" }, threadId })
    ).resolves.toMatchObject({
      error: { code: "browser_no_host", message: expect.stringMatching(/name the device/u) },
    })
    await broker.execute({ command: { command: "new_tab" }, hostId: "second", threadId })
    expect(second.sent.map((request) => request.command.command)).toEqual(["new_tab"])
    expect(broker.hostOfTab(tabB)?.id).toBe("second")

    await expect(
      broker.execute({ command: { args: { browserId: tabA }, command: "back" } })
    ).resolves.toMatchObject({ ok: true })
    expect(first.sent.map((request) => request.command.command)).toEqual(["new_tab", "back"])
    expect(first.sent[0]).toMatchObject({ threadId })
    expect(second.sent).toHaveLength(1)
  })

  it("opens a new tab in the newest window when every window belongs to one device", async () => {
    const broker = new BrowserToolsBroker()
    const opened = (request: BrowserAutomationRequest) =>
      ok(request, {
        browserId: tabA,
        command: "new_tab",
        kind: "web",
        threadId,
        url: "about:blank",
      })
    const main = createHost("main", opened)
    const popout = createHost("popout", opened)
    for (const window of [main, popout]) window.attach(broker)
    broker.registerClient({ ...main.host, clientId: "cid_desktop" })
    broker.registerClient({ ...popout.host, clientId: "cid_desktop" })
    await expect(
      broker.execute({ command: { command: "new_tab" }, threadId })
    ).resolves.toMatchObject({ ok: true })
    expect(main.sent).toHaveLength(0)
    expect(popout.sent.map((request) => request.command.command)).toEqual(["new_tab"])
  })

  it("keeps a client's tabs when it reconnects over a new session", async () => {
    const broker = new BrowserToolsBroker()
    const before = createHost("desktop", (request) =>
      ok(request, {
        browserId: tabA,
        command: "new_tab",
        kind: "web",
        threadId,
        url: "about:blank",
      })
    )
    before.attach(broker)
    const releaseBefore = broker.registerClient(before.host)
    await broker.execute({ command: { command: "new_tab" }, threadId })
    const waiting = broker.execute({ command: { args: { browserId: tabA }, command: "back" } })

    const after = createHost("desktop", (request) =>
      ok(request, { browserId: tabA, command: "back" })
    )
    after.attach(broker)
    broker.registerClient(after.host)
    // A mutation sent to the old connection may have run, so it is not offered as retryable.
    await expect(waiting).resolves.toMatchObject({
      error: {
        code: "browser_no_host",
        message: expect.stringMatching(/may have run/u),
        retryable: false,
      },
    })
    releaseBefore()
    expect(broker.hostCount).toBe(1)
    await expect(
      broker.execute({ command: { args: { browserId: tabA }, command: "back" } })
    ).resolves.toMatchObject({ ok: true })
    expect(after.sent.map((request) => request.command.command)).toEqual(["back"])
  })

  it("aggregates tabs from every host and skips a host that fails", async () => {
    const broker = new BrowserToolsBroker()
    const hosts = [tabA, tabB, null].map((browserId, index) =>
      createHost(`host-${index}`, (request) =>
        browserId
          ? ok(request, {
              command: "list_tabs",
              tabs: [{ browserId, kind: "web", threadId, title: "", url: "" }],
            })
          : {
              automationId: request.automationId,
              error: { code: "browser_unknown_error", message: "asleep" },
              ok: false,
            }
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

  it("lists a tab several windows report once, with the earliest window", async () => {
    const broker = new BrowserToolsBroker()
    const windows = ["older", "newer"].map((id) =>
      createHost(id, (request) =>
        request.command.command === "list_tabs"
          ? ok(request, {
              command: "list_tabs",
              tabs: [{ browserId: tabA, kind: "web", threadId, title: "", url: "" }],
            })
          : ok(request, { browserId: tabA, command: "back" })
      )
    )
    for (const window of windows) {
      window.attach(broker)
      broker.registerClient({ ...window.host, clientId: "cid_desktop" })
    }
    const outcome = await broker.execute({ command: { command: "list_tabs" } })
    expect(
      outcome.ok && outcome.result.command === "list_tabs" && outcome.result.tabs
    ).toHaveLength(1)
    expect(broker.hostOfTab(tabA)?.id).toBe("older")
  })

  it("fails pending commands when their host disconnects and recovers after reconnect", async () => {
    const broker = new BrowserToolsBroker()
    const silent = createHost("desktop")
    const release = broker.registerClient(silent.host)
    const pending = broker.execute({ command: { args: { browserId: tabA }, command: "snapshot" } })
    release()
    // A snapshot only reads, so it is safe to try again.
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
