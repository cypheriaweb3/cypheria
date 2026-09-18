import { describe, expect, it, vi } from "vitest"

import type { ServerClient } from "./server-client.js"
import { createWeb3Actions } from "./web3.js"

describe("Web3 actions", () => {
  it("maps dApp lifecycle operations to the server protocol", async () => {
    const requestWeb3 = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "web3.dapp.session.open.request"
            ? {
                createdAt: "2026-09-19T00:00:00.000Z",
                origin: "https://app.example",
                partition: "persist:cypheria-dapp-example",
                sessionKey: "cypheria:dapp:https://app.example",
              }
            : { id: "provider_1", result: [] },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const actions = createWeb3Actions({ requestWeb3 } as unknown as ServerClient)

    await actions.dapps.openSession("https://app.example")
    await actions.dapps.request({
      id: "provider_1",
      method: "eth_accounts",
      origin: "https://app.example",
      sessionKey: "cypheria:dapp:https://app.example",
    })

    expect(requestWeb3.mock.calls).toEqual([
      ["web3.dapp.session.open.request", { url: "https://app.example" }, undefined],
      [
        "web3.dapp.provider.request",
        {
          id: "provider_1",
          method: "eth_accounts",
          origin: "https://app.example",
          sessionKey: "cypheria:dapp:https://app.example",
        },
        undefined,
      ],
    ])
  })

  it("normalizes dApp provider failures", async () => {
    const requestWeb3 = vi.fn(async () => ({
      payload: {
        error: { code: "DAPP_SESSION_NOT_FOUND", message: "Session was not found" },
        ok: false as const,
      },
      requestId: "test",
      type: "web3.dapp.provider.response" as const,
    }))
    const actions = createWeb3Actions({ requestWeb3 } as unknown as ServerClient)

    await expect(
      actions.dapps.request({
        id: "provider_1",
        method: "eth_accounts",
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).rejects.toMatchObject({ message: "Session was not found", name: "DAPP_SESSION_NOT_FOUND" })
  })
})
