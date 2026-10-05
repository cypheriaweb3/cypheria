import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { BuiltInBrowserTabs, debuggerTransport, type TabWebContents } from "./built-in-tabs.js"

const threadA = "01984de2-8f74-7c91-a3b2-5c5e937cf318"
const threadB = "01984de2-8f74-7c91-a3b2-5c5e937cf319"
const browserId = "6f1c1f4e-3a52-4d55-9a53-2b5d0b6f2a10"

class FakeDebugger extends EventEmitter {
  attached = false
  readonly sendCommand = vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({}))
  isAttached() {
    return this.attached
  }
  attach() {
    this.attached = true
  }
}

const fakeContents = (id = 7) => {
  const contents = new EventEmitter() as EventEmitter & Record<string, unknown>
  Object.assign(contents, {
    debugger: new FakeDebugger(),
    id,
    isDestroyed: () => false,
    session: new EventEmitter(),
  })
  return contents as unknown as TabWebContents & {
    debugger: FakeDebugger
    session: EventEmitter
  } & EventEmitter
}

describe("built-in browser tabs", () => {
  let directory: string | undefined
  afterEach(() => {
    if (directory) rmSync(directory, { force: true, recursive: true })
    directory = undefined
  })

  const tabs = (contents: TabWebContents | null, thread = threadA) =>
    new BuiltInBrowserTabs({
      contents: (hostId) => (hostId === 1 ? contents : null),
      downloadsDir: () => directory ?? tmpdir(),
      threadOf: () => thread,
    })

  it("answers only page members of tabs the window shows for the Thread", async () => {
    const contents = fakeContents()
    const call = { args: [], browserId, threadId: threadA }
    await expect(tabs(contents).call(1, { ...call, member: "tab.close" })).resolves.toMatchObject({
      error: { code: "invalid" },
      ok: false,
    })
    await expect(tabs(contents).call(1, { ...call, member: "tabs.new" })).resolves.toMatchObject({
      error: { code: "invalid" },
    })
    await expect(
      tabs(contents, threadB).call(1, { ...call, member: "tab.goto", args: ["https://a.test"] })
    ).resolves.toMatchObject({ error: { code: "not_found" } })
    await expect(
      tabs(contents).call(2, { ...call, member: "tab.goto", args: ["https://a.test"] })
    ).resolves.toMatchObject({ error: { code: "not_found" } })
    await expect(
      tabs(contents).call(1, { ...call, member: "tab.goto", args: [42] })
    ).resolves.toMatchObject({ error: { code: "invalid" } })
    expect(contents.debugger.attached).toBe(false)
  })

  it("forwards only the page's own debugger events and closes on detach", async () => {
    const contents = fakeContents()
    const transport = debuggerTransport(contents)
    expect(contents.debugger.attached).toBe(true)
    const events: string[] = []
    const closed = vi.fn()
    transport.onEvent((event) => events.push(event.method))
    transport.onClose?.(closed)
    contents.debugger.emit("message", {}, "Page.loadEventFired", {})
    contents.debugger.emit("message", {}, "Runtime.consoleAPICalled", {}, "child-session")
    expect(events).toEqual(["Page.loadEventFired"])
    await transport.send("Page.enable")
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith("Page.enable", {})
    contents.debugger.emit("detach")
    expect(closed).toHaveBeenCalledOnce()
    await expect(transport.send("Page.enable")).rejects.toMatchObject({ code: "page_gone" })
  })

  it("saves a download the model waits for under a free name", async () => {
    directory = mkdtempSync(join(tmpdir(), "cypheria-downloads-"))
    writeFileSync(join(directory, "report.pdf"), "taken")
    const contents = fakeContents()
    contents.debugger.sendCommand.mockImplementation(async (method: string) =>
      method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "main" } } }
        : method === "Runtime.evaluate"
          ? { result: { type: "string", value: "complete" } }
          : {}
    )
    const waited = await tabs(contents).call(1, {
      args: ["download", { timeoutMs: 1_000 }],
      browserId,
      member: "playwright.waitForEvent",
      threadId: threadA,
    })
    expect(waited).toMatchObject({ ok: true, value: { kind: "download" } })
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => "report.pdf",
      setSavePath: vi.fn(),
    })
    contents.session.emit("will-download", {}, item, { id: 8 })
    expect(item.setSavePath).not.toHaveBeenCalled()
    contents.session.emit("will-download", {}, item, { id: 7 })
    expect(item.setSavePath).toHaveBeenCalledWith(join(directory, "report (1).pdf"))
    expect(contents.session.listenerCount("will-download")).toBe(0)
  })
})
