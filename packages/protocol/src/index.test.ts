import { describe, expect, it } from "vitest"

import {
  ClientMessageSchema,
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  parseServerMessageText,
  RuntimeMethodSchema,
  ServerMessageSchema,
  stringifyProtocolMessage,
} from "./index.js"

describe("Cypheria protocol", () => {
  it("accepts a versioned session hello", () => {
    expect(
      ClientMessageSchema.parse({
        type: "session.hello",
        requestId: "hello-1",
        payload: {
          capabilities: ["runtime.request"],
          client: { id: "client-1", kind: "expo" },
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        },
      })
    ).toMatchObject({ type: "session.hello" })
  })

  it("limits runtime requests to runtime-owned namespaces", () => {
    expect(RuntimeMethodSchema.safeParse("runtime.info").success).toBe(true)
    expect(RuntimeMethodSchema.safeParse("agent.create").success).toBe(false)
  })

  it("validates correlated server responses", () => {
    expect(
      ServerMessageSchema.safeParse({
        type: "runtime.response",
        requestId: "request-1",
        payload: { result: { ok: true } },
      }).success
    ).toBe(true)
  })

  it("builds the version and optional bearer subprotocols", () => {
    expect(createWebSocketProtocols()).toEqual(["cypheria.v1"])
    expect(createWebSocketProtocols("token_123")).toEqual([
      "cypheria.v1",
      "cypheria.bearer.token_123",
    ])
  })

  it("round-trips bigint values in Cypheria runtime payloads", () => {
    const message = {
      type: "runtime.response",
      requestId: "request-bigint",
      payload: { result: { value: 18_446_744_073_709_551_615n } },
    } as const

    const encoded = stringifyProtocolMessage(message)

    expect(JSON.parse(encoded)).toMatchObject({ $cypheria: "cypheria.superjson.v1" })
    expect(parseServerMessageText(encoded)).toEqual(message)
  })

  it("keeps ordinary protocol messages as plain JSON", () => {
    const message = {
      type: "runtime.response",
      requestId: "request-json",
      payload: { result: { ok: true } },
    } as const

    expect(JSON.parse(stringifyProtocolMessage(message))).toEqual(message)
  })
})
