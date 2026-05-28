import { describe, expect, it } from "vitest"

import {
  classifyCodexWireMessage,
  createCodexJsonlMessageBuffer,
  createCodexNotification,
  createCodexRequest,
  createCodexRequestIdGenerator,
  normalizeCodexJsonlLine,
  parseCodexJsonlLine,
  stringifyCodexWireMessage,
} from "./index.js"

describe("Codex wire messages", () => {
  it("classifies JSON-RPC requests, notifications, successes, and errors", () => {
    expect(classifyCodexWireMessage({ id: "1", jsonrpc: "2.0", method: "thread.create" })).toBe(
      "request"
    )
    expect(classifyCodexWireMessage({ jsonrpc: "2.0", method: "event" })).toBe("notification")
    expect(classifyCodexWireMessage({ id: 1, jsonrpc: "2.0", result: { ok: true } })).toBe(
      "success"
    )
    expect(
      classifyCodexWireMessage({
        error: { code: -32_000, message: "boom" },
        id: null,
        jsonrpc: "2.0",
      })
    ).toBe("error")
  })

  it("rejects invalid JSON-RPC lines without throwing", () => {
    expect(parseCodexJsonlLine("{ nope")).toMatchObject({ kind: "invalid" })
    expect(parseCodexJsonlLine('{"jsonrpc":"2.0","id":true,"method":"bad"}')).toMatchObject({
      kind: "invalid",
    })
  })

  it("buffers chunked JSONL input", () => {
    const buffer = createCodexJsonlMessageBuffer()

    expect(buffer.append('{"jsonrpc":"2.0","id":"a"')).toEqual([])
    const parsed = buffer.append(',"method":"thread.create"}\n{"jsonrpc":"2.0","method":"tick"}\n')

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ kind: "message", messageKind: "request" })
    expect(parsed[1]).toMatchObject({ kind: "message", messageKind: "notification" })
    expect(buffer.flush()).toBeUndefined()
  })

  it("normalizes parsed lines into transport events", () => {
    const parsed = parseCodexJsonlLine('{"jsonrpc":"2.0","id":"a","result":null}')
    const event = normalizeCodexJsonlLine(parsed, "2026-05-28T00:00:00.000Z")

    expect(event).toMatchObject({
      messageKind: "success",
      timestamp: "2026-05-28T00:00:00.000Z",
      type: "codex.message",
    })
  })

  it("creates outbound requests and notifications", () => {
    const nextId = createCodexRequestIdGenerator()
    const id = nextId()
    const request = createCodexRequest("thread.create", { cwd: "/tmp/project" }, id)
    const notification = createCodexNotification("client.ready")

    expect(request).toEqual({
      id: "cypheria_1",
      jsonrpc: "2.0",
      method: "thread.create",
      params: { cwd: "/tmp/project" },
    })
    expect(notification).toEqual({ jsonrpc: "2.0", method: "client.ready" })
    expect(stringifyCodexWireMessage(request)).toBe(
      '{"id":"cypheria_1","jsonrpc":"2.0","method":"thread.create","params":{"cwd":"/tmp/project"}}\n'
    )
  })
})
