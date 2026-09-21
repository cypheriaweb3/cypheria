import type { AnyMessage as SdkV1Message } from "@agentclientprotocol/sdk"
import type { AnyWireMessage as SdkV2WireMessage } from "@agentclientprotocol/sdk/experimental/v2"
import { describe, expect, expectTypeOf, it } from "vitest"
import { z } from "zod"

import {
  ClientMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "../index.js"
import {
  ACP_PREFERRED_PROTOCOL_VERSION,
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
  type AcpV1WireMessage,
  type AcpV2WireMessage,
  AgentAcpClientMessageSchema,
  AgentAcpServerMessageSchema,
  AgentAcpV2ClientBatchMessagesSchema,
  AgentAcpV2ClientSingleMessageSchema,
  AgentAcpV2ServerBatchMessagesSchema,
  isAgentAcpServerMessage,
  parseAcpNegotiatedInitializeResult,
} from "./acp.js"

describe("agent.acp protocol", () => {
  it("uses the official SDK versions and raw stream types", () => {
    expect(ACP_V1_PROTOCOL_VERSION).toBe(1)
    expect(ACP_V2_PROTOCOL_VERSION).toBe(2)
    expect(ACP_PREFERRED_PROTOCOL_VERSION).toBe(2)
    expectTypeOf<AcpV1WireMessage>().toEqualTypeOf<SdkV1Message>()
    expectTypeOf<AcpV2WireMessage>().toEqualTypeOf<SdkV2WireMessage>()
  })

  it("keeps concrete ACP schemas internal to the server adapters", () => {
    expect(SessionInboundMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(SessionOutboundMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(AgentAcpClientMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(AgentAcpServerMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(AgentAcpV2ClientSingleMessageSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)

    expect(
      AgentAcpClientMessageSchema.parse({
        agent: "gemini",
        payload: { clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } },
        protocolVersion: 1,
        requestId: "initialize-1",
        type: "agent.acp.initialize.request",
      })
    ).toMatchObject({ protocolVersion: 1, type: "agent.acp.initialize.request" })
    expect(
      ClientMessageSchema.safeParse({
        agent: "gemini",
        payload: { clientCapabilities: {} },
        protocolVersion: 1,
        requestId: "initialize-1",
        type: "agent.acp.initialize.request",
      }).success
    ).toBe(false)
  })

  it("pairs method-specific responses by type", () => {
    const response = {
      agent: "gemini",
      payload: {
        requestId: "initialize-1",
        result: { agentCapabilities: {}, protocolVersion: 1 },
      },
      protocolVersion: 1,
      type: "agent.acp.initialize.response",
    } as const

    expect(AgentAcpServerMessageSchema.parse(response)).toMatchObject(response)
    expect(
      AgentAcpServerMessageSchema.safeParse({
        ...response,
        payload: {
          ...response.payload,
          error: { code: -32_603, message: "Internal error" },
        },
      }).success
    ).toBe(false)
  })

  it("uses special extension message types with the open method nested in payload", () => {
    const request = {
      agent: "gemini",
      payload: { method: "_cypheria/test", params: { value: 7 } },
      protocolVersion: 1,
      requestId: 0,
      type: "agent.acp.extension.request",
    } as const
    expect(AgentAcpClientMessageSchema.parse(request)).toEqual(request)

    expect(
      AgentAcpClientMessageSchema.safeParse({
        ...request,
        payload: { method: "initialize", params: {} },
      }).success
    ).toBe(false)
  })

  it("nests a second discriminated union inside the v2 batch message", () => {
    const messagesSchema = AgentAcpV2ClientBatchMessagesSchema.shape.payload.shape.messages.element
    expect(messagesSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)

    const batch = {
      payload: {
        messages: [
          {
            agent: "gemini",
            payload: { method: "_cypheria/first", params: { value: 1 } },
            protocolVersion: 2,
            type: "agent.acp.extension.notification",
          },
          {
            agent: "gemini",
            payload: { method: "_cypheria/second", params: { value: 2 } },
            protocolVersion: 2,
            type: "agent.acp.extension.notification",
          },
        ],
      },
      agent: "gemini",
      protocolVersion: 2,
      type: "agent.acp.batch",
    } as const
    expect(AgentAcpClientMessageSchema.parse(batch)).toEqual(batch)
  })

  it("rejects empty, mixed, and multi-entry initialize batches", () => {
    expect(
      AgentAcpV2ClientBatchMessagesSchema.safeParse({
        agent: "gemini",
        payload: { messages: [] },
        protocolVersion: 2,
        type: "agent.acp.batch",
      }).success
    ).toBe(false)
    expect(
      AgentAcpV2ClientBatchMessagesSchema.safeParse({
        payload: {
          messages: [
            {
              agent: "gemini",
              payload: { method: "_cypheria/call", params: {} },
              protocolVersion: 2,
              requestId: 1,
              type: "agent.acp.extension.request",
            },
            {
              agent: "gemini",
              payload: { requestId: 2, result: {} },
              protocolVersion: 2,
              type: "agent.acp.extension.response",
            },
          ],
        },
        agent: "gemini",
        protocolVersion: 2,
        type: "agent.acp.batch",
      }).success
    ).toBe(false)
    expect(
      AgentAcpV2ClientBatchMessagesSchema.safeParse({
        payload: {
          messages: [
            {
              agent: "gemini",
              payload: { info: { name: "cypheria", version: "0.0.0" } },
              protocolVersion: 2,
              requestId: 1,
              type: "agent.acp.initialize.request",
            },
            {
              agent: "gemini",
              payload: { method: "_cypheria/event" },
              protocolVersion: 2,
              type: "agent.acp.extension.notification",
            },
          ],
        },
        agent: "gemini",
        protocolVersion: 2,
        type: "agent.acp.batch",
      }).success
    ).toBe(false)
  })

  it("enforces method-specific params and sender direction", () => {
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        payload: {},
        protocolVersion: "1",
        requestId: 1,
        type: "agent.acp.initialize.request",
      }).success
    ).toBe(false)
    expect(
      AgentAcpServerMessageSchema.safeParse({
        agent: "gemini",
        payload: {},
        protocolVersion: 1,
        requestId: 1,
        type: "agent.acp.initialize.request",
      }).success
    ).toBe(false)
    expect(
      AgentAcpServerMessageSchema.safeParse({
        agent: "gemini",
        payload: { path: "/workspace/README.md", sessionId: "session-1" },
        requestId: 2,
        protocolVersion: 1,
        type: "agent.acp.fs.read_text_file.request",
      }).success
    ).toBe(true)
  })

  it("returns the normalized output of the official params and result schemas", () => {
    const request = AgentAcpClientMessageSchema.parse({
      agent: "gemini",
      payload: {
        clientCapabilities: {
          fs: { readTextFile: "invalid", writeTextFile: "invalid" },
        },
      },
      protocolVersion: 1,
      requestId: "initialize-1",
      type: "agent.acp.initialize.request",
    })
    expect(request).toMatchObject({
      payload: {
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
    })

    const response = AgentAcpServerMessageSchema.parse({
      agent: "gemini",
      payload: {
        requestId: "initialize-1",
        result: { agentCapabilities: {}, protocolVersion: 1 },
      },
      protocolVersion: 1,
      type: "agent.acp.initialize.response",
    })
    expect(response).toMatchObject({
      payload: {
        result: {
          agentCapabilities: {
            auth: {},
            loadSession: false,
            mcpCapabilities: { acp: false, http: false, sse: false },
            promptCapabilities: { audio: false, embeddedContext: false, image: false },
            sessionCapabilities: {},
          },
          authMethods: [],
        },
      },
    })
  })

  it("preserves the v2 configuration value discriminator in the request payload", () => {
    expect(
      AgentAcpClientMessageSchema.parse({
        agent: "gemini",
        payload: {
          configId: "model",
          sessionId: "session-1",
          type: "id",
          value: "provider/model",
        },
        protocolVersion: 2,
        requestId: "config-1",
        type: "agent.acp.session.set_config_option.request",
      })
    ).toMatchObject({
      payload: { configId: "model", type: "id", value: "provider/model" },
      type: "agent.acp.session.set_config_option.request",
    })
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        configId: "model",
        protocolVersion: 2,
        requestId: "config-1",
        sessionId: "session-1",
        type: "agent.acp.session.set_config_option.request",
        value: "provider/model",
      }).success
    ).toBe(false)
  })

  it("requires an initialize response to be the only server batch entry", () => {
    expect(
      AgentAcpV2ServerBatchMessagesSchema.safeParse({
        payload: {
          messages: [
            {
              agent: "gemini",
              payload: {
                requestId: 1,
                result: {
                  capabilities: {},
                  info: { name: "agent", version: "1.0.0" },
                  protocolVersion: 2,
                },
              },
              protocolVersion: 2,
              type: "agent.acp.initialize.response",
            },
            {
              agent: "gemini",
              payload: { requestId: 2, result: {} },
              protocolVersion: 2,
              type: "agent.acp.extension.response",
            },
          ],
        },
        agent: "gemini",
        protocolVersion: 2,
        type: "agent.acp.batch",
      }).success
    ).toBe(false)
  })

  it("requires underscore-prefixed extension methods without rewriting them", () => {
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        payload: { method: "vendor/test" },
        protocolVersion: 1,
        requestId: 1,
        type: "agent.acp.extension.request",
      }).success
    ).toBe(false)
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        payload: { method: "  _vendor/test" },
        protocolVersion: 1,
        requestId: 1,
        type: "agent.acp.extension.request",
      }).success
    ).toBe(false)
  })

  it("requires cancellation to identify the request", () => {
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        protocolVersion: 1,
        type: "agent.acp.cancel_request.notification",
      }).success
    ).toBe(false)
    expect(
      AgentAcpClientMessageSchema.safeParse({
        agent: "gemini",
        payload: { requestId: "request-1" },
        protocolVersion: 1,
        type: "agent.acp.cancel_request.notification",
      }).success
    ).toBe(true)
  })

  it("does not narrow a client batch to a server message", () => {
    expect(
      isAgentAcpServerMessage({
        payload: {
          messages: [
            {
              agent: "gemini",
              payload: { capabilities: {}, info: { name: "client", version: "1.0.0" } },
              protocolVersion: 2,
              requestId: 1,
              type: "agent.acp.initialize.request",
            },
          ],
        },
        agent: "gemini",
        protocolVersion: 2,
        type: "agent.acp.batch",
      })
    ).toBe(false)
  })

  it("negotiates initialize responses from the returned ACP protocol version", () => {
    expect(
      parseAcpNegotiatedInitializeResult({
        capabilities: {},
        info: { name: "agent", version: "1.0.0" },
        protocolVersion: 2,
      })
    ).toMatchObject({ protocolVersion: 2, result: { protocolVersion: 2 } })
    expect(
      parseAcpNegotiatedInitializeResult({ agentCapabilities: {}, protocolVersion: 1 })
    ).toMatchObject({ protocolVersion: 1, result: { protocolVersion: 1 } })
    expect(() =>
      parseAcpNegotiatedInitializeResult({ capabilities: {}, protocolVersion: 3 })
    ).toThrow(/Unsupported ACP protocol version/)
  })
})
