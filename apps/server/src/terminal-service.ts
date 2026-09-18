import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { basename } from "node:path"

import type { ProjectThreadPersistenceService } from "@cypheria/db"
import type { TerminalClientMessage, TerminalServerMessage } from "@cypheria/protocol"
import * as pty from "node-pty"

type Send = (message: TerminalServerMessage) => void
type SpawnTerminal = typeof pty.spawn
type TerminalRecord = {
  readonly ownerSessionId: string
  readonly process: pty.IPty
}

const environment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )

export class TerminalService {
  readonly #persistence: ProjectThreadPersistenceService
  readonly #spawn: SpawnTerminal
  readonly #terminals = new Map<string, TerminalRecord>()

  constructor(persistence: ProjectThreadPersistenceService, spawn: SpawnTerminal = pty.spawn) {
    this.#persistence = persistence
    this.#spawn = spawn
  }

  async handle(message: TerminalClientMessage, sessionId: string, send: Send): Promise<boolean> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as TerminalServerMessage)
    }
    try {
      switch (message.type) {
        case "terminal.open.request":
          respond(await this.#open(message.payload, sessionId, send))
          break
        case "terminal.write.request":
          this.#required(message.payload.terminalId, sessionId).write(message.payload.data)
          respond({ succeeded: true })
          break
        case "terminal.resize.request":
          this.#required(message.payload.terminalId, sessionId).resize(
            message.payload.cols,
            message.payload.rows
          )
          respond({ succeeded: true })
          break
        case "terminal.close.request":
          this.#close(message.payload.terminalId, sessionId)
          respond({ succeeded: true })
          break
        case "terminal.close-all.request":
          this.closeSession(sessionId)
          respond({ succeeded: true })
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "TERMINAL_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as TerminalServerMessage)
    }
    return true
  }

  closeSession(sessionId: string): void {
    for (const [terminalId, terminal] of this.#terminals) {
      if (terminal.ownerSessionId === sessionId) this.#close(terminalId, sessionId)
    }
  }

  stop(): void {
    for (const [terminalId, terminal] of this.#terminals) {
      this.#terminals.delete(terminalId)
      terminal.process.kill()
    }
  }

  async #open(
    input: { cols: number; cwd?: string; projectId?: string; rows: number },
    sessionId: string,
    send: Send
  ) {
    const cwd = await this.#resolveCwd(input.cwd, input.projectId)
    const info = await stat(cwd).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error("The terminal working directory is unavailable")
    const shell =
      process.platform === "win32"
        ? (process.env.COMSPEC ?? "powershell.exe")
        : (process.env.SHELL ?? "/bin/sh")
    const terminalId = randomUUID()
    const child = this.#spawn(shell, process.platform === "win32" ? [] : ["-l"], {
      cols: input.cols,
      cwd,
      env: environment(),
      name: "xterm-256color",
      rows: input.rows,
    })
    this.#terminals.set(terminalId, { ownerSessionId: sessionId, process: child })
    child.onData((data) => {
      send({ payload: { data, terminalId }, type: "terminal.output.notification" })
    })
    child.onExit(({ exitCode }) => {
      this.#terminals.delete(terminalId)
      send({ payload: { exitCode, terminalId }, type: "terminal.exited.notification" })
    })
    return { cwd, terminalId, title: basename(shell) }
  }

  async #resolveCwd(cwd?: string, projectId?: string): Promise<string> {
    if (cwd) return cwd
    if (!projectId) return process.cwd()
    const project = await this.#persistence.getProject(projectId)
    const root = project?.roots[0]
    if (!root) throw new Error("The project folder is unavailable")
    return root
  }

  #required(terminalId: string, sessionId: string): pty.IPty {
    const terminal = this.#terminals.get(terminalId)
    if (!terminal || terminal.ownerSessionId !== sessionId) throw new Error("Terminal is closed")
    return terminal.process
  }

  #close(terminalId: string, sessionId: string): void {
    const terminal = this.#terminals.get(terminalId)
    if (!terminal || terminal.ownerSessionId !== sessionId) return
    this.#terminals.delete(terminalId)
    terminal.process.kill()
  }
}
