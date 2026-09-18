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
})
