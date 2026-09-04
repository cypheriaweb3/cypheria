import { describe, expect, it } from "vitest"

import {
  ApprovalRequestViewSchema,
  approvalRequestDecideContract,
  approvalRequestsListContract,
  automationRunStartContract,
  automationTaskCreateContract,
  automationTaskPauseContract,
  browserSessionOpenContract,
  dappProviderRequestContract,
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
        chainKey: "eip155:1",
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

describe("dApp browser IPC contracts", () => {
  it("accepts scoped provider requests and rejects non-JSON parameters", () => {
    expect(
      dappProviderRequestContract.request.parse({
        id: "provider_1",
        method: "personal_sign",
        origin: "https://app.example",
        params: ["hello", "0x0000000000000000000000000000000000000001"],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toMatchObject({ method: "personal_sign", origin: "https://app.example" })
    expect(() =>
      dappProviderRequestContract.request.parse({
        id: "provider_2",
        method: "personal_sign",
        origin: "https://app.example",
        params: [1n],
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toThrow()
  })

  it("accepts scoped Solana Wallet Standard requests", () => {
    expect(
      dappProviderRequestContract.request.parse({
        id: "solana_provider_1",
        input: { silent: true },
        method: "standard:connect",
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toMatchObject({ method: "standard:connect", origin: "https://app.example" })
    expect(() =>
      dappProviderRequestContract.request.parse({
        id: "solana_provider_2",
        input: { silent: true },
        method: "standard:connect",
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://evil.example",
      })
    ).toThrow()
  })

  it("restricts browser sessions to secure dApp URLs", () => {
    expect(browserSessionOpenContract.request.parse({ url: "https://app.example/path" })).toEqual({
      url: "https://app.example/path",
    })
  })
})

describe("automation IPC contracts", () => {
  it("validates task creation and lifecycle inputs", () => {
    expect(
      automationTaskCreateContract.request.parse({
        definition: { handler: "noop" },
        title: "Inspect positions",
        trigger: { kind: "manual", requestedBy: "user" },
        walletPolicyScope: { accountIds: [], chainKeys: ["eip155:1"], mode: "read-only" },
        workspace: { id: "workspace_one", path: "/tmp/cypheria" },
      })
    ).toMatchObject({ definition: { handler: "noop" }, title: "Inspect positions" })
    expect(
      automationTaskPauseContract.request.parse({ expectedRevision: 1, taskId: "task_one" })
    ).toEqual({ expectedRevision: 1, taskId: "task_one" })
    expect(automationRunStartContract.request.parse({ taskId: "task_one" })).toEqual({
      taskId: "task_one",
    })
  })

  it("rejects secret or non-JSON task definition input", () => {
    expect(() =>
      automationTaskCreateContract.request.parse({
        definition: { handler: "noop", input: { amount: 1n, privateKey: "secret" } },
        title: "Invalid task",
        trigger: { kind: "manual", requestedBy: "user" },
        walletPolicyScope: { accountIds: [], chainKeys: ["eip155:1"], mode: "read-only" },
        workspace: { id: "workspace_one", path: "/tmp/cypheria" },
      })
    ).toThrow()
  })
})
