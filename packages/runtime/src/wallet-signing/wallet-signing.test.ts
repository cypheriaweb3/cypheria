import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAuditLogService,
  createInMemoryDatabase,
  createSigningIntentReplayStore,
  createWalletPublicStatePersistenceService,
} from "@cypheria/db"
import type { SigningAccountRef, SigningIntent } from "@cypheria/wallet-core"
import { afterEach, describe, expect, it } from "vitest"

import { createWalletManager } from "../wallet-manager/index.js"
import {
  createMemoryVaultMasterKeyProvider,
  createWalletKeystoreCodec,
  createWalletVaultController,
} from "../wallet-vault/index.js"
import { createWalletSigningService } from "./service.js"

const privateKey = `0x${"11".repeat(32)}` as const
const mnemonic = "test test test test test test test test test test test junk"
const timestamp = "2026-09-01T03:00:00.000Z"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const createHarness = async () => {
  const database = createInMemoryDatabase()
  await applyDatabaseMigrations(database.client)
  const vaultDir = await mkdtemp(join(tmpdir(), "cypheria-signing-test-"))
  tempDirs.push(vaultDir)
  const audit = createAuditLogService(database.db)
  const persistence = createWalletPublicStatePersistenceService(database.db)
  const vault = createWalletVaultController({
    codec: createWalletKeystoreCodec({ scryptN: 1024 }),
    keyProvider: createMemoryVaultMasterKeyProvider(new Uint8Array(32).fill(7)),
    vaultDir,
  })
  const manager = createWalletManager({ audit, persistence, vault })
  return { audit, database, manager, persistence, vault }
}

const accountRef = (
  view: Awaited<ReturnType<ReturnType<typeof createWalletManager>["getWallet"]>>
): SigningAccountRef => {
  const walletAccount = view?.accounts[0]
  const chainAccount = walletAccount?.chainAccounts[0]
  if (!view || !walletAccount || !chainAccount) {
    throw new Error("Expected a wallet account fixture.")
  }
  return {
    address: chainAccount.address,
    chainAccountId: chainAccount.id,
    chainId: chainAccount.chainId,
    walletAccountId: walletAccount.account.id,
    walletId: view.wallet.id,
  }
}

const baseIntent = (account: SigningAccountRef, id: string) => ({
  account,
  correlationId: "request_1",
  createdAt: timestamp,
  id,
  origin: "https://app.example",
})

describe("wallet signing service", () => {
  it("signs each supported payload only after authorization and audits without secrets", async () => {
    const { audit, database, manager, persistence, vault } = await createHarness()
    const wallet = await manager.importPrivateKeyWallet({ name: "Signer", privateKey })
    if (!("vaultId" in wallet.wallet)) {
      throw new Error("Expected a local wallet fixture.")
    }
    await vault.unlock(wallet.wallet.vaultId)
    const account = accountRef(wallet)
    const authorized: string[] = []
    const service = createWalletSigningService({
      audit,
      authorize: (intent) => {
        authorized.push(intent.id)
        return {
          approved: true,
          decision: "allow",
          decisionId: `decision_${intent.id}`,
          matchedPolicyId: "policy_1",
        }
      },
      persistence,
      replayGuard: createSigningIntentReplayStore(database.db),
      vault,
    })
    const capability = await service.createCapability(account)

    const messageIntent = {
      ...baseIntent(account, "signing_intent_message"),
      kind: "personal-sign",
      message: "hello",
    } as const
    await expect(capability.signMessage(messageIntent)).resolves.toMatch(/^0x[0-9a-f]+$/u)
    await expect(
      capability.signTypedData({
        ...baseIntent(account, "signing_intent_typed"),
        domain: { chainId: 1, name: "Cypheria", version: "1" },
        kind: "typed-data",
        message: { contents: "hello" },
        primaryType: "Mail",
        types: { Mail: [{ name: "contents", type: "string" }] },
      })
    ).resolves.toMatch(/^0x[0-9a-f]+$/u)
    await expect(
      capability.signTransaction({
        ...baseIntent(account, "signing_intent_transaction"),
        kind: "sign-transaction",
        transaction: {
          chainId: 1,
          gas: 21_000n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
          nonce: 0,
          to: "0x0000000000000000000000000000000000000001",
          value: 1n,
        },
      })
    ).resolves.toMatch(/^0x02[0-9a-f]+$/u)

    expect(authorized).toEqual([
      "signing_intent_message",
      "signing_intent_typed",
      "signing_intent_transaction",
    ])
    await expect(capability.signMessage(messageIntent)).rejects.toMatchObject({
      code: "INTENT_REPLAY",
    })
    expect(JSON.stringify(capability)).not.toContain(privateKey)
    const events = await audit.list()
    expect(events.filter((event) => event.eventType === "policy.decision")).toHaveLength(4)
    expect(events.filter((event) => event.eventType === "wallet.signature.created")).toHaveLength(3)
    expect(JSON.stringify(events)).not.toContain(privateKey)
    expect(JSON.stringify(events)).not.toContain("hello")
    database.close()
  })

  it("supports HD secrets and lets a locked intent retry after unlock", async () => {
    const { audit, database, manager, persistence, vault } = await createHarness()
    const wallet = await manager.importHdWallet({ mnemonic, name: "HD" })
    if (!("vaultId" in wallet.wallet)) {
      throw new Error("Expected a local wallet fixture.")
    }
    const account = accountRef(wallet)
    const service = createWalletSigningService({
      audit,
      authorize: () => ({ approved: true, decision: "allow", decisionId: "decision_hd" }),
      persistence,
      replayGuard: createSigningIntentReplayStore(database.db),
      vault,
    })
    const capability = await service.createCapability(account)
    const intent = {
      ...baseIntent(account, "signing_intent_hd"),
      kind: "personal-sign",
      message: "HD message",
    } as const

    await expect(capability.signMessage(intent)).rejects.toMatchObject({ code: "VAULT_LOCKED" })
    await vault.unlock(wallet.wallet.vaultId)
    await expect(capability.signMessage(intent)).resolves.toMatch(/^0x[0-9a-f]+$/u)
    vault.lock(wallet.wallet.vaultId)
    await expect(
      capability.signMessage({ ...intent, id: "signing_intent_hd_locked_again" })
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" })
    database.close()
  })

  it("rejects policy denial, watch wallets, and vault/address inconsistency", async () => {
    const { audit, database, manager, persistence, vault } = await createHarness()
    const wallet = await manager.importPrivateKeyWallet({ name: "Signer", privateKey })
    const watch = await manager.addWatchWallet({
      address: "0x0000000000000000000000000000000000000001",
      name: "Watch",
    })
    const account = accountRef(wallet)
    const denied = createWalletSigningService({
      audit,
      authorize: () => ({ approved: false, decision: "deny", decisionId: "decision_denied" }),
      persistence,
      replayGuard: createSigningIntentReplayStore(database.db),
      vault,
    })
    await expect(denied.createCapability(accountRef(watch))).rejects.toMatchObject({
      code: "WATCH_ONLY",
    })
    if (!("vaultId" in wallet.wallet)) {
      throw new Error("Expected a local wallet fixture.")
    }
    await vault.unlock(wallet.wallet.vaultId)
    const deniedCapability = await denied.createCapability(account)
    const deniedIntent = {
      ...baseIntent(account, "signing_intent_denied"),
      kind: "personal-sign",
      message: "denied",
    } as const
    await expect(deniedCapability.signMessage(deniedIntent)).rejects.toMatchObject({
      code: "POLICY_REJECTED",
    })

    const changedAddress = "0x0000000000000000000000000000000000000002" as const
    await database.client.execute({
      args: [changedAddress, account.chainAccountId],
      sql: "UPDATE chain_accounts SET address = ? WHERE id = ?",
    })
    const changedAccount = { ...account, address: changedAddress }
    const allowed = createWalletSigningService({
      audit,
      authorize: () => ({ approved: true, decision: "allow", decisionId: "decision_allowed" }),
      persistence,
      replayGuard: createSigningIntentReplayStore(database.db),
      vault,
    })
    const changedCapability = await allowed.createCapability(changedAccount)
    const mismatchIntent: SigningIntent = {
      ...baseIntent(changedAccount, "signing_intent_mismatch"),
      kind: "personal-sign",
      message: "mismatch",
    }
    await expect(changedCapability.signMessage(mismatchIntent)).rejects.toMatchObject({
      code: "ADDRESS_MISMATCH",
    })
    database.close()
  })

  it("does not consume an intent while human approval is pending", async () => {
    const { audit, database, manager, persistence, vault } = await createHarness()
    const wallet = await manager.importPrivateKeyWallet({ name: "Signer", privateKey })
    if (!("vaultId" in wallet.wallet)) {
      throw new Error("Expected a local wallet fixture.")
    }
    await vault.unlock(wallet.wallet.vaultId)
    const account = accountRef(wallet)
    let approved = false
    const service = createWalletSigningService({
      audit,
      authorize: () => ({
        approvalId: "approval_pending",
        approved,
        decision: "require-human-approval",
        decisionId: "decision_pending",
      }),
      persistence,
      replayGuard: createSigningIntentReplayStore(database.db),
      vault,
    })
    const capability = await service.createCapability(account)
    const intent = {
      ...baseIntent(account, "signing_intent_pending_then_approved"),
      kind: "personal-sign",
      message: "approve me",
    } as const

    await expect(capability.signMessage(intent)).rejects.toMatchObject({ code: "POLICY_REJECTED" })
    approved = true
    await expect(capability.signMessage(intent)).resolves.toMatch(/^0x[0-9a-f]+$/u)
    await expect(capability.signMessage(intent)).rejects.toMatchObject({ code: "INTENT_REPLAY" })
    database.close()
  })
})
