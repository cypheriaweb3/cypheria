import {
  createAuditLogService,
  createInMemoryDatabase,
  createSigningPolicyPersistenceService,
  createWalletPublicStatePersistenceService,
  ensureDatabaseSchema,
} from "@cypheria/db"
import { describe, expect, it } from "vitest"

import { createWalletManager } from "../wallet-manager/index.js"
import type { WalletVault } from "../wallet-vault/index.js"
import { createSigningPolicyRuntimeService, SigningPolicyRuntimeError } from "./service.js"

const timestamp = "2026-09-01T04:00:00.000Z"

const unusedVault: WalletVault = {
  create: async () => {
    throw new Error("Not used by watch wallets.")
  },
  delete: async () => undefined,
  deleteEntry: async () => undefined,
  isUnlocked: () => false,
  lock: () => undefined,
  lockAll: () => undefined,
  putEntry: async () => undefined,
  recover: async () => ({ missingVaultIds: [], quarantined: [] }),
  unlock: async () => {
    throw new Error("Not used by watch wallets.")
  },
}

describe("signing policy runtime service", () => {
  it("creates, updates, disables, lists, and evaluates audited policies", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const audit = createAuditLogService(database.db)
    const wallets = createWalletPublicStatePersistenceService(database.db)
    const manager = createWalletManager({
      now: () => timestamp,
      persistence: wallets,
      vault: unusedVault,
    })
    const wallet = await manager.addWatchWallet({
      address: "0x0000000000000000000000000000000000000001",
      name: "Policy wallet",
    })
    let decision = 0
    const service = createSigningPolicyRuntimeService({
      audit,
      idFactory: {
        decisionId: () => `policy_decision_${++decision}`,
        policyId: () => "policy_generated",
      },
      now: () => timestamp,
      persistence: createSigningPolicyPersistenceService(database.db),
      wallets,
    })

    const created = await service.create({
      chainIds: [1],
      maxNativeValue: "100",
      methods: ["eth_sendTransaction"],
      origins: ["https://app.example"],
      walletId: wallet.wallet.id,
    })
    expect(created).toMatchObject({
      policy: { effect: "allow", enabled: true, id: "policy_generated" },
      revision: 1,
    })
    await expect(service.list({ walletId: wallet.wallet.id })).resolves.toEqual([created])
    await expect(service.get(created.policy.id)).resolves.toEqual(created)

    await expect(
      service.evaluate({
        chainId: 1,
        correlationId: "request_1",
        method: "eth_sendTransaction",
        mode: "conditional-auto-signing",
        nativeValue: "50",
        origin: "https://app.example",
        walletId: wallet.wallet.id,
      })
    ).resolves.toMatchObject({
      decision: "allow",
      decisionId: "policy_decision_1",
      matchedPolicyId: "policy_generated",
    })

    const updated = await service.update(created.policy.id, {
      expectedRevision: 1,
      maxNativeValue: "25",
      requireHumanApproval: true,
    })
    expect(updated).toMatchObject({
      policy: { maxNativeValue: "25", requireHumanApproval: true },
      revision: 2,
    })
    await expect(
      service.update(created.policy.id, { effect: "deny", expectedRevision: 1 })
    ).rejects.toMatchObject({ code: "POLICY_CONFLICT" })

    const disabled = await service.disable(created.policy.id, 2)
    expect(disabled).toMatchObject({ policy: { enabled: false }, revision: 3 })
    await expect(
      service.evaluate({
        chainId: 1,
        correlationId: "request_2",
        method: "eth_sendTransaction",
        mode: "conditional-auto-signing",
        nativeValue: "1",
        origin: "https://app.example",
        walletId: wallet.wallet.id,
      })
    ).resolves.toMatchObject({
      decision: "require-human-approval",
      decisionId: "policy_decision_2",
    })

    const events = await audit.list()
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "policy.created",
        "policy.updated",
        "policy.disabled",
        "policy.decision",
      ])
    )
    database.close()
  })

  it("rejects unknown wallets, duplicate ids, and unknown input fields", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const audit = createAuditLogService(database.db)
    const wallets = createWalletPublicStatePersistenceService(database.db)
    const manager = createWalletManager({ persistence: wallets, vault: unusedVault })
    const wallet = await manager.addWatchWallet({
      address: "0x0000000000000000000000000000000000000002",
      name: "Policy wallet",
    })
    const service = createSigningPolicyRuntimeService({
      audit,
      persistence: createSigningPolicyPersistenceService(database.db),
      wallets,
    })
    const input = {
      chainIds: [1],
      id: "policy_duplicate",
      methods: ["personal_sign"],
      origins: ["*"],
      walletId: wallet.wallet.id,
    }
    await service.create(input)
    await expect(service.create(input)).rejects.toBeInstanceOf(SigningPolicyRuntimeError)
    await expect(
      service.create({ ...input, id: "policy_unknown", walletId: "wallet_missing" })
    ).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" })
    await expect(
      service.list({ enabled: true, unexpected: true } as Parameters<typeof service.list>[0])
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    database.close()
  })
})
