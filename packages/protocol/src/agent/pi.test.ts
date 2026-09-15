import type { RpcResponse } from "@earendil-works/pi-coding-agent"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  AGENT_PI_EVENT_NOTIFICATIONS,
  AGENT_PI_EXTENSION_UI,
  AGENT_PI_RPC,
  AgentPiClientMessageSchema,
  AgentPiEventNotificationSchema,
  AgentPiServerMessageSchema,
  isClientResponseMessage,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  unwrapPiExtensionUIResponse,
  unwrapPiRpcCommand,
  unwrapPiServerEvent,
  wrapPiRpcResponse,
  wrapPiServerEvent,
} from "../index.ts"

const rpcCommands = [
  "prompt",
  "steer",
  "follow_up",
  "abort",
  "clear_queue",
  "new_session",
  "get_state",
  "set_model",
  "cycle_model",
  "get_available_models",
  "set_thinking_level",
  "cycle_thinking_level",
  "get_available_thinking_levels",
  "set_steering_mode",
  "set_follow_up_mode",
  "compact",
  "set_auto_compaction",
  "set_auto_retry",
  "abort_retry",
  "bash",
  "abort_bash",
  "get_session_stats",
  "export_html",
  "switch_session",
  "fork",
  "clone",
  "get_fork_messages",
  "get_entries",
  "get_tree",
  "get_last_assistant_text",
  "set_session_name",
  "get_messages",
  "get_commands",
] as const

describe("agent.pi protocol", () => {
  it("covers every command in Pi 0.85.1 with unique paired wire types", () => {
    expect(Object.keys(AGENT_PI_RPC)).toEqual(rpcCommands)
    expect(new Set(Object.values(AGENT_PI_RPC).map(({ request }) => request)).size).toBe(
      rpcCommands.length
    )
    expect(new Set(Object.values(AGENT_PI_RPC).map(({ response }) => response)).size).toBe(
      rpcCommands.length
    )
    for (const definition of Object.values(AGENT_PI_RPC)) {
      expect(definition.request).toMatch(/^agent\.pi\..+\.request$/)
      expect(definition.response).toMatch(/^agent\.pi\..+\.response$/)
    }
  })

  it("converts concrete requests to exact Pi JSONL commands", () => {
    const request = AgentPiClientMessageSchema.parse({
      images: [{ data: "aW1hZ2U=", mimeType: "image/png", type: "image" }],
      message: "Inspect this image",
      requestId: "pi-1",
      streamingBehavior: "followUp",
      type: "agent.pi.prompt.request",
    })
    if (request.type !== "agent.pi.prompt.request") throw new Error("Expected Pi prompt request")

    expect(unwrapPiRpcCommand(request)).toEqual({
      id: "pi-1",
      images: [{ data: "aW1hZ2U=", mimeType: "image/png", type: "image" }],
      message: "Inspect this image",
      streamingBehavior: "followUp",
      type: "prompt",
    })
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request)
  })

  it("converts success, void, and error responses into their concrete pairs", () => {
    const state = wrapPiRpcResponse({
      command: "get_state",
      data: {
        autoCompactionEnabled: true,
        followUpMode: "one-at-a-time",
        isCompacting: false,
        isStreaming: false,
        messageCount: 2,
        pendingMessageCount: 0,
        sessionId: "session-1",
        steeringMode: "one-at-a-time",
        thinkingLevel: "medium",
      },
      id: "pi-2",
      success: true,
      type: "response",
    })
    expect(state).toMatchObject({
      payload: { requestId: "pi-2", result: { sessionId: "session-1" } },
      type: "agent.pi.state.get.response",
    })
    expect(isClientResponseMessage(state)).toBe(true)

    expect(
      wrapPiRpcResponse({
        command: "abort",
        id: "pi-3",
        success: true,
        type: "response",
      })
    ).toEqual({ payload: { requestId: "pi-3" }, type: "agent.pi.abort.response" })

    expect(
      wrapPiRpcResponse({
        command: "bash",
        error: "not allowed",
        id: "pi-4",
        success: false,
        type: "response",
      })
    ).toEqual({
      payload: { error: "not allowed", requestId: "pi-4" },
      type: "agent.pi.bash.response",
    })
    expect(() =>
      wrapPiRpcResponse({
        command: "abort",
        success: true,
        type: "response",
      })
    ).toThrow("missing its request id")
  })

  it("flattens every Pi event family into discriminable notifications", () => {
    expect(AgentPiEventNotificationSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)
    expect(Object.keys(AGENT_PI_EVENT_NOTIFICATIONS)).toHaveLength(23)

    const wrapped = wrapPiServerEvent({ type: "agent_settled" })
    expect(wrapped).toEqual({
      payload: { type: "agent_settled" },
      type: "agent.pi.agent.settled.notification",
    })
    expect(unwrapPiServerEvent(wrapped)).toEqual({ type: "agent_settled" })
    expect(SessionOutboundMessageSchema.parse(wrapped)).toEqual(wrapped)

    expect(
      AgentPiEventNotificationSchema.safeParse({
        payload: { type: "turn_start" },
        type: "agent.pi.agent.settled.notification",
      }).success
    ).toBe(false)
  })

  it("uses reverse RPC only for blocking extension UI methods", () => {
    const request = wrapPiServerEvent({
      id: "ui-1",
      method: "select",
      options: ["one", "two"],
      title: "Choose",
      type: "extension_ui_request",
    })
    expect(request).toMatchObject({
      requestId: "ui-1",
      type: AGENT_PI_EXTENSION_UI.select.request,
    })
    expect(AgentPiServerMessageSchema.parse(request)).toEqual(request)

    const response = AgentPiClientMessageSchema.parse({
      payload: { id: "ui-1", type: "extension_ui_response", value: "two" },
      requestId: "ui-1",
      type: AGENT_PI_EXTENSION_UI.select.response,
    })
    if (response.type !== AGENT_PI_EXTENSION_UI.select.response) {
      throw new Error("Expected Pi extension UI response")
    }
    expect(unwrapPiExtensionUIResponse(response)).toEqual({
      id: "ui-1",
      type: "extension_ui_response",
      value: "two",
    })

    const notification = wrapPiServerEvent({
      id: "ui-2",
      message: "Saved",
      method: "notify",
      notifyType: "info",
      type: "extension_ui_request",
    })
    expect(notification.type).toBe(AGENT_PI_EXTENSION_UI.notify.notification)
    expect("requestId" in notification).toBe(false)

    expect(
      AgentPiClientMessageSchema.safeParse({
        payload: { id: "wrong", type: "extension_ui_response", value: "two" },
        requestId: "ui-1",
        type: AGENT_PI_EXTENSION_UI.select.response,
      }).success
    ).toBe(false)
  })

  it("rejects response data for void commands", () => {
    expect(
      AgentPiServerMessageSchema.safeParse({
        payload: { requestId: "pi-5", result: null },
        type: "agent.pi.abort.response",
      }).success
    ).toBe(false)

    expect(() =>
      wrapPiRpcResponse({
        command: "abort",
        data: null,
        id: "pi-5",
        success: true,
        type: "response",
      } as RpcResponse)
    ).toThrow()
  })
})
