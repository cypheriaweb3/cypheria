import { describe, expect, it } from "vitest"

import {
  ClientMessageSchema,
  CodexAgentSettingsSchema,
  CodexModelSettingsSchema,
  ServerMessageSchema,
} from "./index.js"

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

  it("validates Cypheria-owned Codex permissions", () => {
    expect(
      CodexAgentSettingsSchema.parse({
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: null,
        modelReasoningSummary: "auto",
        modelVerbosity: null,
        networkAccess: true,
        provider: "openai",
        reasoningEffort: null,
        sandboxMode: "workspace-write",
        serviceTier: null,
        showFullAccessInComposer: false,
        webSearch: "cached",
      })
    ).toMatchObject({ sandboxMode: "workspace-write", showFullAccessInComposer: false })
    expect(
      ClientMessageSchema.parse({
        payload: {},
        requestId: "permissions-1",
        type: "provider.codex.permissions.defaults.get.request",
      }).type
    ).toBe("provider.codex.permissions.defaults.get.request")
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
