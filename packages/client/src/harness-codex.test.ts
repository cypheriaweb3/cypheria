import { describe, expect, it, vi } from "vitest"

import { createCodexHarnessActions } from "./harness-codex.js"
import type { ServerClient } from "./server-client.js"

describe("Codex harness actions", () => {
  it("maps account and model operations to harness protocol messages", async () => {
    const requestCodexHarness = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value: type.includes("model.list")
          ? { models: [] }
          : type.includes("login.cancel")
            ? { cancelled: true }
            : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const actions = createCodexHarnessActions({
      requestCodexHarness,
    } as unknown as ServerClient)

    await actions.models.list(true)
    await actions.account.cancelLogin("login-1")
    await actions.permissions.catalog("/workspace")

    expect(requestCodexHarness.mock.calls).toEqual([
      ["harness.codex.model.list.request", { includeHidden: true }, undefined],
      ["harness.codex.account.login.cancel.request", { loginId: "login-1" }, undefined],
      ["harness.codex.permissions.catalog.get.request", { cwd: "/workspace" }, undefined],
    ])
  })

  it("normalizes harness errors", async () => {
    const requestCodexHarness = vi.fn(async () => ({
      payload: {
        error: { code: "AUTH_FAILED", message: "Sign in again" },
        ok: false as const,
      },
      requestId: "test",
      type: "harness.codex.account.get.response" as const,
    }))
    const actions = createCodexHarnessActions({
      requestCodexHarness,
    } as unknown as ServerClient)
    await expect(actions.account.get()).rejects.toMatchObject({
      message: "Sign in again",
      name: "AUTH_FAILED",
    })
  })
})
