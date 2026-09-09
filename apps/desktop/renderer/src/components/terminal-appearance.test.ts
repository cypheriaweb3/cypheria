import { describe, expect, it } from "vitest"
import { terminalAppearanceFromStyles } from "./terminal-appearance.js"

describe("terminal appearance", () => {
  it("derives the xterm theme and code font from application tokens", () => {
    expect(
      terminalAppearanceFromStyles(
        {
          backgroundColor: "oklch(1 0 0)",
          color: "oklch(0.145 0 0)",
          fontFamily: '"Berkeley Mono", monospace',
          fontSize: "13px",
        },
        {
          getPropertyValue: (name) =>
            name === "--scrollbar-thumb-strong"
              ? " color-mix(in srgb, black 18%, transparent) "
              : "",
        }
      )
    ).toEqual({
      fontFamily: '"Berkeley Mono", monospace',
      fontSize: 13,
      theme: {
        background: "oklch(1 0 0)",
        cursor: "oklch(0.145 0 0)",
        foreground: "oklch(0.145 0 0)",
        selectionBackground: "color-mix(in srgb, black 18%, transparent)",
      },
    })
  })

  it("falls back to the default code size without inventing a selection color", () => {
    expect(
      terminalAppearanceFromStyles(
        {
          backgroundColor: "transparent",
          color: "canvastext",
          fontFamily: "monospace",
          fontSize: "invalid",
        },
        { getPropertyValue: () => "" }
      )
    ).toEqual({
      fontFamily: "monospace",
      fontSize: 12,
      theme: {
        background: "transparent",
        cursor: "canvastext",
        foreground: "canvastext",
      },
    })
  })
})
