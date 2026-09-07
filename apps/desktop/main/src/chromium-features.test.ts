import { describe, expect, it, vi } from "vitest"

import { configureChromiumFeatures, DISABLED_CHROMIUM_FEATURES } from "./chromium-features.js"

describe("configureChromiumFeatures", () => {
  it("disables Chromium shared compression dictionary storage before startup", () => {
    const appendSwitch = vi.fn()

    configureChromiumFeatures({ appendSwitch })

    expect(appendSwitch).toHaveBeenCalledOnce()
    expect(appendSwitch).toHaveBeenCalledWith(
      "disable-features",
      DISABLED_CHROMIUM_FEATURES.join(",")
    )
  })
})
