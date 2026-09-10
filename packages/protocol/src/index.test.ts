import { describe, expect, it } from "vitest"

import {
  ClientMessageSchema,
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  RuntimeMethodSchema,
  ServerMessageSchema,
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
})
