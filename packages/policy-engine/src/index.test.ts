import { describe, expect, it } from "vitest"

import { evaluateSigningPolicies, parseSigningPolicy } from "./index.js"

const basePolicy = parseSigningPolicy({
  chainIds: [1],
  enabled: true,
  id: "policy_1",
  maxNativeValue: "100",
  methods: ["eth_sendTransaction"],
  origins: ["https://app.example"],
  walletId: "wallet_1",
})

describe("policy engine", () => {
  it("allows read-only methods and denies signing methods in read-only mode", () => {
    expect(
      evaluateSigningPolicies([], {
        chainId: 1,
        method: "eth_chainId",
        mode: "read-only",
        walletId: "wallet_1",
      }).decision
    ).toBe("allow")

    expect(
      evaluateSigningPolicies([], {
        chainId: 1,
        method: "eth_sendTransaction",
        mode: "read-only",
        walletId: "wallet_1",
      }).decision
    ).toBe("deny")
  })

  it("requires approval in human approval mode", () => {
    expect(
      evaluateSigningPolicies([basePolicy], {
        chainId: 1,
        method: "eth_sendTransaction",
        mode: "human-approval",
        origin: "https://app.example",
        walletId: "wallet_1",
      }).decision
    ).toBe("require-human-approval")
  })

  it("allows a conditional auto-signing request when a policy matches", () => {
    expect(
      evaluateSigningPolicies([basePolicy], {
        chainId: 1,
        method: "eth_sendTransaction",
        mode: "conditional-auto-signing",
        nativeValue: "50",
        origin: "https://app.example",
        walletId: "wallet_1",
      })
    ).toMatchObject({
      decision: "allow",
      matchedPolicyId: "policy_1",
    })
  })

  it("requires approval when value exceeds the policy limit", () => {
    expect(
      evaluateSigningPolicies([basePolicy], {
        chainId: 1,
        method: "eth_sendTransaction",
        mode: "conditional-auto-signing",
        nativeValue: "101",
        origin: "https://app.example",
        walletId: "wallet_1",
      }).decision
    ).toBe("require-human-approval")
  })

  it("prioritizes explicit deny policies", () => {
    const denyPolicy = parseSigningPolicy({
      ...basePolicy,
      effect: "deny",
      id: "deny_1",
    })

    expect(
      evaluateSigningPolicies([basePolicy, denyPolicy], {
        chainId: 1,
        method: "eth_sendTransaction",
        mode: "conditional-auto-signing",
        nativeValue: "1",
        origin: "https://app.example",
        walletId: "wallet_1",
      })
    ).toMatchObject({
      decision: "deny",
      matchedPolicyId: "deny_1",
    })
  })
})
