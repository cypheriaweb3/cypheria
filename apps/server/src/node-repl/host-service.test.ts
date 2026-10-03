import { createConnection } from "node:net"
import { createInterface } from "node:readline"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BrowserToolsService } from "../browser-tools/service.js"
import { NodeReplHostManager } from "./host-manager.js"
import { NodeReplHostService } from "./host-service.js"

describe("NodeReplHostService", () => {
  let mockBrowserTools: BrowserToolsService
  let service: NodeReplHostService
  let pipePath: string

  beforeEach(async () => {
    mockBrowserTools = {
      execute: vi.fn(
        async (input: { command: { command: string; args?: Record<string, unknown> } }) => {
          switch (input.command.command) {
            case "new_tab":
              return {
                ok: true,
                result: {
                  browserId: "b-tab-123",
                  command: "new_tab",
                  kind: "web",
                  threadId: "test-thread",
                  url: "about:blank",
                },
              }
            case "list_tabs":
              return {
                ok: true,
                result: {
                  command: "list_tabs",
                  tabs: [
                    {
                      browserId: "b-tab-123",
                      isActive: true,
                      isLoading: false,
                      kind: "web",
                      threadId: "test-thread",
                      title: "Test Page",
                      url: "http://localhost:3000",
                    },
                  ],
                },
              }
            case "screenshot":
              return {
                ok: true,
                result: {
                  command: "screenshot",
                  dataBase64:
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                  height: 1,
                  mimeType: "image/png",
                  width: 1,
                },
              }
            case "evaluate":
              return {
                ok: true,
                result: {
                  command: "evaluate",
                  resultJson: JSON.stringify({ hello: "world" }),
                  truncated: false,
                },
              }
            default:
              return {
                ok: true,
                result: { command: input.command.command },
              }
          }
        }
      ),
    } as unknown as BrowserToolsService

    service = new NodeReplHostService({
      browserTools: mockBrowserTools,
      threadId: "test-thread-1",
    })
    pipePath = await service.start()
  })

  afterEach(async () => {
    await service.close()
  })

  const sendRpc = async (socket: ReturnType<typeof createConnection>, msg: unknown) => {
    return new Promise<Record<string, unknown>>((resolve) => {
      const rl = createInterface({ input: socket })
      rl.once("line", (line) => {
        resolve(JSON.parse(line))
      })
      socket.write(`${JSON.stringify(msg)}\n`)
    })
  }

  it("handles ensureService", async () => {
    const socket = createConnection(pipePath)
    await new Promise<void>((resolve) => socket.once("connect", resolve))

    const response = await sendRpc(socket, {
      id: 1,
      jsonrpc: "2.0",
      method: "ensureService",
    })

    expect(response).toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: { ok: true },
    })

    socket.destroy()
  })

  it("handles browser setup", async () => {
    const socket = createConnection(pipePath)
    await new Promise<void>((resolve) => socket.once("connect", resolve))

    const response = await sendRpc(socket, {
      id: 2,
      jsonrpc: "2.0",
      method: "browser",
      params: { method: "setup", params: {} },
    })

    expect(response.id).toBe(2)
    const result = response.result as Record<string, unknown>
    expect(result.apiManifest).toBeDefined()
    expect(result.disabledMemberIds).toBeInstanceOf(Array)
    expect(result.credentialRecoveryErrorVersion).toBe(1)

    socket.destroy()
  })

  it("handles browser create_tab, list_tabs, and evaluate", async () => {
    const socket = createConnection(pipePath)
    await new Promise<void>((resolve) => socket.once("connect", resolve))

    // create_tab
    const createResp = await sendRpc(socket, {
      id: 3,
      jsonrpc: "2.0",
      method: "browser",
      params: { method: "execute", params: { command: "create_tab" } },
    })
    expect(createResp).toEqual({
      id: 3,
      jsonrpc: "2.0",
      result: {
        browser_id: "iab",
        id: "b-tab-123",
        title: "",
        url: "about:blank",
      },
    })

    // list_tabs
    const listResp = await sendRpc(socket, {
      id: 4,
      jsonrpc: "2.0",
      method: "browser",
      params: { method: "execute", params: { command: "list_tabs" } },
    })
    expect(listResp).toEqual({
      id: 4,
      jsonrpc: "2.0",
      result: {
        tabs: [
          {
            browser_id: "iab",
            id: "b-tab-123",
            title: "Test Page",
            url: "http://localhost:3000",
          },
        ],
      },
    })

    // evaluate
    const evalResp = await sendRpc(socket, {
      id: 5,
      jsonrpc: "2.0",
      method: "browser",
      params: {
        method: "execute",
        params: {
          browserId: "b-tab-123",
          command: "playwright_evaluate",
          expression: "() => ({ hello: 'world' })",
        },
      },
    })
    expect(evalResp).toEqual({
      id: 5,
      jsonrpc: "2.0",
      result: { value: { hello: "world" } },
    })

    socket.destroy()
  })

  it("returns -32601 placeholder errors for chrome and sky services", async () => {
    const socket = createConnection(pipePath)
    await new Promise<void>((resolve) => socket.once("connect", resolve))

    const chromeResp = await sendRpc(socket, {
      id: 10,
      jsonrpc: "2.0",
      method: "chrome",
    })
    expect(chromeResp).toMatchObject({
      error: {
        code: -32601,
        message: expect.stringContaining("Chrome extension"),
      },
      id: 10,
    })

    const skyResp = await sendRpc(socket, {
      id: 11,
      jsonrpc: "2.0",
      method: "sky",
    })
    expect(skyResp).toMatchObject({
      error: {
        code: -32601,
        message: expect.stringContaining("Computer use"),
      },
      id: 11,
    })

    socket.destroy()
  })
})

describe("NodeReplHostManager", () => {
  it("creates and manages host services and returns node_repl config", async () => {
    const mockBrowserTools = {
      execute: vi.fn(),
    } as unknown as BrowserToolsService

    const manager = new NodeReplHostManager({
      browserTools: mockBrowserTools,
      resolveCodexPath: () => "/usr/local/bin/codex",
    })

    const { config, pipePath } = await manager.ensureHostService("thread-abc")
    expect(pipePath).toContain("thread-abc")
    expect(config.command).toBeDefined()
    expect(config.env.CODEX_CLI_PATH).toBe("/usr/local/bin/codex")
    expect(config.env.NODE_REPL_NODE_PATH).toBe(process.execPath)
    expect(config.env.NODE_REPL_HOST_SERVICES_PIPE_PATH).toBe(pipePath)
    expect(config.env.NODE_REPL_TRUSTED_RPC_ENABLED).toBe("1")

    await manager.closeAll()
  })
})
