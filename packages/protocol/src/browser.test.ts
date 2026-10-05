import { describe, expect, it } from "vitest"

import {
  BrowserAutomationOutcomeSchema,
  BrowserAutomationRequestSchema,
  BrowserHostRegistrationSchema,
} from "./browser.js"
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./index.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

describe("browser host protocol", () => {
  it("registers windows by the backends they serve", () => {
    expect(BrowserHostRegistrationSchema.parse({ backends: ["iab", "iab", "mcpapps"] })).toEqual({
      backends: ["iab", "mcpapps"],
    })
    expect(BrowserHostRegistrationSchema.safeParse({ backends: ["chrome"] }).success).toBe(false)
    expect(BrowserHostRegistrationSchema.safeParse({ backends: [] }).success).toBe(false)
  })

  it("carries requests opaquely and outcomes with error retryability", () => {
    expect(
      BrowserAutomationRequestSchema.parse({
        automationId: "a1",
        backend: "iab",
        request: { member: "tabs.list", op: "browser.call" },
        threadId,
      })
    ).toMatchObject({ backend: "iab", threadId })
    expect(
      BrowserAutomationOutcomeSchema.parse({
        automationId: "a1",
        error: { code: "stale_index", message: "Stale." },
        ok: false,
      })
    ).toEqual({
      automationId: "a1",
      error: { code: "stale_index", message: "Stale.", retryable: false },
      ok: false,
    })
  })

  it("routes browser host messages through the session envelopes", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        payload: { backends: ["iab"], name: "Studio" },
        requestId: "r1",
        type: "browser.host.register.request",
      }).success
    ).toBe(true)
    expect(
      SessionOutboundMessageSchema.safeParse({
        payload: {
          automationId: "a1",
          backend: "mcpapps",
          request: { op: "browsers.list" },
          threadId,
        },
        type: "browser.automation.command.notification",
      }).success
    ).toBe(true)
  })
})
