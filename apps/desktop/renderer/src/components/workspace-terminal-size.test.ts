import { describe, expect, it } from "vitest"

import { normalizeWorkspaceTerminalSize } from "./workspace-terminal-size.js"

describe("normalizeWorkspaceTerminalSize", () => {
  it("preserves ordinary xterm dimensions", () => {
    expect(normalizeWorkspaceTerminalSize(120, 48)).toEqual({ cols: 120, rows: 48 })
  })

  it("keeps transient FitAddon output inside the validated IPC bounds", () => {
    expect(normalizeWorkspaceTerminalSize(900, 600)).toEqual({ cols: 500, rows: 300 })
    expect(normalizeWorkspaceTerminalSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      cols: 2,
      rows: 1,
    })
  })
})
