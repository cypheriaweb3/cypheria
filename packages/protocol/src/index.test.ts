import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  ClientMessageSchema,
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  isClientResponseMessage,
  PersistedServerConfigPatchSchema,
  parseWSInboundMessageText,
  parseWSOutboundMessageText,
  RuntimeMethodSchema,
  SERVER_CAPABILITIES,
  ServerMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  stringifyProtocolMessage,
  ThreadCreateRequestSchema,
  WSInboundMessageSchema,
  WSOutboundMessageSchema,
  wrapClientSessionMessage,
  wrapServerSessionMessage,
} from "./index.js"

describe("Cypheria protocol", () => {
  it("keeps stable capability names aligned with the server handshake", () => {
    expect(SERVER_CAPABILITIES.diagnostics).toBe("diagnostics")
  })

  it("accepts Paseo-aligned client roles and app versions in the top-level hello", () => {
    for (const clientType of ["desktop", "mobile", "web", "cli", "mcp", "hub"] as const) {
      expect(
        WSInboundMessageSchema.parse({
          appVersion: "",
          capabilities: { futureFeature: true },
          clientId: `client-${clientType}`,
          clientType,
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          type: "hello",
        })
      ).toMatchObject({ appVersion: "", clientType, type: "hello" })
    }
  })

  it("wraps logical session messages and validates bounded server config patches", () => {
    expect(
      WSInboundMessageSchema.safeParse(
        wrapClientSessionMessage({ requestId: "status-1", type: "server.status.request" })
      ).success
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

  it("dispatches every logical session wire type from a flat discriminator", () => {
    expect(SessionInboundMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(SessionOutboundMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect((SessionInboundMessageSchema as z.ZodDiscriminatedUnion).options).toHaveLength(135)
    expect((SessionOutboundMessageSchema as z.ZodDiscriminatedUnion).options).toHaveLength(154)
  })

  it("validates Thread UUIDv7 inputs without exposing agent-session binding", () => {
    const message = ThreadCreateRequestSchema.parse({
      payload: {
        agentId: "codex",
        agentSessionId: "reserved-for-later",
        forkedFromId: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
        recencyAt: 1_800_000_000,
      },
      requestId: "projectThread-1",
      type: "thread.create.request",
    })

    expect(message.payload).not.toHaveProperty("agentSessionId")
    expect(
      ThreadCreateRequestSchema.safeParse({
        payload: { agentId: "codex", forkedFromId: "not-a-uuid" },
        requestId: "projectThread-2",
        type: "thread.create.request",
      }).success
    ).toBe(false)
  })

  it("limits runtime requests to runtime-owned namespaces", () => {
    expect(RuntimeMethodSchema.safeParse("runtime.info").success).toBe(true)
    expect(RuntimeMethodSchema.safeParse("agent.create").success).toBe(false)
  })

  it("normalizes WebSocket envelopes and session payloads", () => {
    expect(
      WSInboundMessageSchema.parse({
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        type: "hello",
        unexpected: true,
      })
    ).toEqual({
      clientId: "client-1",
      clientType: "mobile",
      protocolVersion: CYPHERIA_PROTOCOL_VERSION,
      type: "hello",
    })
    expect(
      ClientMessageSchema.parse({
        requestId: "status-1",
        type: "server.status.request",
        unexpected: true,
      })
    ).toEqual({ requestId: "status-1", type: "server.status.request" })
  })

  it("accepts open feature names on logical session messages", () => {
    const status = ServerMessageSchema.parse({
      payload: {
        capabilities: [],
        connections: 1,
        features: { futureFeature: true },
        hostname: "test",
        id: "srv_test",
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        runtimeState: "ready",
        startedAt: "2026-01-01T00:00:00.000Z",
        version: "0.0.0",
        webApp: { enabled: false },
      },
      type: "server.status.notification",
    })
    if (status.type !== "server.status.notification") throw new Error("Expected server status")
    expect(status.payload.features).toEqual({ futureFeature: true })
  })

  it("distinguishes responses and excludes provider-native RPCs from the public wire", () => {
    const response = ServerMessageSchema.parse({
      payload: {
        capabilities: [],
        connections: 1,
        hostname: "test",
        id: "srv_test",
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        runtimeState: "ready",
        startedAt: "2026-01-01T00:00:00.000Z",
        version: "0.0.0",
        webApp: { enabled: false },
      },
      requestId: "same-id",
      type: "server.status.response",
    })
    expect(isClientResponseMessage(response)).toBe(true)
    expect(
      ServerMessageSchema.safeParse({
        requestId: "same-id",
        threadId: "thread-1",
        type: "agent.codex.current_time.read.request",
      }).success
    ).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        requestId: "same-id",
        type: "agent.acp.initialize.request",
      }).success
    ).toBe(false)
  })

  it("builds the versioned WebSocket subprotocol list", () => {
    expect(createWebSocketProtocols()).toEqual(["cypheria.v2"])
    expect(createWebSocketProtocols("token_123")).toEqual([
      "cypheria.v2",
      "cypheria.bearer.token_123",
    ])
  })

  it("round-trips top-level ping and session envelopes", () => {
    expect(parseWSInboundMessageText(stringifyProtocolMessage({ type: "ping" }))).toEqual({
      type: "ping",
    })
    const envelope = wrapServerSessionMessage({
      payload: {
        capabilities: [],
        connections: 1,
        hostname: "test",
        id: "srv_test",
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        runtimeState: "ready",
        startedAt: "2026-01-01T00:00:00.000Z",
        version: "0.0.0",
        webApp: { enabled: false },
      },
      type: "server.status.notification",
    })
    expect(WSOutboundMessageSchema.parse(envelope)).toEqual(envelope)
    expect(parseWSOutboundMessageText(stringifyProtocolMessage(envelope))).toEqual(envelope)
  })
})
