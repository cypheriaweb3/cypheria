import { describe, expect, it } from "vitest"

import { ComputerHostOutcomeSchema, ComputerHostRegistrationSchema } from "./computer-host.js"
import {
  isClientResponseMessage,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./index.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

describe("computer host protocol", () => {
  it("offers only device surfaces, once each", () => {
    expect(
      ComputerHostRegistrationSchema.parse({
        name: "Studio Mac",
        surfaces: ["computer", "browsers", "computer"],
      })
    ).toEqual({ name: "Studio Mac", surfaces: ["computer", "browsers"] })
    expect(
      ComputerHostRegistrationSchema.safeParse({ name: "Studio Mac", surfaces: ["iab"] }).success
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
})
