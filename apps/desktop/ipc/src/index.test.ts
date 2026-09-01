import { describe, expect, it } from "vitest"

import {
  ApprovalRequestViewSchema,
  approvalRequestDecideContract,
  approvalRequestsListContract,
} from "./index.js"

const view = {
  approval: {
    expiresAt: "2026-09-01T07:05:00.000Z",
    id: "approval_one",
    intentId: "signing_intent_one",
    requestedAt: "2026-09-01T07:00:00.000Z",
    revision: 1,
    status: "pending" as const,
  },
  intent: {
    approvalId: "approval_one",
    decision: "require-human-approval" as const,
    decisionId: "policy_decision_one",
    expiresAt: "2026-09-01T07:05:00.000Z",
    intent: {
      account: {
        address: "0x0000000000000000000000000000000000000001",
        chainAccountId: "chain_account_one",
        chainId: 1,
        walletAccountId: "account_one",
        walletId: "wallet_one",
      },
      correlationId: "request_one",
      createdAt: "2026-09-01T07:00:00.000Z",
      id: "signing_intent_one",
      kind: "sign-transaction" as const,
      transaction: { chainId: 1, value: 1n },
    },
    mode: "human-approval" as const,
    payloadHash: `sha256:${"1".repeat(64)}`,
    revision: 1,
    source: "dapp" as const,
    status: "pending-approval" as const,
    updatedAt: "2026-09-01T07:00:00.000Z",
  },
}

describe("approval IPC contracts", () => {
  it("validates exact approval payloads including transaction bigint values", () => {
    expect(approvalRequestsListContract.request.parse({ status: "pending" })).toEqual({
      status: "pending",
    })
    expect(ApprovalRequestViewSchema.parse(view)).toEqual(view)
    expect(() => ApprovalRequestViewSchema.parse({ ...view, privateKey: "secret" })).toThrow()
  })

  it("requires an optimistic revision for approval decisions", () => {
    expect(
      approvalRequestDecideContract.request.parse({
        approvalId: "approval_one",
        decision: "approved",
        expectedRevision: 1,
        reviewer: "user",
      })
    ).toMatchObject({ decision: "approved", expectedRevision: 1 })
    expect(() =>
      approvalRequestDecideContract.request.parse({
        approvalId: "approval_one",
        decision: "approved",
        expectedRevision: 0,
        reviewer: "user",
      })
    ).toThrow()
  })
})
