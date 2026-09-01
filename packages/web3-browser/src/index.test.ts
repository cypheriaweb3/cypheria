import { describe, expect, it } from "vitest"

import {
  createDappSession,
  createDappSessionKey,
  createDappSessionManager,
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
    expect(() => createDappSessionKey("file:///tmp/dapp.html")).toThrow()
    expect(() => createDappSessionKey("https://user:pass@app.example")).toThrow()
    expect(() => createDappSessionKey("http://app.example")).toThrow()
    expect(createDappSessionKey("http://localhost:5173/app")).toBe(
      "cypheria:dapp:http://localhost:5173"
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

  it("persists session reuse and rejects cross-origin request scope", async () => {
    const sessions = new Map<string, ReturnType<typeof createDappSession>>()
    let now = "2026-09-01T08:00:00.000Z"
    const manager = createDappSessionManager({
      now: () => now,
      persistence: {
        getSession: async (origin) => sessions.get(origin),
        saveSession: async (session) => {
          sessions.set(session.origin, session)
          return session
        },
      },
    })
    const opened = await manager.open("https://app.example/path")
    now = "2026-09-01T08:01:00.000Z"
    await expect(manager.open("https://app.example/other")).resolves.toMatchObject({
      createdAt: opened.createdAt,
      lastUsedAt: now,
    })
    await expect(
      manager.validateRequest({
        id: "request_1",
        method: "eth_accounts",
        origin: "https://evil.example",
        sessionKey: opened.key,
      })
    ).rejects.toThrow()
  })

  it("rejects a transport response for another request", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => ({ id: "other", result: [] }),
    })
    await expect(bridge.request({ method: "eth_accounts" })).rejects.toMatchObject({
      code: -32603,
    })
  })

  it("rejects non-JSON provider parameters before transport", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => ({ id: "unused", result: null }),
    })
    await expect(bridge.request({ method: "personal_sign", params: [1n] })).rejects.toThrow()
  })
})
