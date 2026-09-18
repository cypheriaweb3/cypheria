import { describe, expect, it } from "vitest"

import {
  parseSessionInboundMessage,
  parseSessionOutboundMessage,
  Web3WalletImportPrivateKeyRequestSchema,
} from "./index.js"

describe("Web3 protocol", () => {
  it("validates wallet secrets only in requests and keeps responses public", () => {
    const request = Web3WalletImportPrivateKeyRequestSchema.parse({
      payload: {
        name: "Signer",
        privateKey: `0x${"11".repeat(32)}`,
      },
      requestId: "req_web3_secret",
      type: "web3.wallet.import-private-key.request",
    })
    expect(request.payload.privateKey).toHaveLength(66)
    expect(() =>
      parseSessionOutboundMessage({
        payload: { ok: true, value: { privateKey: request.payload.privateKey } },
        requestId: request.requestId,
        type: "web3.wallet.import-private-key.response",
      })
    ).toThrow()
  })

  it("rejects unknown Web3 operations at the session boundary", () => {
    expect(() =>
      parseSessionInboundMessage({
        payload: {},
        requestId: "req_unknown",
        type: "web3.wallet.export-private-key.request",
      })
    ).toThrow()
  })

  it("validates server-owned dApp sessions and provider requests", () => {
    expect(
      parseSessionInboundMessage({
        payload: { url: "https://app.example/path" },
        requestId: "req_dapp_open",
        type: "web3.dapp.session.open.request",
      })
    ).toMatchObject({ type: "web3.dapp.session.open.request" })
    expect(
      parseSessionInboundMessage({
        payload: {
          id: "provider_1",
          method: "eth_accounts",
          origin: "https://app.example",
          sessionKey: "cypheria:dapp:https://app.example",
        },
        requestId: "req_dapp_provider",
        type: "web3.dapp.provider.request",
      })
    ).toMatchObject({ type: "web3.dapp.provider.request" })
    expect(() =>
      parseSessionInboundMessage({
        payload: { url: "http://app.example" },
        requestId: "req_insecure_dapp",
        type: "web3.dapp.session.open.request",
      })
    ).toThrow()
  })
})
