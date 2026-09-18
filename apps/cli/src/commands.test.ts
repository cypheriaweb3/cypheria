import type { CypheriaClient } from "@cypheria/client"
import { describe, expect, it, vi } from "vitest"

import { runCli } from "./commands.js"

const io = () => ({ error: vi.fn(), log: vi.fn() })

describe("Cypheria CLI", () => {
  it("delegates server lifecycle to the installed server supervisor CLI", async () => {
    const output = io()
    const invokeServerCli = vi.fn(async () => "Cypheria server started")

    await expect(runCli(["server", "start"], output, { invokeServerCli })).resolves.toBe(0)
    expect(invokeServerCli).toHaveBeenCalledWith("start")
    expect(output.log).toHaveBeenCalledWith("Cypheria server started")
  })

  it("lists shared server resources through @cypheria/client", async () => {
    const output = io()
    const close = vi.fn(async () => undefined)
    const connect = vi.fn(async () => undefined)
    const list = vi.fn(async () => [{ id: "codex" }])
    const client = {
      agents: { list },
      close,
      connect,
    } as unknown as CypheriaClient

    await expect(runCli(["agents", "list"], output, { createClient: () => client })).resolves.toBe(
      0
    )
    expect(connect).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(output.log).toHaveBeenCalledWith(JSON.stringify([{ id: "codex" }], undefined, 2))
  })

  it("tails the requested number of server log lines without opening a client", async () => {
    const output = io()
    const readLog = vi.fn(async () => "line 2\nline 3")

    await expect(runCli(["server", "logs", "--lines", "2"], output, { readLog })).resolves.toBe(0)
    expect(readLog).toHaveBeenCalledWith(2)
    expect(output.log).toHaveBeenCalledWith("line 2\nline 3")
  })
})
