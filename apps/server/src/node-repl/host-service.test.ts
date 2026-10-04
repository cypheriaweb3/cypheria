import { createConnection } from "node:net"
import { createInterface } from "node:readline"

import { CuaHostError } from "@cypheria/cua/host"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NodeReplHostManager } from "./host-manager.js"
import { NodeReplHostService } from "./host-service.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

const rpc = async (pipePath: string, message: unknown) => {
  const socket = createConnection(pipePath)
  await new Promise<void>((resolve) => socket.once("connect", resolve))
  const response = await new Promise<Record<string, unknown>>((resolve) => {
    createInterface({ input: socket }).once("line", (line) => resolve(JSON.parse(line)))
    socket.write(`${JSON.stringify(message)}\n`)
  })
  socket.destroy()
  return response
}

describe("NodeReplHostService", () => {
  let service: NodeReplHostService | undefined
  afterEach(async () => {
    await service?.close()
  })

  it("answers cua requests for its Thread and working directory", async () => {
    const handle = vi.fn(async (request: unknown) => ({ echoed: request }))
    service = new NodeReplHostService({ cua: { handle }, cwd: "/work", threadId })
    const pipePath = await service.start()
    await expect(
      rpc(pipePath, { id: 1, jsonrpc: "2.0", method: "cua", params: { op: "state" } })
    ).resolves.toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: { echoed: { op: "state" } },
    })
    expect(handle).toHaveBeenCalledWith({ op: "state" }, { cwd: "/work", threadId })
  })

  it("returns host refusals as errors with their message", async () => {
    service = new NodeReplHostService({
      cua: {
        handle: async () => {
          throw new CuaHostError("disabled", "External browser control is disabled.")
        },
      },
      threadId,
    })
    const pipePath = await service.start()
    await expect(
      rpc(pipePath, { id: 2, jsonrpc: "2.0", method: "cua", params: {} })
    ).resolves.toEqual({
      error: { code: -32000, message: "External browser control is disabled." },
      id: 2,
      jsonrpc: "2.0",
    })
  })

  it("rejects other services", async () => {
    service = new NodeReplHostService({ cua: { handle: vi.fn() }, threadId })
    const pipePath = await service.start()
    const response = await rpc(pipePath, { id: 3, jsonrpc: "2.0", method: "sky", params: {} })
    expect(response.error).toMatchObject({ code: -32601 })
  })
})

describe("NodeReplHostManager", () => {
  it("gives a Codex Thread a plain node_repl and a cua_repl bound to its host", async () => {
    const closeThread = vi.fn()
    const manager = new NodeReplHostManager({
      cua: { closeThread, handle: vi.fn() } as never,
      resolveCodexPath: () => "/usr/local/bin/codex",
      surfaces: () => ["iab", "computer"],
    })
    const { config, cuaReplConfig, pipePath } = await manager.ensureHostService(threadId)
    expect(config.env).toEqual({
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      NODE_REPL_NODE_PATH: process.execPath,
      NODE_REPL_SESSION_ID: threadId,
    })
    expect(cuaReplConfig).toMatchObject({
      command: process.execPath,
      enabled: true,
      enabled_tools: ["js", "js_reset", "turn_ended"],
      env: {
        CODEX_CLI_PATH: "/usr/local/bin/codex",
        CUA_REPL_ENABLED_SURFACES: "iab,computer",
        NODE_REPL_HOST_SERVICES_PIPE_PATH: pipePath,
      },
    })
    expect(manager.sessionEnvironment(threadId)).toEqual({
      CYPHERIA_CUA_HOST_PIPE: pipePath,
      CYPHERIA_CUA_SURFACES: "iab,computer",
    })
    await manager.closeHostService(threadId)
    expect(closeThread).toHaveBeenCalledWith(threadId)
  })

  it("disables cua_repl when no surface is enabled", async () => {
    const manager = new NodeReplHostManager({
      cua: { closeThread: vi.fn(), handle: vi.fn() } as never,
      surfaces: () => [],
    })
    const { cuaReplConfig } = await manager.ensureHostService(threadId)
    expect(cuaReplConfig.enabled).toBe(false)
    await manager.closeAll()
  })
})
