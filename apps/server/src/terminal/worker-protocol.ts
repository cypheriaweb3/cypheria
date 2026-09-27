export type WorkerCreateTerminal = {
  args: string[]
  cols: number
  command: string
  cwd: string
  env: Record<string, string>
  rows: number
  terminalId: string
}

export type TerminalWorkerRequest =
  | { type: "create"; requestId: string; input: WorkerCreateTerminal }
  | { type: "input"; requestId: string; terminalId: string; data: string }
  | { type: "resize"; requestId: string; terminalId: string; cols: number; rows: number }
  | {
      type: "snapshot"
      requestId: string
      terminalId: string
      mode: "visible" | "full"
    }
  | { type: "capture"; requestId: string; terminalId: string; start?: number; end?: number }
  | { type: "kill"; requestId: string; terminalId: string }
  | { type: "killAll"; requestId: string }

export type TerminalWorkerResponse = {
  type: "response"
  requestId: string
} & ({ ok: true; result?: unknown } | { ok: false; error: string })

export type TerminalWorkerEvent =
  | { type: "output"; terminalId: string; data: Uint8Array; revision: number }
  | { type: "title"; terminalId: string; title: string | null }
  | {
      type: "exit"
      terminalId: string
      exitCode: number | null
      signal: number | null
    }

export type TerminalWorkerMessage = TerminalWorkerResponse | TerminalWorkerEvent
export type WorkerSnapshot = { data: string; revision: number }
