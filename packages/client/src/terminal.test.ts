import {
  type CypheriaBinaryFrame,
  decodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  TERMINAL_MAX_STREAM_DATA_BYTES,
} from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { ServerClient } from "./server-client.js"
import { createTerminalActions } from "./terminal.js"

describe("terminal actions", () => {
  it("maps directory and lifecycle operations to the terminal protocol", async () => {
    const requestTerminal = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "terminal.list.request"
            ? { terminals: [] }
            : type === "terminal.create.request" || type === "terminal.rename.request"
              ? {
                  cols: 100,
                  createdAt: 1,
                  cwd: "/workspace",
                  name: "Terminal 1",
                  rows: 28,
                  terminalId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e8",
                  threadId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e9",
                  title: "zsh",
                }
              : type === "terminal.capture.request"
                ? { text: "ready" }
                : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const actions = createTerminalActions({ requestTerminal } as unknown as ServerClient)
    const threadId = "01995bc5-c4ee-7e9c-8d7f-5f112db567e9"

    await actions.list(threadId)
    await actions.create({ threadId })
    await actions.rename("terminal-1", "Build")
    await actions.capture("terminal-1", { start: -20 })
    await actions.close("terminal-1")

    expect(requestTerminal.mock.calls).toEqual([
      ["terminal.list.request", { threadId }, undefined],
      ["terminal.create.request", { size: { cols: 100, rows: 28 }, threadId }, undefined],
      ["terminal.rename.request", { name: "Build", terminalId: "terminal-1" }, undefined],
      ["terminal.capture.request", { start: -20, terminalId: "terminal-1" }, undefined],
      ["terminal.close.request", { terminalId: "terminal-1" }, undefined],
    ])
  })

  it("normalizes terminal errors", async () => {
    const requestTerminal = vi.fn(async () => ({
      payload: {
        error: { code: "TERMINAL_CLOSED", message: "Terminal is closed" },
        ok: false as const,
      },
      requestId: "test",
      type: "terminal.close.response" as const,
    }))
    const actions = createTerminalActions({ requestTerminal } as unknown as ServerClient)
    await expect(actions.close("terminal-1")).rejects.toMatchObject({
      message: "Terminal is closed",
      name: "TERMINAL_CLOSED",
    })
  })

  it("routes binary stream output and sends input and claimed resize frames", async () => {
    let binaryHandler: ((frame: ReturnType<typeof encodeTerminalOutputFrame>) => void) | undefined
    const requestTerminal = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "terminal.stream.subscribe.request"
            ? { slot: 7, subscriptionId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e7" }
            : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const sendBinaryFrame = vi.fn(async (_frame: CypheriaBinaryFrame) => undefined)
    const client = {
      on: vi.fn(() => () => undefined),
      requestTerminal,
      sendBinaryFrame,
      subscribeBinaryFrames: vi.fn((handler) => {
        binaryHandler = handler
        return () => undefined
      }),
      subscribeConnectionStatus: vi.fn((handler) => {
        handler({ status: "connected" })
        return () => undefined
      }),
    } as unknown as ServerClient
    const output = vi.fn()
    const stream = await createTerminalActions(client).observe(
      "01995bc5-c4ee-7e9c-8d7f-5f112db567e8",
      { onOutput: output }
    )

    binaryHandler?.(encodeTerminalOutputFrame(7, new TextEncoder().encode("ready")))
    expect(new TextDecoder().decode(output.mock.calls[0]?.[0])).toBe("ready")
    await stream.resize({ cols: 120, rows: 40 }, { claim: true })
    await stream.write("pwd\n")
    expect(sendBinaryFrame.mock.calls.map(([frame]) => decodeTerminalBinaryFrame(frame))).toEqual([
      { claim: true, cols: 120, rows: 40, slot: 7, type: "resize" },
      expect.objectContaining({ slot: 7, type: "input" }),
    ])
    await stream.dispose()
    expect(requestTerminal).toHaveBeenLastCalledWith(
      "terminal.stream.unsubscribe.request",
      { subscriptionId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e7" },
      undefined
    )
  })

  it("splits oversized UTF-8 input without breaking code points", async () => {
    const requestTerminal = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "terminal.stream.subscribe.request"
            ? { slot: 9, subscriptionId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e7" }
            : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const sent: CypheriaBinaryFrame[] = []
    const client = {
      on: vi.fn(() => () => undefined),
      requestTerminal,
      sendBinaryFrame: vi.fn(async (frame: CypheriaBinaryFrame) => {
        sent.push(frame)
      }),
      subscribeBinaryFrames: vi.fn(() => () => undefined),
      subscribeConnectionStatus: vi.fn(() => () => undefined),
    } as unknown as ServerClient
    const stream = await createTerminalActions(client).observe(
      "01995bc5-c4ee-7e9c-8d7f-5f112db567e8",
      { onOutput: vi.fn() }
    )
    const input = `${"a".repeat(TERMINAL_MAX_STREAM_DATA_BYTES - 1)}😀tail`

    await stream.write(input)

    const chunks = sent.map((frame) => {
      const decoded = decodeTerminalBinaryFrame(frame)
      if (decoded?.type !== "input") throw new Error("Expected input frame")
      expect(decoded.data.byteLength).toBeLessThanOrEqual(TERMINAL_MAX_STREAM_DATA_BYTES)
      return new TextDecoder("utf-8", { fatal: true }).decode(decoded.data)
    })
    expect(chunks.length).toBe(2)
    expect(chunks.join("")).toBe(input)
  })
})
