import { describe, expect, it } from "vitest"

import { ClientMessageSchema, CodexModelSettingsSchema, ServerMessageSchema } from "./index.js"

describe("Codex provider protocol", () => {
  it("validates shared model settings and account requests", () => {
    expect(
      CodexModelSettingsSchema.parse({
        model: "gpt-6-codex",
        provider: "openai",
        reasoningEffort: "high",
        serviceTier: null,
      })
    ).toMatchObject({ model: "gpt-6-codex", provider: "openai" })
    expect(
      ClientMessageSchema.parse({
        payload: { type: "chatgpt" },
        requestId: "login-1",
        type: "provider.codex.account.login.request",
      }).type
    ).toBe("provider.codex.account.login.request")
  })

  it("keeps provider failures on the correlated response", () => {
    expect(
      ServerMessageSchema.parse({
        payload: { error: { code: "AUTH_FAILED", message: "No account" }, ok: false },
        requestId: "account-1",
        type: "provider.codex.account.get.response",
      })
    ).toMatchObject({ requestId: "account-1" })
  })
})
