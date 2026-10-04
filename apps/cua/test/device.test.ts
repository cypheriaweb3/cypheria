import { describe, expect, it, vi } from "vitest"

import { CuaDevice, type ExternalBrowsersBackend } from "../src/host/index.ts"

describe("cua device", () => {
  it("validates requests again and reports missing backends", async () => {
    const device = new CuaDevice({})
    expect(device.surfaces).toEqual({ browsers: false, computer: false })
    await expect(device.handle({ op: "iab.tabs" }, { threadId: "t" })).rejects.toThrow(
      /Invalid device request/u
    )
    await expect(device.handle({ op: "apps.list" }, { threadId: "t" })).rejects.toThrow(
      /Native app control is unavailable on this device/u
    )
  })

  it("runs lifecycle notices for the Thread", async () => {
    const browsers = {
      closeThread: vi.fn(),
      list: vi.fn(async () => []),
      turnEnded: vi.fn(async () => undefined),
    } as unknown as ExternalBrowsersBackend
    const device = new CuaDevice({ browsers })
    expect(device.surfaces.browsers).toBe(true)
    await device.handle({ op: "device.turnEnded" }, { threadId: "t" })
    await device.handle({ op: "device.closeThread" }, { threadId: "t" })
    await device.handle({ host: "studio", op: "browsers.list" }, { threadId: "t" })
    expect(browsers.turnEnded).toHaveBeenCalledWith("t")
    expect(browsers.closeThread).toHaveBeenCalledWith("t")
    expect(browsers.list).toHaveBeenCalledOnce()
  })
})
