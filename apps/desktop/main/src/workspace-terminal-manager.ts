import { randomUUID } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { basename } from "node:path"
import * as pty from "node-pty"
import type { WorkspaceTerminalEvent, WorkspaceTerminalSession } from "../../ipc/src/index.js"

type TerminalRecord = {
  readonly process: pty.IPty
  readonly session: WorkspaceTerminalSession
}

type WorkspaceTerminalManagerOptions = {
  readonly onEvent: (event: WorkspaceTerminalEvent) => void
}

const terminalEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )

export const createWorkspaceTerminalManager = (options: WorkspaceTerminalManagerOptions) => {
  const terminals = new Map<string, TerminalRecord>()

  const openTerminal = (cwd?: string): WorkspaceTerminalSession => {
    const resolvedCwd = cwd ?? process.cwd()
    if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {
      throw new Error("The terminal working directory is unavailable.")
    }

    const terminalId = randomUUID()
    const shell = process.env.SHELL || "/bin/zsh"
    const session = {
      cwd: resolvedCwd,
      terminalId,
      title: basename(shell),
    }
    const child = pty.spawn(shell, process.platform === "win32" ? [] : ["-l"], {
      cols: 100,
      cwd: resolvedCwd,
      env: terminalEnvironment(),
      name: "xterm-256color",
      rows: 28,
    })
    terminals.set(terminalId, { process: child, session })
    child.onData((data) => options.onEvent({ data, terminalId, type: "terminal.output" }))
    child.onExit(({ exitCode }) => {
      terminals.delete(terminalId)
      options.onEvent({ exitCode, terminalId, type: "terminal.exited" })
    })
    return session
  }

  const writeTerminal = (terminalId: string, data: string) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) throw new Error("Terminal is closed.")
    terminal.process.write(data)
    return { written: true as const }
  }

  const resizeTerminal = (terminalId: string, cols: number, rows: number) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) throw new Error("Terminal is closed.")
    terminal.process.resize(cols, rows)
    return { resized: true as const }
  }

  const closeTerminal = (terminalId: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminals.delete(terminalId)
      terminal.process.kill()
    }
    return { closed: true as const }
  }

  const closeAllTerminals = () => {
    for (const terminalId of [...terminals.keys()]) closeTerminal(terminalId)
    return { closed: true as const }
  }

  return {
    closeAllTerminals,
    closeTerminal,
    openTerminal,
    resizeTerminal,
    writeTerminal,
  }
}

export type WorkspaceTerminalManager = ReturnType<typeof createWorkspaceTerminalManager>
