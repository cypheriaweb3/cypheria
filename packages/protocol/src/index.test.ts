import { describe, expect, it } from "vitest"

import {
  ClientMessageSchema,
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  isClientResponseMessage,
  PersistedServerConfigPatchSchema,
  parseServerMessageText,
  RuntimeMethodSchema,
  SERVER_CAPABILITIES,
  ServerMessageSchema,
  stringifyProtocolMessage,
} from "./index.js"

describe("Cypheria protocol", () => {
  it("keeps stable capability names aligned with the server handshake", () => {
    expect(SERVER_CAPABILITIES.diagnostics).toBe("diagnostics")
  })

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

  it("validates session resume and bounded server config patches", () => {
    expect(
      ClientMessageSchema.safeParse({
        payload: {
          capabilities: [],
          client: { id: "client-1", kind: "expo" },
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          resumeSessionId: "ses_previous",
        },
        requestId: "hello-resume",
        type: "session.hello",
      }).success
    ).toBe(true)
    expect(
      PersistedServerConfigPatchSchema.safeParse({
        server: { sessions: { reconnectGraceMs: 30_000 } },
      }).success
    ).toBe(true)
    expect(
      PersistedServerConfigPatchSchema.safeParse({
        server: { sessions: { reconnectGraceMs: 600_000 } },
      }).success
    ).toBe(false)
  })

  it("limits runtime requests to runtime-owned namespaces", () => {
    expect(RuntimeMethodSchema.safeParse("runtime.info").success).toBe(true)
    expect(RuntimeMethodSchema.safeParse("agent.create").success).toBe(false)
  })

  it("strips unknown fields from Cypheria-owned envelopes", () => {
    expect(
      ClientMessageSchema.parse({
        type: "session.goodbye",
        requestId: "goodbye-1",
        unexpected: true,
      })
    ).toEqual({ type: "session.goodbye", requestId: "goodbye-1" })
    expect(
      ClientMessageSchema.parse({
        type: "session.hello",
        requestId: "hello-1",
        payload: {
          capabilities: [],
          client: { id: "client-1", kind: "expo" },
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          unexpected: true,
        },
      })
    ).toEqual({
      type: "session.hello",
      requestId: "hello-1",
      payload: {
        capabilities: [],
        client: { id: "client-1", kind: "expo" },
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
      },
    })
  })

  it("preserves optional feature flags and accepts future server error codes", () => {
    const ready = ServerMessageSchema.parse({
      type: "session.ready",
      requestId: "hello-1",
      payload: {
        capabilities: [],
        features: { futureFeature: true },
        server: {
          hostname: "test",
          id: "server-1",
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          startedAt: "2026-09-12T00:00:00.000Z",
          version: "0.0.0",
        },
        sessionId: "session-1",
      },
    })
    if (ready.type !== "session.ready") throw new Error("Expected session ready")
    expect(ready.payload.features).toEqual({ futureFeature: true })

    expect(
      ServerMessageSchema.safeParse({
        type: "server.error",
        requestId: "request-1",
        payload: { code: "FUTURE_ERROR_CODE", message: "new diagnostic" },
      }).success
    ).toBe(true)
  })

  it("defines terminal client RPC errors and classifies only actual responses", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "client.error",
        requestId: "reverse-1",
        payload: {
          code: "REQUEST_NOT_SUPPORTED",
          message: "No handler",
          requestType: "agent.codex.current_time.read.request",
        },
      }).success
    ).toBe(true)

    const reverseRequest = ServerMessageSchema.parse({
      type: "agent.codex.current_time.read.request",
      requestId: "colliding-id",
      threadId: "thread-1",
    })
    const response = ServerMessageSchema.parse({
      type: "runtime.response",
      requestId: "request-1",
      payload: { result: null },
    })
    expect(isClientResponseMessage(reverseRequest)).toBe(false)
    expect(isClientResponseMessage(response)).toBe(true)
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
