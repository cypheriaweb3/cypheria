import { describe, expect, it } from "vitest"

import { createDappSession, createDappSessionKey, isProviderMethod } from "./index.js"

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
})
