import { describe, expect, it } from "vitest"

import type { SigningIntentRecord } from "./approval.js"
import { createSigningIntentPersistenceService } from "./approval.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

const timestamp = "2026-09-01T05:00:00.000Z"
const resolvedAt = "2026-09-01T05:01:00.000Z"

const intent: SigningIntentRecord = {
  approvalId: "approval_one",
  decision: "require-human-approval",
  decisionId: "policy_decision_one",
  expiresAt: "2026-09-01T05:05:00.000Z",
  intent: {
    account: {
      address: "0x0000000000000000000000000000000000000001",
      chainAccountId: "chain_account_one",
      chainId: 1,
      walletAccountId: "account_one",
      walletId: "wallet_one",
    },
    correlationId: "request_one",
    createdAt: timestamp,
    id: "signing_intent_one",
    kind: "sign-transaction",
    transaction: { chainId: 1, gas: 21_000n, value: 42n },
  },
  mode: "human-approval",
  payloadHash: `sha256:${"1".repeat(64)}`,
  revision: 1,
  source: "agent",
  status: "pending-approval",
  updatedAt: timestamp,
}

describe("signing intent persistence", () => {
  it("round-trips exact payloads and atomically resolves an approval once", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createSigningIntentPersistenceService(database.db)
    const approval = {
      expiresAt: intent.expiresAt,
      id: "approval_one",
      intentId: intent.intent.id,
      requestedAt: timestamp,
      revision: 1,
      status: "pending" as const,
    }

    await expect(service.create(intent, approval)).resolves.toEqual(intent)
    await expect(service.getIntent(intent.intent.id)).resolves.toEqual(intent)
    await expect(service.listApprovals("pending")).resolves.toEqual([approval])

    const attempts = await Promise.all([
      service.resolveApproval({
        approvalId: approval.id,
        expectedRevision: 1,
        resolution: "approved",
        reviewer: "user",
        timestamp: resolvedAt,
      }),
      service.resolveApproval({
        approvalId: approval.id,
        expectedRevision: 1,
        resolution: "rejected",
        reviewer: "other-user",
        timestamp: resolvedAt,
      }),
    ])
    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(attempts.find(Boolean)).toMatchObject({
      approval: { resolvedAt, revision: 2 },
      intent: { revision: 2, updatedAt: resolvedAt },
    })
    await expect(service.listApprovals("pending")).resolves.toEqual([])

    database.close()
  })
})
