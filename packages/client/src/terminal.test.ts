import { describe, expect, it, vi } from "vitest"

import type { ServerClient } from "./server-client.js"
import { createTerminalActions } from "./terminal.js"

describe("terminal actions", () => {
  it("maps lifecycle operations to terminal protocol messages", async () => {
    const requestTerminal = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "terminal.open.request"
            ? { cwd: "/workspace", terminalId: "id", title: "zsh" }
            : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const actions = createTerminalActions({ requestTerminal } as unknown as ServerClient)

    await actions.open({ projectId: "project-1" })
    await actions.write("terminal-1", "pwd\n")
    await actions.resize("terminal-1", 120, 40)
    await actions.close("terminal-1")
    await actions.closeAll()

    expect(requestTerminal.mock.calls).toEqual([
      ["terminal.open.request", { projectId: "project-1" }, undefined],
      ["terminal.write.request", { data: "pwd\n", terminalId: "terminal-1" }, undefined],
      ["terminal.resize.request", { cols: 120, rows: 40, terminalId: "terminal-1" }, undefined],
      ["terminal.close.request", { terminalId: "terminal-1" }, undefined],
      ["terminal.close-all.request", {}, undefined],
    ])
  })

  it("normalizes terminal errors", async () => {
    const requestTerminal = vi.fn(async () => ({
      payload: {
        error: { code: "TERMINAL_CLOSED", message: "Terminal is closed" },
        ok: false as const,
      },
      requestId: "test",
      type: "terminal.write.response" as const,
    }))
    const actions = createTerminalActions({ requestTerminal } as unknown as ServerClient)
    await expect(actions.write("terminal-1", "x")).rejects.toMatchObject({
      message: "Terminal is closed",
      name: "TERMINAL_CLOSED",
    })
  })
})
