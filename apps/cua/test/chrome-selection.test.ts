import { describe, expect, it, vi } from "vitest"

import type { ChromeDriver } from "../src/host/chrome/driver.ts"
import {
  type ChromeImplementationType,
  SelectedChromeDrivers,
} from "../src/host/chrome/selection.ts"

const driver = (id: string) => ({ info: () => ({ id, name: id }) }) as unknown as ChromeDriver

describe("SelectedChromeDrivers", () => {
  it("lists only the selected implementation and releases the previous one", async () => {
    let selected: ChromeImplementationType = "cdp"
    const agentBrowser = { dispose: vi.fn(), drivers: async () => [driver("chrome")] }
    const drivers = new SelectedChromeDrivers({
      selected: () => selected,
      sources: { cdp: agentBrowser },
    })
    expect(drivers.available).toEqual(["cdp"])
    expect(drivers.ready).toBe(true)
    expect((await drivers.drivers()).map((item) => item.info().id)).toEqual(["chrome"])

    selected = "extension"
    expect(drivers.ready).toBe(false)
    await expect(drivers.drivers()).resolves.toEqual([])
    expect(agentBrowser.dispose).toHaveBeenCalledOnce()
  })
})
