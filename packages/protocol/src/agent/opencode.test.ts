import { describe, expect, it } from "vitest"

import {
  AGENT_OPENCODE_V2_OPERATIONS,
  AgentOpenCodeCallRequestSchema,
  AgentOpenCodeEventSubscribeRequestSchema,
} from "../index.js"

describe("agent.opencode v2 protocol", () => {
  it("accepts only the integrated v2 operation surface", () => {
    expect(new Set(AGENT_OPENCODE_V2_OPERATIONS).size).toBe(AGENT_OPENCODE_V2_OPERATIONS.length)
    expect(
      AgentOpenCodeCallRequestSchema.safeParse({
        payload: { operation: "session.create" },
        requestId: "request-1",
        type: "agent.opencode.call.request",
      }).success
    ).toBe(true)
    expect(
      AgentOpenCodeCallRequestSchema.safeParse({
        payload: { operation: "POST /session" },
        requestId: "request-1",
        type: "agent.opencode.call.request",
      }).success
    ).toBe(false)
  })

  it("uses the single v2 event stream", () => {
    expect(
      AgentOpenCodeEventSubscribeRequestSchema.safeParse({
        payload: { stream: "event", subscriptionId: "subscription-1" },
        requestId: "request-1",
        type: "agent.opencode.event.subscribe.request",
      }).success
    ).toBe(true)
    expect(
      AgentOpenCodeEventSubscribeRequestSchema.safeParse({
        payload: { stream: "global.event", subscriptionId: "subscription-1" },
        requestId: "request-1",
        type: "agent.opencode.event.subscribe.request",
      }).success
    ).toBe(false)
  })
})
