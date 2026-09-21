import { describe, expect, it } from "vitest"

import { filterDevelopmentItems, resolveDesktopDevelopment } from "./development-mode.js"

describe("desktop development mode", () => {
  it("prefers the runtime flag injected by the Electron development shell", () => {
    expect(resolveDesktopDevelopment(true, false)).toBe(true)
    expect(resolveDesktopDevelopment(false, true)).toBe(false)
  })

  it("falls back to Vite development mode outside Electron", () => {
    expect(resolveDesktopDevelopment(undefined, true)).toBe(true)
    expect(resolveDesktopDevelopment(undefined, false)).toBe(false)
  })

  it("removes development-only navigation from production", () => {
    const items = [{ id: "regular" }, { developmentOnly: true, id: "demo" }]

    expect(filterDevelopmentItems(items, false).map(({ id }) => id)).toEqual(["regular"])
    expect(filterDevelopmentItems(items, true).map(({ id }) => id)).toEqual(["regular", "demo"])
  })
})
