import { describe, expect, it } from "vitest"

import {
  assertCodexServerRequestResponse,
  validateCodexClientResponse,
  validateCodexServerMessage,
} from "./protocol-validation.js"

describe("Codex App Server generated protocol validation", () => {
  it("validates server notifications against the generated schema", () => {
    expect(
      validateCodexServerMessage("notification", {
        method: "skills/changed",
        params: { data: [] },
      })
    ).toBeUndefined()
    expect(validateCodexServerMessage("notification", { method: "skills/changed" })).toBeDefined()
  })

  it("validates client responses using their method-specific generated schema", () => {
    expect(
      validateCodexClientResponse("thread/list", {
        backwardsCursor: null,
        data: [],
        nextCursor: null,
      })
    ).toBeUndefined()
    expect(validateCodexClientResponse("thread/list", { data: "not-an-array" })).toBeDefined()
  })

  it("asserts reverse RPC responses using their exact method mapping", () => {
    expect(() =>
      assertCodexServerRequestResponse("execCommandApproval", { decision: "approved" })
    ).not.toThrow()
    expect(() =>
      assertCodexServerRequestResponse("execCommandApproval", { decision: "unknown" })
    ).toThrow("Invalid response for Codex app-server request execCommandApproval")
  })
})
