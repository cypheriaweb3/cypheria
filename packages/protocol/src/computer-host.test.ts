import { describe, expect, it } from "vitest"

import {
  ComputerHostApprovalSchema,
  ComputerHostOutcomeSchema,
  ComputerHostRegistrationSchema,
} from "./computer-host.js"
import {
  isClientResponseMessage,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./index.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

describe("computer host protocol", () => {
  it("offers only device capabilities, once each", () => {
    expect(
      ComputerHostRegistrationSchema.parse({
        capabilities: ["computer", "chrome", "computer"],
        name: "Studio Mac",
      })
    ).toEqual({ capabilities: ["computer", "chrome"], name: "Studio Mac" })
    expect(
      ComputerHostRegistrationSchema.safeParse({ capabilities: ["iab"], name: "Studio Mac" })
        .success
    ).toBe(false)
  })

  it("carries device requests and their outcomes in session envelopes", () => {
    const notification = SessionOutboundMessageSchema.parse({
      payload: { commandId: "c-1", request: { op: "apps.list" }, threadId },
      type: "computer.host.command.notification",
    })
    expect(isClientResponseMessage(notification)).toBe(false)
    expect(
      SessionInboundMessageSchema.safeParse({
        payload: { commandId: "c-1", ok: true, value: [{ name: "Notes" }] },
        requestId: "r-1",
        type: "computer.host.result.request",
      }).success
    ).toBe(true)
    expect(
      ComputerHostOutcomeSchema.parse({
        commandId: "c-1",
        error: { code: "unavailable", message: "No driver." },
        ok: false,
      })
    ).toMatchObject({ error: { retryable: false } })
  })

  it("asks about an app, or about recording computer audio", () => {
    const base = { allowAlways: false, commandId: "req_1", risk: "high", threadId } as const
    expect(
      ComputerHostApprovalSchema.safeParse({
        ...base,
        app: "com.apple.Notes",
        displayName: "Notes",
      }).success
    ).toBe(true)
    expect(ComputerHostApprovalSchema.safeParse({ ...base, kind: "audio" }).success).toBe(true)
    expect(
      ComputerHostApprovalSchema.safeParse({ ...base, app: "x", displayName: "x", kind: "audio" })
        .success
    ).toBe(false)
    expect(ComputerHostApprovalSchema.safeParse({ ...base, kind: "app" }).success).toBe(false)
  })
})
