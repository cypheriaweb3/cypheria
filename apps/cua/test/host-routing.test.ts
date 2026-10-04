import { describe, expect, it, vi } from "vitest"

import {
  CuaHost,
  type CuaHostEntry,
  type CuaHosts,
  type DesktopSurfaces,
} from "../src/host/index.ts"
import type { CuaSurface } from "../src/surfaces.ts"

const ALL: ReadonlySet<CuaSurface> = new Set(["iab", "mcpapps", "browsers", "computer"])

const desktop = (): DesktopSurfaces & { opened: string[]; preferred: (string | undefined)[] } => {
  const opened: string[] = []
  const preferred: (string | undefined)[] = []
  return {
    async command() {
      return { result: {} }
    },
    async listMcpApps() {
      return []
    },
    async listTabs() {
      return []
    },
    async mcpApp(_context, _appId, _action, host) {
      preferred.push(host)
      return { text: "- button" }
    },
    async newTab(_context, options) {
      opened.push(options.host)
      return {
        active: false,
        host: options.host,
        id: "tab",
        kind: options.kind,
        title: "",
        url: "",
      }
    },
    opened,
    preferred,
  }
}

const setup = (entries: CuaHostEntry[], initiator?: string) => {
  const device = vi.fn<CuaHosts["device"]>(async (_host, _context, request) => {
    if (request.op === "browsers.list") {
      return [{ connectable: true, id: "chrome", installed: true, name: "Google Chrome" }]
    }
    if (request.op === "apps.get") {
      return { binding: { name: "Notes", pid: 10, windowId: 20 }, observation: { text: "" } }
    }
    return []
  })
  const surfaces = desktop()
  const host = new CuaHost({
    desktop: surfaces,
    hosts: { device, list: () => entries },
    initiator: () => initiator,
    surfaces: () => ALL,
  })
  return { device, host, surfaces }
}

const laptop: CuaHostEntry = { id: "laptop", name: "Laptop", surfaces: [...ALL] }
const studio: CuaHostEntry = { id: "studio", name: "Studio", surfaces: [...ALL] }
const context = { threadId: "thread-1" }

describe("cua host routing", () => {
  it("opens new resources on the device the turn came from", async () => {
    const { device, host, surfaces } = setup([laptop, studio], "studio")
    await host.handle({ op: "iab.new", url: "https://example.com" }, context)
    expect(surfaces.opened).toEqual(["studio"])
    const browsers = await host.handle({ op: "browsers.list" }, context)
    expect(browsers).toEqual([expect.objectContaining({ host: "studio", id: "chrome" })])
    expect(await host.handle({ app: "Notes", op: "apps.get" }, context)).toMatchObject({
      host: "studio",
    })
    expect(device.mock.calls.map(([target]) => target)).toEqual(["studio", "studio"])
  })

  it("uses the only capable device and asks for a choice among several", async () => {
    const phoneTurn = setup([laptop], "phone")
    await phoneTurn.host.handle({ op: "iab.new" }, context)
    expect(phoneTurn.surfaces.opened).toEqual(["laptop"])

    const ambiguous = setup([laptop, studio], "phone")
    await expect(ambiguous.host.handle({ op: "iab.new" }, context)).rejects.toThrow(
      /Several devices offer the built-in browser: laptop \(Laptop\), studio \(Studio\)/u
    )
    await ambiguous.host.handle({ host: "laptop", op: "iab.new" }, context)
    expect(ambiguous.surfaces.opened).toEqual(["laptop"])
  })

  it("keeps resources on the device that has them and rejects unknown devices", async () => {
    const { device, host } = setup([laptop, studio], "studio")
    await host.handle(
      {
        action: { type: "snapshot" },
        browserId: "chrome",
        host: "laptop",
        op: "browsers.act",
        tabId: "t",
      },
      context
    )
    expect(device.mock.calls[0]?.[0]).toBe("laptop")
    await expect(
      host.handle({ browserId: "chrome", host: "gone", op: "browsers.tabs" }, context)
    ).rejects.toThrow(/Device gone is not connected/u)
  })

  it("refuses a device that does not offer the surface", async () => {
    const { host } = setup([{ id: "laptop", name: "Laptop", surfaces: ["iab"] }])
    await expect(host.handle({ op: "apps.list" }, context)).rejects.toThrow(
      /Native app control needs a connected Cypheria Desktop/u
    )
    await expect(host.handle({ host: "laptop", op: "apps.list" }, context)).rejects.toThrow(
      /Native app control is unavailable on laptop \(Laptop\)/u
    )
  })

  it("prefers the turn's device for MCP Apps and lists hosts with the current one", async () => {
    const { host, surfaces } = setup([laptop, studio], "studio")
    await host.handle({ action: { type: "snapshot" }, appId: "app-1", op: "mcpapps.act" }, context)
    expect(surfaces.preferred).toEqual(["studio"])
    expect(await host.handle({ op: "hosts" }, context)).toEqual([
      expect.objectContaining({ current: false, id: "laptop" }),
      expect.objectContaining({ current: true, id: "studio" }),
    ])
  })

  it("tells every device a Thread used about its turn end and its closing", async () => {
    const { device, host } = setup([laptop, studio], "studio")
    await host.handle({ op: "browsers.list" }, context)
    await host.handle({ host: "laptop", op: "apps.list" }, context)
    device.mockClear()
    await host.turnEnded(context)
    expect(device.mock.calls.map(([target, , request]) => [target, request.op]).sort()).toEqual([
      ["laptop", "device.turnEnded"],
      ["studio", "device.turnEnded"],
    ])
    device.mockClear()
    host.closeThread("thread-1")
    await host.turnEnded(context)
    expect(device.mock.calls.map(([, , request]) => request.op)).toEqual([
      "device.closeThread",
      "device.closeThread",
    ])
  })
})
