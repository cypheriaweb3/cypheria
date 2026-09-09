import { describe, expect, it } from "vitest"

import {
  isTerminalPanelOpen,
  toggleBottomPanelState,
  toggleTerminalPanelState,
} from "./terminal-panel-state.js"

describe("terminal panel state", () => {
  it("hides the bottom panel without closing or relocating its terminal", () => {
    expect(
      toggleBottomPanelState({
        bottomPanelOpen: true,
        terminalLocation: "bottom",
        workspacePanelOpen: true,
      })
    ).toEqual({
      bottomPanelOpen: false,
      terminalLocation: "bottom",
      workspacePanelOpen: true,
    })
  })

  it("opens the bottom panel at the bottom independently of the terminal shortcut default", () => {
    expect(
      toggleBottomPanelState({
        bottomPanelOpen: false,
        terminalLocation: "right",
        workspacePanelOpen: true,
      })
    ).toEqual({
      bottomPanelOpen: true,
      terminalLocation: "bottom",
      workspacePanelOpen: true,
    })
  })

  it("recognizes the visible panel at its current location", () => {
    expect(
      isTerminalPanelOpen({
        bottomPanelOpen: true,
        terminalLocation: "bottom",
        workspacePanelOpen: true,
      })
    ).toBe(true)
    expect(
      isTerminalPanelOpen({
        bottomPanelOpen: false,
        terminalLocation: "right",
        workspacePanelOpen: true,
      })
    ).toBe(true)
  })

  it("hides a visible bottom terminal without changing its location", () => {
    expect(
      toggleTerminalPanelState(
        {
          bottomPanelOpen: true,
          terminalLocation: "bottom",
          workspacePanelOpen: true,
        },
        "right"
      )
    ).toEqual({
      bottomPanelOpen: false,
      terminalLocation: "bottom",
      workspacePanelOpen: true,
    })
  })

  it("hides a visible right terminal instead of moving it to the configured bottom default", () => {
    expect(
      toggleTerminalPanelState(
        {
          bottomPanelOpen: false,
          terminalLocation: "right",
          workspacePanelOpen: true,
        },
        "bottom"
      )
    ).toEqual({
      bottomPanelOpen: false,
      terminalLocation: "right",
      workspacePanelOpen: false,
    })
  })

  it("opens a hidden terminal at the configured bottom location", () => {
    expect(
      toggleTerminalPanelState(
        {
          bottomPanelOpen: false,
          terminalLocation: "right",
          workspacePanelOpen: false,
        },
        "bottom"
      )
    ).toEqual({
      bottomPanelOpen: true,
      terminalLocation: "bottom",
      workspacePanelOpen: false,
    })
  })

  it("opens a hidden terminal at the configured right location and closes the bottom panel", () => {
    expect(
      toggleTerminalPanelState(
        {
          bottomPanelOpen: true,
          terminalLocation: "right",
          workspacePanelOpen: false,
        },
        "right"
      )
    ).toEqual({
      bottomPanelOpen: false,
      terminalLocation: "right",
      workspacePanelOpen: true,
    })
  })
})
