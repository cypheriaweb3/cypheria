import { parseSigningPolicy } from "@cypheria/policy-engine"
import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { ensureDatabaseSchema } from "./migrations.js"
import { createSigningPolicyPersistenceService } from "./policy.js"
import { createWalletPublicStatePersistenceService } from "./wallet.js"

const timestamp = "2026-09-01T04:00:00.000Z"
const fingerprint = `sha256:${"1".repeat(64)}` as const

describe("signing policy persistence", () => {
  it("round-trips versioned policies, detects stale updates, and cascades wallet deletion", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const wallets = createWalletPublicStatePersistenceService(database.db)
    await wallets.create({
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
      wallet: {
        createdAt: timestamp,
        fingerprint,
        id: "wallet_policy",
        kind: "watch",
        metadata: {},
        name: "Policy wallet",
        provider: "read-only",
        status: "ready",
        updatedAt: timestamp,
      },
    })
    const service = createSigningPolicyPersistenceService(database.db)
    const policy = parseSigningPolicy({
      chainIds: [1, 10],
      contractAllowlist: ["0x0000000000000000000000000000000000000001"],
      effect: "allow",
      enabled: true,
      id: "policy_one",
      maxNativeValue: "100",
      methods: ["eth_sendTransaction"],
      origins: ["https://app.example"],
      requireHumanApproval: false,
      walletId: "wallet_policy",
    })

    const created = await service.create(policy, timestamp)
    expect(created).toMatchObject({ policy, revision: 1 })
    await expect(service.get(policy.id)).resolves.toEqual(created)
    await expect(service.list({ enabled: true, walletId: "wallet_policy" })).resolves.toEqual([
      created,
    ])

    const updated = await service.update(
      { ...policy, maxNativeValue: "50" },
      1,
      "2026-09-01T04:01:00.000Z"
    )
    expect(updated).toMatchObject({ policy: { maxNativeValue: "50" }, revision: 2 })
    await expect(
      service.update({ ...policy, maxNativeValue: "25" }, 1, timestamp)
    ).resolves.toBeUndefined()

    await wallets.delete("wallet_policy")
    await expect(service.list()).resolves.toEqual([])
    database.close()
  })
})
