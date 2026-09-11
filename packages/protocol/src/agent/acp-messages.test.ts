import type {
  ClientRequest as SdkV1ClientRequest,
  AnyMessage as SdkV1Message,
} from "@agentclientprotocol/sdk"
import type { AnyWireMessage as SdkV2WireMessage } from "@agentclientprotocol/sdk/experimental/v2"
import { describe, expect, expectTypeOf, it } from "vitest"
import type { z } from "zod"

import {
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
  type AcpV1ClientMessage,
  type AcpV1ClientRequest,
  type AcpV1ClientRequestSchema,
  type AcpV1WireMessage,
  AcpV1WireMessageSchema,
  type AcpV2WireMessage,
  AcpV2WireMessageSchema,
  type AcpWirePayload,
  ClientMessageSchema,
  ServerMessageSchema,
} from "../index.js"

describe("agent.acp protocol", () => {
  it("uses the protocol versions and wire types from the official SDK", () => {
    type V1Payload = Extract<AcpWirePayload, { protocolVersion: 1 }>
    type V2Payload = Extract<AcpWirePayload, { protocolVersion: 2 }>

    expect(ACP_V1_PROTOCOL_VERSION).toBe(1)
    expect(ACP_V2_PROTOCOL_VERSION).toBe(2)
    expectTypeOf<AcpV1WireMessage>().toEqualTypeOf<SdkV1Message>()
    expectTypeOf<AcpV2WireMessage>().toEqualTypeOf<SdkV2WireMessage>()
    expectTypeOf<AcpV1ClientMessage>().toMatchTypeOf<SdkV1Message>()
    expectTypeOf<AcpV1ClientRequest>().toEqualTypeOf<SdkV1ClientRequest & { jsonrpc: "2.0" }>()
    expectTypeOf<z.infer<typeof AcpV1ClientRequestSchema>>().toEqualTypeOf<AcpV1ClientRequest>()
    expectTypeOf<V1Payload["message"]>().toEqualTypeOf<SdkV1Message>()
    expectTypeOf<V2Payload["message"]>().toEqualTypeOf<SdkV2WireMessage>()
  })

  it("wraps ACP v1 client traffic in the live client message union", () => {
    const message = {
      jsonrpc: "2.0",
      id: "initialize-1",
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      },
    } as const

    expect(
      ClientMessageSchema.parse({
        type: "agent.acp.client.message",
        payload: { protocolVersion: 1, message },
      })
    ).toEqual({
      type: "agent.acp.client.message",
      payload: { protocolVersion: 1, message },
    })
  })

  it("wraps ACP responses and notifications in the live server message union", () => {
    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: "initialize-1",
            result: { protocolVersion: 1, agentCapabilities: {} },
          },
        },
      }).success
    ).toBe(true)

    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "hello" },
              },
            },
          },
        },
      }).success
    ).toBe(true)
  })

  it("accepts v2 batches while keeping v1 single-message only", () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/workspace" } },
      { jsonrpc: "2.0", method: "_cypheria/test", params: { uri: "file:///workspace" } },
    ] as const

    expect(AcpV2WireMessageSchema.safeParse(batch).success).toBe(true)
    expect(AcpV1WireMessageSchema.safeParse(batch).success).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        type: "agent.acp.client.message",
        payload: { protocolVersion: 2, message: batch },
      }).success
    ).toBe(true)
  })

  it("preserves JSON extension fields inside ACP messages", () => {
    const wrapped = {
      type: "agent.acp.client.message",
      payload: {
        protocolVersion: 2,
        message: {
          jsonrpc: "2.0",
          method: "_cypheria/test",
          params: { uri: "file:///workspace" },
          providerExtension: { enabled: true },
        },
      },
    } as const

    expect(ClientMessageSchema.parse(wrapped)).toEqual(wrapped)
  })

  it("rejects empty and mixed v2 batches", () => {
    expect(AcpV2WireMessageSchema.safeParse([]).success).toBe(false)
    expect(
      AcpV2WireMessageSchema.safeParse([
        { jsonrpc: "2.0", id: 1, method: "session/new" },
        { jsonrpc: "2.0", id: 1, result: {} },
      ]).success
    ).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        type: "agent.acp.client.message",
        payload: {
          protocolVersion: 2,
          message: [
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: 2 },
            },
            { jsonrpc: "2.0", method: "_cypheria/test" },
          ],
        },
      }).success
    ).toBe(false)
  })

  it("rejects malformed or non-JSON ACP messages", () => {
    expect(
      AcpV1WireMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        result: {},
        error: { code: -32_603, message: "Internal error" },
      }).success
    ).toBe(false)
    expect(
      AcpV1WireMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        result: {},
      }).success
    ).toBe(false)
    expect(
      AcpV1WireMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: Number.POSITIVE_INFINITY,
        method: "initialize",
      }).success
    ).toBe(false)
    expect(
      AcpV1WireMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { value: 1n },
      }).success
    ).toBe(false)
  })

  it("uses the SDK method-specific Zod validators and direction contracts", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "agent.acp.client.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "1" },
          },
        },
      }).success
    ).toBe(false)

    expect(
      ClientMessageSchema.safeParse({
        type: "agent.acp.client.message",
        payload: {
          protocolVersion: 2,
          message: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
          },
        },
      }).success
    ).toBe(false)

    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
          },
        },
      }).success
    ).toBe(false)

    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: 2,
            method: "fs/read_text_file",
            params: { sessionId: "session-1", path: "/workspace/README.md" },
          },
        },
      }).success
    ).toBe(true)

    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: 3,
            method: "fs/read_text_file",
            params: { sessionId: "session-1" },
          },
        },
      }).success
    ).toBe(false)

    expect(
      ServerMessageSchema.safeParse({
        type: "agent.acp.server.message",
        payload: {
          protocolVersion: 1,
          message: {
            jsonrpc: "2.0",
            id: 4,
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "hello" },
              },
            },
          },
        },
      }).success
    ).toBe(false)
  })
})
