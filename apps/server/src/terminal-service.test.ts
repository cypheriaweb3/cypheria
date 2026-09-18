import type { ProjectThreadPersistenceService } from "@cypheria/db"
import type { TerminalServerMessage } from "@cypheria/protocol"
import type { IPty } from "node-pty"
import { describe, expect, it, vi } from "vitest"

import { TerminalService } from "./terminal-service.js"

const projectId = "01995bc5-c4ee-7e9c-8d7f-5f112db567e9"

describe("TerminalService", () => {
  it("opens a project terminal, streams output, and enforces session ownership", async () => {
    let onData: ((data: string) => void) | undefined
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const child = {
      kill: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        onData = listener
        return { dispose: vi.fn() }
      }),
      onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
        onExit = listener
        return { dispose: vi.fn() }
      }),
      resize: vi.fn(),
      write: vi.fn(),
    } as unknown as IPty
    const spawn = vi.fn(() => child)
    const persistence = {
      getProject: vi.fn(async () => ({ roots: [process.cwd()] })),
    } as unknown as ProjectThreadPersistenceService
    const service = new TerminalService(persistence, spawn as never)
    const messages: TerminalServerMessage[] = []

    await service.handle(
      {
        payload: { cols: 100, projectId, rows: 28 },
        requestId: "open-1",
        type: "terminal.open.request",
      },
      "session-1",
      (message) => messages.push(message)
    )
    const opened = messages[0]
    expect(opened).toMatchObject({ payload: { ok: true }, type: "terminal.open.response" })
    if (!opened || opened.type !== "terminal.open.response" || !opened.payload.ok) {
      throw new Error("Expected an opened terminal")
    }
    const terminalId = opened.payload.value.terminalId
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: process.cwd() })
    )

    onData?.("hello")
    expect(messages.at(-1)).toMatchObject({
      payload: { data: "hello", terminalId },
      type: "terminal.output.notification",
    })

    await service.handle(
      {
        payload: { data: "pwd\n", terminalId },
        requestId: "write-1",
        type: "terminal.write.request",
      },
      "session-2",
      (message) => messages.push(message)
    )
    expect(messages.at(-1)).toMatchObject({
      payload: { ok: false },
      type: "terminal.write.response",
    })
    expect(child.write).not.toHaveBeenCalled()

    service.closeSession("session-1")
    expect(child.kill).toHaveBeenCalledOnce()
    onExit?.({ exitCode: 0 })
  })
})
