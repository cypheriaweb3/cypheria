import { describe, expect, it } from "vitest"
import { TerminalCreateRequestSchema, TerminalInfoSchema } from "./terminal.ts"
import {
  decodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  encodeTerminalResizeFrame,
  encodeTerminalRestoreFrame,
  TERMINAL_MAX_FRAME_BYTES,
  TERMINAL_MAX_RESTORE_DATA_BYTES,
  TERMINAL_MAX_STREAM_DATA_BYTES,
} from "./terminal-binary.ts"

const threadId = "01995bc5-c4ee-7e9c-8d7f-5f112db567e9"

describe("terminal protocol", () => {
  it("applies conservative terminal dimensions", () => {
    expect(
      TerminalCreateRequestSchema.parse({
        payload: { threadId },
        requestId: "terminal-create",
        type: "terminal.create.request",
      }).payload
    ).toEqual({ size: { cols: 100, rows: 28 }, threadId })
  })

  it("requires thread-owned terminal metadata", () => {
    expect(
      TerminalInfoSchema.parse({
        cols: 100,
        createdAt: 1,
        cwd: "/workspace",
        name: "Terminal 1",
        rows: 28,
        terminalId: "01995bc5-c4ee-7e9c-8d7f-5f112db567e8",
        threadId,
        title: "zsh",
      }).threadId
    ).toBe(threadId)
  })

  it("round-trips resize and chunked restore frames", () => {
    expect(
      decodeTerminalBinaryFrame(encodeTerminalResizeFrame(7, { cols: 120, rows: 40 }, true))
    ).toEqual({ claim: true, cols: 120, rows: 40, slot: 7, type: "resize" })
    expect(
      decodeTerminalBinaryFrame(
        encodeTerminalRestoreFrame(3, new TextEncoder().encode("ready"), {
          end: true,
          start: true,
        })
      )
    ).toMatchObject({ end: true, slot: 3, start: true, type: "restore" })
  })

  it("rejects malformed resize frames", () => {
    expect(() =>
      decodeTerminalBinaryFrame({ opcode: 0x03, payload: new Uint8Array([0, 0, 1]) })
    ).toThrow("resize frame length")
  })

  it("enforces the 64 KiB limit including terminal frame headers", () => {
    const output = encodeTerminalOutputFrame(1, new Uint8Array(TERMINAL_MAX_STREAM_DATA_BYTES))
    const restore = encodeTerminalRestoreFrame(1, new Uint8Array(TERMINAL_MAX_RESTORE_DATA_BYTES), {
      end: true,
      start: true,
    })
    expect(output.payload.byteLength + 1).toBe(TERMINAL_MAX_FRAME_BYTES)
    expect(restore.payload.byteLength + 1).toBe(TERMINAL_MAX_FRAME_BYTES)
    expect(() =>
      encodeTerminalOutputFrame(1, new Uint8Array(TERMINAL_MAX_STREAM_DATA_BYTES + 1))
    ).toThrow("64 KiB")
    expect(() =>
      decodeTerminalBinaryFrame({
        opcode: 0x01,
        payload: new Uint8Array(TERMINAL_MAX_FRAME_BYTES),
      })
    ).toThrow("64 KiB")
  })

  it("rejects truncated frames and unknown flag bits", () => {
    expect(() => decodeTerminalBinaryFrame({ opcode: 0x01, payload: new Uint8Array() })).toThrow(
      "missing its slot"
    )
    expect(() =>
      decodeTerminalBinaryFrame({ opcode: 0x04, payload: new Uint8Array([0, 0x04]) })
    ).toThrow("restore flags")
  })
})
