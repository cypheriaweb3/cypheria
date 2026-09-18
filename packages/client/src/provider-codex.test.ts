import { describe, expect, it, vi } from "vitest"

import { createCodexProviderActions } from "./provider-codex.js"
import type { ServerClient } from "./server-client.js"

describe("Codex provider actions", () => {
  it("maps account and model operations to provider protocol messages", async () => {
    const requestCodexProvider = vi.fn(async (type: string) => ({
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
    const actions = createCodexProviderActions({
      requestCodexProvider,
    } as unknown as ServerClient)

    await actions.models.list(true)
    await actions.account.cancelLogin("login-1")

    expect(requestCodexProvider.mock.calls).toEqual([
      ["provider.codex.model.list.request", { includeHidden: true }, undefined],
      ["provider.codex.account.login.cancel.request", { loginId: "login-1" }, undefined],
    ])
  })

  it("normalizes provider errors", async () => {
    const requestCodexProvider = vi.fn(async () => ({
      payload: {
        error: { code: "AUTH_FAILED", message: "Sign in again" },
        ok: false as const,
      },
      requestId: "test",
      type: "provider.codex.account.get.response" as const,
    }))
    const actions = createCodexProviderActions({
      requestCodexProvider,
    } as unknown as ServerClient)
    await expect(actions.account.get()).rejects.toMatchObject({
      message: "Sign in again",
      name: "AUTH_FAILED",
    })
  })
})
