import {
  applyDatabaseMigrations,
  createAuditLogService,
  createInMemoryDatabase,
  createNetworkPersistenceService,
  createSigningIntentPersistenceService,
  createSigningPolicyPersistenceService,
  createWalletPublicStatePersistenceService,
} from "@cypheria/db"
import { hexAddressSchema, type SigningAccountRef } from "@cypheria/wallet-core"
import { describe, expect, it } from "vitest"

import { createSigningPolicyRuntimeService } from "../policy-service/index.js"
import { createWalletManager } from "../wallet-manager/index.js"
import type { WalletVault } from "../wallet-vault/index.js"
import { createSigningIntentRuntimeService } from "./service.js"

const initialTime = "2026-09-01T06:00:00.000Z"

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

const createHarness = async () => {
  const database = createInMemoryDatabase()
  await applyDatabaseMigrations(database.client)
  const audit = createAuditLogService(database.db)
  const wallets = createWalletPublicStatePersistenceService(database.db)
  const networks = createNetworkPersistenceService(database.db)
  await networks.reconcileCatalog()
  const manager = createWalletManager({
    now: () => initialTime,
    networks,
    persistence: wallets,
    vault: unusedVault,
  })
  const wallet = await manager.addWatchWallet({
    address: "0x0000000000000000000000000000000000000001",
    name: "Approval wallet",
  })
  const walletAccount = wallet.accounts[0]
  const chainAccount = walletAccount?.chainAccounts[0]
  if (!walletAccount || !chainAccount || chainAccount.chain.namespace !== "eip155") {
    throw new Error("Expected an EVM wallet account fixture.")
  }
  const account: SigningAccountRef = {
    address: hexAddressSchema.parse(chainAccount.address),
    chainAccountId: chainAccount.id,
    chainKey: "eip155:1",
    walletAccountId: walletAccount.account.id,
    walletId: wallet.wallet.id,
  }
  let decisionSequence = 0
  const policies = createSigningPolicyRuntimeService({
    audit,
    idFactory: {
      decisionId: () => `policy_decision_${++decisionSequence}`,
      policyId: () => "policy_allow_personal_sign",
    },
    now: () => initialTime,
    persistence: createSigningPolicyPersistenceService(database.db),
    wallets,
  })
  let intentSequence = 0
  let approvalSequence = 0
  let currentTime = initialTime
  const service = createSigningIntentRuntimeService({
    audit,
    idFactory: {
      approvalId: () => `approval_${++approvalSequence}`,
      intentId: () => `signing_intent_${++intentSequence}`,
    },
    now: () => currentTime,
    persistence: createSigningIntentPersistenceService(database.db),
    policies,
  })
  return {
    account,
    audit,
    database,
    policies,
    service,
    setTime: (value: string) => {
      currentTime = value
    },
  }
}

const messageDraft = (account: SigningAccountRef, origin?: string) => ({
  account,
  correlationId: "request_one",
  kind: "personal-sign" as const,
  message: "hello",
  ...(origin ? { origin } : {}),
})

describe("signing intent runtime service", () => {
  it("evaluates and persists dApp, automation, and agent intents", async () => {
    const { account, audit, database, policies, service } = await createHarness()
    await policies.create({
      chainKeys: ["eip155:1"],
      methods: ["personal_sign"],
      origins: ["https://app.example"],
      walletId: account.walletId,
    })

    const dapp = await service.create({
      intent: messageDraft(account, "https://app.example"),
      mode: "conditional-auto-signing",
      source: "dapp",
    })
    expect(dapp).toMatchObject({ source: "dapp", status: "approved" })
    await expect(service.authorize(dapp.intent)).resolves.toMatchObject({ approved: true })
    await expect(service.get(dapp.intent.id)).resolves.toEqual(dapp)

    for (const source of ["automation", "agent"] as const) {
      const pending = await service.create({
        intent: messageDraft(account),
        mode: "human-approval",
        source,
      })
      expect(pending).toMatchObject({ source, status: "pending-approval" })
    }
    await expect(service.listApprovals("pending")).resolves.toHaveLength(2)

    const events = await audit.list()
    expect(events.filter((event) => event.eventType === "policy.decision")).toHaveLength(3)
    expect(events.filter((event) => event.eventType === "signing-intent.created")).toHaveLength(3)
    expect(JSON.stringify(events)).not.toContain("hello")
    database.close()
  })

  it("resolves approvals with revision checks and rejects modified payloads", async () => {
    const { account, database, service } = await createHarness()
    const pending = await service.create({
      intent: messageDraft(account),
      mode: "human-approval",
      source: "agent",
    })
    if (!pending.approvalId) throw new Error("Expected an approval fixture.")

    await expect(service.authorize(pending.intent)).resolves.toMatchObject({ approved: false })
    const resolved = await service.decide(pending.approvalId, {
      decision: "approved",
      expectedRevision: 1,
      reviewer: "user",
    })
    expect(resolved).toMatchObject({
      approval: { revision: 2, status: "approved" },
      intent: { revision: 2, status: "approved" },
    })
    await expect(service.authorize(pending.intent)).resolves.toMatchObject({ approved: true })
    if (pending.intent.kind !== "personal-sign") throw new Error("Expected a message intent.")
    await expect(
      service.authorize({ ...pending.intent, message: "modified" })
    ).rejects.toMatchObject({ code: "INTENT_MISMATCH" })
    await expect(
      service.decide(pending.approvalId, {
        decision: "rejected",
        expectedRevision: 1,
        reviewer: "user",
      })
    ).rejects.toMatchObject({ code: "APPROVAL_CONFLICT" })
    database.close()
  })

  it("expires pending approvals and strictly validates source context", async () => {
    const { account, audit, database, service, setTime } = await createHarness()
    await expect(
      service.create({
        intent: messageDraft(account),
        mode: "human-approval",
        source: "dapp",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })

    const pending = await service.create({
      expiresAt: "2026-09-01T06:01:00.000Z",
      intent: messageDraft(account),
      mode: "human-approval",
      source: "automation",
    })
    if (!pending.approvalId) throw new Error("Expected an approval fixture.")
    setTime("2026-09-01T06:02:00.000Z")
    const expired = await service.decide(pending.approvalId, {
      decision: "approved",
      expectedRevision: 1,
      reviewer: "user",
    })
    expect(expired).toMatchObject({
      approval: { status: "expired" },
      intent: { status: "expired" },
    })
    await expect(service.authorize(pending.intent)).resolves.toMatchObject({ approved: false })
    expect((await audit.list()).map((event) => event.eventType)).toContain("approval.expired")
    database.close()
  })
})
