import { describe, expect, it } from "vitest"
import { localeFromPathname, localizePath } from "./i18n"

describe("website locale routing", () => {
  it("uses English at root paths and Simplified Chinese under /zh-CN", () => {
    expect(localeFromPathname("/docs/security")).toBe("en")
    expect(localeFromPathname("/zh-CN/docs/security")).toBe("zh-CN")
  })

  it("switches locale while preserving the current slug", () => {
    expect(localizePath("/docs/security", "zh-CN")).toBe("/zh-CN/docs/security")
    expect(localizePath("/zh-CN/product", "en")).toBe("/product")
    expect(localizePath("/", "zh-CN")).toBe("/zh-CN")
  })
})
