import { describe, expect, it } from "vitest"

import {
  createDappSession,
  createDappSessionKey,
  createProviderBridge,
  isProviderMethod,
  type ProviderRequest,
  ProviderRpcError,
} from "./index.js"

describe("Web3 browser session model", () => {
  it("creates stable origin-scoped session keys", () => {
    expect(createDappSessionKey("https://app.uniswap.org/swap?chain=1")).toBe(
      "cypheria:dapp:https://app.uniswap.org"
    )
  })

  it("creates persistent Electron partition names from session keys", () => {
    expect(createDappSession("https://app.aave.com/markets", "2026-05-28T00:00:00.000Z")).toEqual({
      createdAt: "2026-05-28T00:00:00.000Z",
      key: "cypheria:dapp:https://app.aave.com",
      origin: "https://app.aave.com",
      partition: "persist:cypheria:dapp:https://app.aave.com",
    })
  })

  it("recognizes supported EIP-1193 provider methods", () => {
    expect(isProviderMethod("eth_requestAccounts")).toBe(true)
    expect(isProviderMethod("wallet_switchEthereumChain")).toBe(true)
    expect(isProviderMethod("eth_sendRawTransaction")).toBe(false)
  })

  it("serializes provider requests to the configured transport", async () => {
    const requests: ProviderRequest[] = []
    const bridge = createProviderBridge({
      chainId: 1,
      origin: "https://app.example/swap",
      transport: (request) => {
        requests.push(request)
        return {
          id: request.id,
          result: ["0x0000000000000000000000000000000000000001"],
        }
      },
    })

    await expect(bridge.request({ method: "eth_requestAccounts" })).resolves.toEqual([
      "0x0000000000000000000000000000000000000001",
    ])
    expect(requests).toEqual([
      {
        chainId: 1,
        id: "provider_1",
        method: "eth_requestAccounts",
        origin: "https://app.example",
        params: undefined,
        sessionKey: "cypheria:dapp:https://app.example",
      },
    ])
  })

  it("throws structured provider errors", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: (request) => ({
        error: {
          code: 4001,
          message: "User rejected the request.",
        },
        id: request.id,
      }),
    })

    await expect(bridge.request({ method: "personal_sign", params: ["hello"] })).rejects.toEqual(
      expect.objectContaining({
        code: 4001,
        message: "User rejected the request.",
        name: "ProviderRpcError",
      })
    )
  })

  it("rejects unsupported provider methods before transport", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => {
        throw new Error("transport should not be called")
      },
    })

    await expect(bridge.request({ method: "eth_sendRawTransaction" })).rejects.toBeInstanceOf(
      ProviderRpcError
    )
  })
})
