export type TerminalLocation = "bottom" | "right"

export type TerminalPanelState = {
  readonly bottomPanelOpen: boolean
  readonly terminalLocation: TerminalLocation
  readonly workspacePanelOpen: boolean
}

export const isTerminalPanelOpen = ({
  bottomPanelOpen,
  terminalLocation,
  workspacePanelOpen,
}: TerminalPanelState): boolean =>
  (terminalLocation === "bottom" && bottomPanelOpen) ||
  (terminalLocation === "right" && workspacePanelOpen)

export function toggleBottomPanelState(state: TerminalPanelState): TerminalPanelState {
  if (state.terminalLocation === "bottom" && state.bottomPanelOpen) {
    return { ...state, bottomPanelOpen: false }
  }

  return {
    ...state,
    bottomPanelOpen: true,
    terminalLocation: "bottom",
  }
}

export function toggleTerminalPanelState(
  state: TerminalPanelState,
  defaultLocation: TerminalLocation
): TerminalPanelState {
  if (isTerminalPanelOpen(state)) {
    return state.terminalLocation === "bottom"
      ? { ...state, bottomPanelOpen: false }
      : { ...state, bottomPanelOpen: false, workspacePanelOpen: false }
  }

  return defaultLocation === "right"
    ? {
        bottomPanelOpen: false,
        terminalLocation: "right",
        workspacePanelOpen: true,
      }
    : {
        ...state,
        bottomPanelOpen: true,
        terminalLocation: "bottom",
      }
}
