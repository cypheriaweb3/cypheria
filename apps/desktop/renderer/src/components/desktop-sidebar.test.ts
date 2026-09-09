import { describe, expect, it } from "vitest"

import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH,
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_REMAINING_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
} from "./desktop-sidebar.js"

describe("desktop sidebar width", () => {
  it("matches the ChatGPT Desktop default and fixed limits", () => {
    expect(DESKTOP_SIDEBAR_DEFAULT_WIDTH).toBe(275)
    expect(DESKTOP_SIDEBAR_MIN_WIDTH).toBe(240)
    expect(DESKTOP_SIDEBAR_MAX_WIDTH).toBe(520)
    expect(DESKTOP_SIDEBAR_MIN_REMAINING_WIDTH).toBe(320)
  })

  it("clamps width while preserving the minimum workbench width", () => {
    expect(clampDesktopSidebarWidth(100, 1_280)).toBe(240)
    expect(clampDesktopSidebarWidth(400, 1_280)).toBe(400)
    expect(clampDesktopSidebarWidth(900, 1_280)).toBe(520)
    expect(clampDesktopSidebarWidth(500, 720)).toBe(400)
  })
})
