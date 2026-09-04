import { describe, expect, it } from "vitest"

import type { SigningIntentRecord } from "./approval.js"
import { createSigningIntentPersistenceService } from "./approval.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"

const timestamp = "2026-09-01T05:00:00.000Z"
const resolvedAt = "2026-09-01T05:01:00.000Z"

const intent: SigningIntentRecord = {
  intent: {
    id: "signing_intent_one",
    account: {
      walletId: "wallet_one",
      walletAccountId: "account_one",
      chainAccountId: "chain_account_one",
      chainKey: "eip155:1",
      address: "0x0000000000000000000000000000000000000001",
    },
    kind: "sign-transaction",
    transaction: { chainId: 1, gas: 21_000n, value: 42n },
    correlationId: "request_one",
    createdAt: timestamp,
  },
  approvalId: "approval_one",
  payloadHash: `sha256:${"1".repeat(64)}`,
  source: "agent",
  mode: "human-approval",
  decision: "require-human-approval",
  decisionId: "policy_decision_one",
  status: "pending-approval",
  revision: 1,
  updatedAt: timestamp,
  expiresAt: "2026-09-01T05:05:00.000Z",
}

describe("signing intent persistence", () => {
  it("round-trips exact payloads and atomically resolves an approval once", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createSigningIntentPersistenceService(database.db)
    const approval = {
      id: "approval_one",
      intentId: intent.intent.id,
      status: "pending" as const,
      revision: 1,
      requestedAt: timestamp,
      expiresAt: intent.expiresAt,
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
