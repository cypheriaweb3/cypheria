import { describe, expect, it, vi } from "vitest"

import type { BrowserHostCall } from "../src/browser/protocol.ts"
import type { BrowserBackend, BrowserInfo, ChromeBrowserInfo } from "../src/browser/types.ts"
import {
  CuaHost,
  type CuaHostEntry,
  type CuaHosts,
  type DesktopBrowsers,
} from "../src/host/index.ts"
import type { CuaSurface } from "../src/surfaces.ts"

const SURFACES: ReadonlySet<CuaSurface> = new Set(["browser", "computer"])
const BACKENDS: ReadonlySet<BrowserBackend> = new Set(["iab", "mcpapps", "chrome"])

const chrome = (extra: Partial<ChromeBrowserInfo> = {}): ChromeBrowserInfo => ({
  family: "chrome",
  id: "chrome",
  name: "Google Chrome",
  ...extra,
})

const setup = (
  entries: CuaHostEntry[],
  options: {
    initiator?: string
    browsers?: Record<string, ChromeBrowserInfo[]>
    backends?: ReadonlySet<BrowserBackend>
    blocked?: ReadonlySet<string>
  } = {}
) => {
  const device = vi.fn<CuaHosts["device"]>(async (host, _context, request) => {
    if (request.op === "browsers.list") return options.browsers?.[host] ?? [chrome()]
    if (request.op === "apps.get") {
      return { binding: { name: "Notes", pid: 10, windowId: 20 }, observation: { text: "" } }
    }
    if (request.op === "browser.call") return { called: request.member, host }
    return []
  })
  const desktopCalls: { backend: string; call: BrowserHostCall; preferred: string | undefined }[] =
    []
  const desktop: DesktopBrowsers = {
    async call(_context, backend, call, preferred) {
      desktopCalls.push({ backend, call, preferred })
      return call.member === "tabs.list" ? [] : { id: "tab-1" }
    },
  }
  const audit = vi.fn()
  const host = new CuaHost({
    audit,
    backends: () => options.backends ?? BACKENDS,
    blockedFamilies: () => options.blocked ?? new Set(),
    desktop,
    hosts: { device, list: () => entries },
    initiator: () => options.initiator,
    surfaces: () => SURFACES,
  })
  return { audit, desktopCalls, device, host }
}

const all: CuaHostEntry["capabilities"] = ["iab", "mcpapps", "chrome", "computer"]
const laptop: CuaHostEntry = { capabilities: all, id: "laptop", name: "Laptop" }
const studio: CuaHostEntry = { capabilities: all, id: "studio", name: "Studio" }
const context = { threadId: "thread-1" }

describe("cua host routing", () => {
  it("lists one built-in browser, MCP Apps, and each device's browsers with unique IDs", async () => {
    const { host } = setup([laptop, studio], {
      browsers: {
        laptop: [chrome()],
        studio: [chrome(), chrome({ family: "edge", id: "edge", name: "Microsoft Edge" })],
      },
    })
    const ids = ((await host.handle({ op: "browsers.list" }, context)) as BrowserInfo[]).map(
      (browser) => browser.id
    )
    expect(ids).toEqual(["iab", "mcpapps", "chrome@laptop", "chrome@studio", "edge"])
  })

  it("hides and refuses browser families the settings block", async () => {
    const { host } = setup([studio], {
      blocked: new Set(["edge"]),
      browsers: {
        studio: [chrome(), chrome({ family: "edge", id: "edge", name: "Microsoft Edge" })],
      },
    })
    const ids = ((await host.handle({ op: "browsers.list" }, context)) as BrowserInfo[]).map(
      (browser) => browser.id
    )
    expect(ids).toEqual(["iab", "mcpapps", "chrome"])
    await expect(
      host.handle(
        { args: [], browser: "edge", member: "tabs.list", op: "browser.call" } as never,
        context
      )
    ).rejects.toThrow()
  })

  it("resolves a family alias on the device the turn came from", async () => {
    const { device, host } = setup([laptop, studio], { initiator: "studio" })
    expect(
      await host.handle(
        { args: [], browser: "chrome", member: "tabs.new", op: "browser.call" },
        context
      )
    ).toEqual({ called: "tabs.new", host: "studio" })
    const call = device.mock.calls.find(([, , request]) => request.op === "browser.call")
    expect(call?.[2]).toMatchObject({ backend: "chrome", browser: "chrome" })
  })

  it("resolves a family with several profiles to the profile used last", async () => {
    const { host } = setup([laptop], {
      browsers: {
        laptop: [
          chrome({ id: "chrome:Default", profileName: "Personal" }),
          chrome({ id: "chrome:Profile 1", lastUsed: true, profileName: "Work" }),
        ],
      },
      initiator: "laptop",
    })
    const list = (await host.handle({ op: "browsers.list" }, context)) as BrowserInfo[]
    expect(list.filter((browser) => browser.type === "chrome")).toEqual([
      {
        family: "chrome",
        host: "laptop",
        id: "chrome:Default",
        name: "Google Chrome",
        profileName: "Personal",
        type: "chrome",
      },
      {
        family: "chrome",
        host: "laptop",
        id: "chrome:Profile 1",
        lastUsed: true,
        name: "Google Chrome",
        profileName: "Work",
        type: "chrome",
      },
    ])
    expect(
      await host.handle(
        { args: [], browser: "chrome", member: "tabs.list", op: "browser.call" },
        context
      )
    ).toEqual({ called: "tabs.list", host: "laptop" })
    await expect(
      host.handle(
        { args: [], browser: "chrome:Default", member: "tabs.list", op: "browser.call" },
        context
      )
    ).resolves.toEqual({ called: "tabs.list", host: "laptop" })
  })

  it("asks for a choice when an alias is ambiguous and nothing is current", async () => {
    const { host } = setup([laptop, studio])
    await expect(
      host.handle({ args: [], browser: "chrome", member: "tabs.list", op: "browser.call" }, context)
    ).rejects.toThrow(/Several browsers match chrome: chrome@laptop, chrome@studio/u)
    await expect(
      host.handle({ args: [], browser: "safari", member: "tabs.list", op: "browser.call" }, context)
    ).rejects.toThrow(/No browser safari is available/u)
  })

  it("routes the built-in browser and MCP Apps through the desktop broker with the current device", async () => {
    const { desktopCalls, host } = setup([laptop, studio], { initiator: "studio" })
    await host.handle(
      {
        args: ["https://example.com"],
        browser: "iab",
        member: "tab.goto",
        op: "browser.call",
        tab: "t1",
      },
      context
    )
    await host.handle(
      { args: [], browser: "mcpapps", member: "tabs.list", op: "browser.call" },
      context
    )
    expect(
      desktopCalls.map(({ backend, call, preferred }) => [backend, call.member, preferred])
    ).toEqual([
      ["iab", "tab.goto", "studio"],
      ["mcpapps", "tabs.list", "studio"],
    ])
  })

  it("checks members against the browser type and their arguments", async () => {
    const { host } = setup([laptop])
    await expect(
      host.handle({ args: [], browser: "mcpapps", member: "tabs.new", op: "browser.call" }, context)
    ).rejects.toThrow(/tabs.new is not supported by MCP Apps/u)
    await expect(
      host.handle(
        { args: [], browser: "iab", member: "user.openTabs", op: "browser.call" },
        context
      )
    ).rejects.toThrow(/not supported/u)
    await expect(
      host.handle(
        { args: ["nope"], browser: "iab", member: "ax.click", op: "browser.call", tab: "t" },
        context
      )
    ).rejects.toThrow(/Invalid arguments for ax.click/u)
    await expect(
      host.handle({ args: [1], browser: "iab", member: "ax.click", op: "browser.call" }, context)
    ).rejects.toThrow(/ax.click needs a tab/u)
  })

  it("audits mutations without arguments and skips reads", async () => {
    const { audit, host } = setup([laptop])
    await host.handle(
      { args: [3], browser: "iab", member: "ax.click", op: "browser.call", tab: "t1" },
      context
    )
    await host.handle(
      { args: ["state"], browser: "iab", member: "ax.get", op: "browser.call", tab: "t1" },
      context
    )
    expect(audit.mock.calls).toEqual([
      [{ ok: true, op: "browser.ax.click", target: "iab t1", threadId: "thread-1" }],
    ])
  })

  it("hides browser backends the settings turn off", async () => {
    const { host } = setup([laptop], { backends: new Set(["chrome"]) })
    const ids = ((await host.handle({ op: "browsers.list" }, context)) as BrowserInfo[]).map(
      (b) => b.id
    )
    expect(ids).toEqual(["chrome"])
  })

  it("opens apps on the turn's device and refuses devices without native apps", async () => {
    const { host } = setup([laptop, studio], { initiator: "studio" })
    expect(await host.handle({ app: "Notes", op: "apps.get" }, context)).toMatchObject({
      host: "studio",
    })
    const browserOnly = setup([{ capabilities: ["iab"], id: "laptop", name: "Laptop" }])
    await expect(browserOnly.host.handle({ op: "apps.list" }, context)).rejects.toThrow(
      /Native app control needs a connected Cypheria Desktop/u
    )
    await expect(
      browserOnly.host.handle({ host: "laptop", op: "apps.list" }, context)
    ).rejects.toThrow(/Native app control is unavailable on laptop \(Laptop\)/u)
  })

  it("keeps a Thread's audio recording on the device that started it", async () => {
    const { audit, device, host } = setup([laptop, studio], { initiator: "studio" })
    await expect(host.handle({ op: "apps.audio.stop" }, context)).rejects.toThrow(
      /No computer audio recording was started/u
    )
    await host.handle({ host: "laptop", maxDurationMs: 5000, op: "apps.audio.start" }, context)
    await host.handle({ op: "apps.audio.stop" }, context)
    await host.handle({ length: 3, offset: 0, op: "apps.audio.read" }, context)
    expect(device.mock.calls.map(([target, , request]) => [target, request.op])).toEqual([
      ["laptop", "apps.audio.start"],
      ["laptop", "apps.audio.stop"],
      ["laptop", "apps.audio.read"],
    ])
    expect(audit.mock.calls.map(([entry]) => entry.op)).toEqual([
      "apps.audio.stop",
      "apps.audio.start",
      "apps.audio.stop",
    ])
    await expect(
      host.handle({ maxDurationMs: 300_001, op: "apps.audio.start" }, context)
    ).rejects.toThrow(/Invalid cua request/u)
  })

  it("tells every device a Thread used about its turn end and its closing", async () => {
    const { device, host } = setup([laptop, studio], { initiator: "studio" })
    await host.handle({ op: "browsers.list" }, context)
    device.mockClear()
    await host.turnEnded(context)
    expect(device.mock.calls.map(([target, , request]) => [target, request.op]).sort()).toEqual([
      ["laptop", "device.turnEnded"],
      ["studio", "device.turnEnded"],
    ])
    device.mockClear()
    host.closeThread("thread-1")
    expect(device.mock.calls.map(([, , request]) => request.op)).toEqual([
      "device.closeThread",
      "device.closeThread",
    ])
  })
})
