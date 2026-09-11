import { describe, expect, expectTypeOf, it } from "vitest"
import type { z } from "zod"

import {
  AGENT_CODEX_CLIENT_NOTIFICATION_MESSAGE_SCHEMAS,
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_REQUEST_MESSAGE_SCHEMAS,
  AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD,
  AGENT_CODEX_CLIENT_REQUEST_TYPES,
  AGENT_CODEX_CLIENT_RESPONSE_MESSAGE_SCHEMAS,
  AGENT_CODEX_CLIENT_RESPONSE_TYPES,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATION_MESSAGE_SCHEMAS,
  AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  AGENT_CODEX_SERVER_NOTIFICATION_TYPES,
  AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_REQUEST_MESSAGE_SCHEMAS,
  AGENT_CODEX_SERVER_REQUEST_TYPES,
  AGENT_CODEX_SERVER_RESPONSE_MESSAGE_SCHEMAS,
  AGENT_CODEX_SERVER_RESPONSE_TYPES,
  AGENT_CODEX_SERVER_RPC,
  type AgentCodexClientRequestMessage,
  type AgentCodexClientResponseMessage,
  ClientMessageSchema,
  ServerMessageSchema,
} from "../index.js"

describe("agent.codex protocol", () => {
  it("covers the complete generated Codex App Server API surface", () => {
    expect(Object.keys(AGENT_CODEX_CLIENT_RPC)).toHaveLength(158)
    expect(Object.keys(AGENT_CODEX_SERVER_RPC)).toHaveLength(11)
    expect(Object.keys(AGENT_CODEX_SERVER_NOTIFICATIONS)).toHaveLength(83)
    expect(Object.keys(AGENT_CODEX_CLIENT_NOTIFICATIONS)).toHaveLength(1)

    expect(new Set(AGENT_CODEX_CLIENT_REQUEST_TYPES).size).toBe(158)
    expect(new Set(AGENT_CODEX_CLIENT_RESPONSE_TYPES).size).toBe(158)
    expect(new Set(AGENT_CODEX_SERVER_REQUEST_TYPES).size).toBe(11)
    expect(new Set(AGENT_CODEX_SERVER_RESPONSE_TYPES).size).toBe(11)
    expect(new Set(AGENT_CODEX_SERVER_NOTIFICATION_TYPES).size).toBe(83)
    expect(Object.keys(AGENT_CODEX_CLIENT_REQUEST_MESSAGE_SCHEMAS)).toHaveLength(158)
    expect(Object.keys(AGENT_CODEX_CLIENT_RESPONSE_MESSAGE_SCHEMAS)).toHaveLength(158)
    expect(Object.keys(AGENT_CODEX_SERVER_REQUEST_MESSAGE_SCHEMAS)).toHaveLength(11)
    expect(Object.keys(AGENT_CODEX_SERVER_RESPONSE_MESSAGE_SCHEMAS)).toHaveLength(11)
    expect(Object.keys(AGENT_CODEX_SERVER_NOTIFICATION_MESSAGE_SCHEMAS)).toHaveLength(83)
    expect(Object.keys(AGENT_CODEX_CLIENT_NOTIFICATION_MESSAGE_SCHEMAS)).toHaveLength(1)
  })

  it("normalizes upstream slash and camel-case methods into dotted names", () => {
    expect(AGENT_CODEX_CLIENT_RPC["thread/start"]).toMatchObject({
      request: "agent.codex.thread.start.request",
      response: "agent.codex.thread.start.response",
    })
    expect(AGENT_CODEX_CLIENT_RPC["thread/memoryMode/set"]).toMatchObject({
      request: "agent.codex.thread.memory_mode.set.request",
    })
    expect(AGENT_CODEX_CLIENT_RPC["threadSection/list"]).toMatchObject({
      request: "agent.codex.thread_section.list.request",
    })
    expect(AGENT_CODEX_CLIENT_RPC.getConversationSummary).toMatchObject({
      request: "agent.codex.get_conversation_summary.request",
    })
  })

  it("pairs every generated Zod branch with its generated Codex wire type", () => {
    type ThreadStartRequest = Extract<
      AgentCodexClientRequestMessage,
      { type: "agent.codex.thread.start.request" }
    >
    type ThreadStartResponse = Extract<
      AgentCodexClientResponseMessage,
      { type: "agent.codex.thread.start.response" }
    >

    expectTypeOf<
      z.infer<(typeof AGENT_CODEX_CLIENT_REQUEST_MESSAGE_SCHEMAS)["thread/start"]>
    >().toEqualTypeOf<ThreadStartRequest>()
    expectTypeOf<
      z.infer<(typeof AGENT_CODEX_CLIENT_RESPONSE_MESSAGE_SCHEMAS)["thread/start"]>
    >().toEqualTypeOf<ThreadStartResponse>()
  })

  it("indexes wire types back to their upstream methods", () => {
    expect(AGENT_CODEX_CLIENT_REQUEST_TYPE_TO_METHOD["agent.codex.thread.start.request"]).toBe(
      "thread/start"
    )
    expect(
      AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD[
        "agent.codex.item.agent_message.delta.notification"
      ]
    ).toBe("item/agentMessage/delta")
  })

  it("accepts client RPC requests with top-level params", () => {
    expect(
      ClientMessageSchema.parse({
        type: "agent.codex.command.exec.resize.request",
        requestId: "codex-command-resize-1",
        processId: "process-1",
        size: { cols: 120, rows: 40 },
      })
    ).toEqual({
      type: "agent.codex.command.exec.resize.request",
      requestId: "codex-command-resize-1",
      processId: "process-1",
      size: { cols: 120, rows: 40 },
    })
  })

  it("accepts correlated server RPC responses inside payload", () => {
    expect(
      ServerMessageSchema.parse({
        type: "agent.codex.account.logout.response",
        payload: { requestId: "codex-account-logout-1" },
      })
    ).toMatchObject({
      payload: { requestId: "codex-account-logout-1" },
    })
  })

  it("supports reverse RPCs from the server to a capable client", () => {
    expect(
      ServerMessageSchema.safeParse({
        type: "agent.codex.current_time.read.request",
        requestId: "current-time-1",
        threadId: "thread-1",
      }).success
    ).toBe(true)

    expect(
      ClientMessageSchema.safeParse({
        type: "agent.codex.current_time.read.response",
        payload: { currentTimeAt: 1_789_000_000, requestId: "current-time-1" },
      }).success
    ).toBe(true)
  })

  it("supports notifications in both directions", () => {
    expect(
      ServerMessageSchema.safeParse({
        type: "agent.codex.skills.changed.notification",
        payload: {},
      }).success
    ).toBe(true)

    expect(
      ClientMessageSchema.safeParse({
        type: "agent.codex.initialized.notification",
      }).success
    ).toBe(true)
  })

  it("rejects upstream slash names, invalid fields, and non-JSON provider payloads", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "thread/start",
        requestId: "request-1",
        cwd: "/workspace",
      }).success
    ).toBe(false)

    expect(
      ClientMessageSchema.safeParse({
        type: "agent.codex.command.exec.resize.request",
        requestId: "request-1",
        processId: "process-1",
        size: { cols: "wide", rows: 40 },
      }).success
    ).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        type: "agent.codex.current_time.read.response",
        payload: { currentTimeAt: 1n, requestId: "request-1" },
      }).success
    ).toBe(false)
  })
})
