import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAuditLogService,
  createInMemoryDatabase,
  createWalletPublicStatePersistenceService,
  type WalletPublicStatePersistenceService,
} from "@cypheria/db"
import { afterEach, describe, expect, it } from "vitest"

import {
  createMemoryVaultMasterKeyProvider,
  createWalletKeystoreCodec,
  createWalletVaultController,
  type WalletVaultController,
} from "../wallet-vault/index.js"
import { createWalletManager, WalletManagerError, type WalletManagerIdFactory } from "./service.js"

const mnemonic = "test test test test test test test test test test test junk"
const privateKey = `0x${"11".repeat(32)}` as const
const secondPrivateKey = `0x${"22".repeat(32)}` as const
const thirdPrivateKey = `0x${"33".repeat(32)}` as const
const timestamp = "2026-09-01T02:00:00.000Z"
const tempDirs: string[] = []

const makeVaultDir = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-manager-test-"))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const createIdFactory = (): WalletManagerIdFactory => {
  let account = 0
  let chainAccount = 0
  let entry = 0
  let vault = 0
  let wallet = 0
  return {
    chainAccountId: () => `chain_account_${++chainAccount}`,
    vaultEntryId: () => `vault_entry_${++entry}`,
    vaultId: () => `vault_${++vault}`,
    walletAccountId: () => `account_${++account}`,
    walletId: () => `wallet_${++wallet}`,
  }
}

const createTestVault = (vaultDir: string): WalletVaultController =>
  createWalletVaultController({
    codec: createWalletKeystoreCodec({ scryptN: 1024 }),
    keyProvider: createMemoryVaultMasterKeyProvider(new Uint8Array(32).fill(9)),
    vaultDir,
  })

const createHarness = async () => {
  const database = createInMemoryDatabase()
  await applyDatabaseMigrations(database.client)
  const vaultDir = await makeVaultDir()
  const persistence = createWalletPublicStatePersistenceService(database.db)
  const audit = createAuditLogService(database.db)
  const vault = createTestVault(vaultDir)
  const manager = createWalletManager({
    audit,
    chainIds: [1, 10],
    idFactory: createIdFactory(),
    mnemonicFactory: () => mnemonic,
    now: () => timestamp,
    persistence,
    vault,
  })
  return { audit, database, manager, persistence, vault, vaultDir }
}

describe("wallet manager", () => {
  it("publishes generated HD initialization before the vault is ready", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const persistence = createWalletPublicStatePersistenceService(database.db)
    const vaultDir = await makeVaultDir()
    const realVault = createTestVault(vaultDir)
    let releaseVault: (() => void) | undefined
    let markVaultStarted: (() => void) | undefined
    const vaultStarted = new Promise<void>((resolve) => {
      markVaultStarted = resolve
    })
    const vaultGate = new Promise<void>((resolve) => {
      releaseVault = resolve
    })
    const vault: WalletVaultController = {
      ...realVault,
      create: async (input) => {
        markVaultStarted?.()
        await vaultGate
        return realVault.create(input)
      },
    }
    const manager = createWalletManager({
      idFactory: createIdFactory(),
      mnemonicFactory: () => mnemonic,
      now: () => timestamp,
      persistence,
      vault,
    })

    const creating = manager.generateHdWallet({ name: "Primary" })
    await vaultStarted
    await expect(persistence.listWallets({ statuses: ["initializing"] })).resolves.toHaveLength(1)
    releaseVault?.()
    const view = await creating

    expect(view.wallet).toMatchObject({
      kind: "hd",
      metadata: { notBackedUp: true },
      status: "ready",
    })
    expect(view.accounts[0]?.chainAccounts[0]).toMatchObject({
      chainId: 1,
      derivationPath: "m/44'/60'/0'/0/0",
    })
    expect(JSON.stringify(view)).not.toContain(mnemonic)
    database.close()
  })

  it("imports local and watch wallets, detects duplicates, and never returns secrets", async () => {
    const { audit, database, manager } = await createHarness()

    const local = await manager.importPrivateKeyWallet({
      name: "Signer",
      privateKey,
    })
    const watch = await manager.addWatchWallet({
      address: local.accounts[0]?.chainAccounts[0]?.address ?? "",
      name: "Observe signer",
    })
    const importedHd = await manager.importHdWallet({
      mnemonic,
      name: "Imported HD",
      passphrase: "secret-passphrase",
    })
    const group = await manager.importPrivateKeyGroup({
      accounts: [
        { name: "Two", privateKey: secondPrivateKey },
        { name: "Three", privateKey: thirdPrivateKey },
      ],
      name: "Team",
    })
    const watchGroup = await manager.addWatchGroup({
      accounts: [
        {
          address: group.accounts[0]?.chainAccounts[0]?.address ?? "",
          name: "Observe two",
        },
        {
          address: group.accounts[1]?.chainAccounts[0]?.address ?? "",
          name: "Observe three",
        },
      ],
      name: "Observe team",
    })

    expect(local.accounts[0]?.chainAccounts).toHaveLength(2)
    expect(group.accounts).toHaveLength(2)
    expect(importedHd.wallet.kind).toBe("hd")
    expect(watch.wallet.kind).toBe("watch")
    expect(watchGroup.wallet.kind).toBe("watch-group")
    expect(JSON.stringify(await manager.listWallets())).not.toContain(privateKey)
    await expect(
      manager.importPrivateKeyWallet({ name: "Duplicate", privateKey })
    ).rejects.toMatchObject({ code: "DUPLICATE_WALLET" })
    await expect(
      manager.importPrivateKeyGroup({
        accounts: [{ name: "Duplicate group member", privateKey: secondPrivateKey }],
        name: "Duplicate team",
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_ACCOUNT" })
    await expect(
      manager.importHdWallet({
        expectedAddress: "0x0000000000000000000000000000000000000001",
        mnemonic,
        name: "Wrong expected address",
      })
    ).rejects.toMatchObject({ code: "ADDRESS_MISMATCH" })
    await expect(
      manager.addWatchWallet({
        address: "0x0000000000000000000000000000000000000002",
        name: "Unexpected field",
        unexpected: true,
      } as Parameters<typeof manager.addWatchWallet>[0])
    ).rejects.toThrow()

    expect(
      (await audit.list()).filter((event) => event.eventType === "wallet.imported")
    ).toHaveLength(3)
    database.close()
  })

  it("derives and reorders HD wallet accounts without changing their derivation paths", async () => {
    const { database, manager, vault } = await createHarness()
    const hd = await manager.generateHdWallet({ name: "Primary" })
    if (!("vaultId" in hd.wallet)) throw new Error("Expected an HD wallet vault.")

    await vault.unlock(hd.wallet.vaultId)
    const second = await manager.deriveHdAccount({ name: "Savings", walletId: hd.wallet.id })
    await vault.unlock(hd.wallet.vaultId)
    const third = await manager.deriveHdAccount({ name: "Operations", walletId: hd.wallet.id })

    expect(second.accounts[1]?.chainAccounts[0]?.derivationPath).toBe("m/44'/60'/0'/0/1")
    expect(third.accounts[2]?.chainAccounts[0]?.derivationPath).toBe("m/44'/60'/0'/0/2")
    await manager.reorderWalletAccounts(
      hd.wallet.id,
      third.accounts.map(({ account }) => account.id).toReversed()
    )
    const reordered = await manager.getWallet(hd.wallet.id)
    expect(reordered?.accounts.map(({ account }) => account.name)).toEqual([
      "Operations",
      "Savings",
      "Account 1",
    ])
    expect(
      reordered?.accounts.map(({ chainAccounts }) => chainAccounts[0]?.derivationPath)
    ).toEqual(["m/44'/60'/0'/0/2", "m/44'/60'/0'/0/1", "m/44'/60'/0'/0/0"])
    database.close()
  })

  it("persists active context, enforces watch mode, renames, and deletes", async () => {
    const { database, manager, persistence, vaultDir } = await createHarness()
    const local = await manager.importPrivateKeyWallet({ name: "Signer", privateKey })
    const watch = await manager.addWatchWallet({
      address: "0x0000000000000000000000000000000000000001",
      name: "Observe",
    })

    await expect(
      manager.setActiveContext({
        chainAccountId: watch.accounts[0]?.chainAccounts[0]?.id ?? "chain_account_missing",
        mode: "human-approval",
        walletAccountId: watch.accounts[0]?.account.id ?? "account_missing",
        walletId: watch.wallet.id,
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    const active = await manager.setActiveContext({
      chainAccountId: local.accounts[0]?.chainAccounts[1]?.id ?? "chain_account_missing",
      mode: "human-approval",
      walletAccountId: local.accounts[0]?.account.id ?? "account_missing",
      walletId: local.wallet.id,
    })
    expect(active).toMatchObject({
      chainAccount: { chainId: 10 },
      mode: "human-approval",
      wallet: { wallet: { id: local.wallet.id } },
    })
    await expect(manager.getActiveContext()).resolves.toMatchObject({
      wallet: { wallet: { id: local.wallet.id } },
    })

    const renamed = await manager.renameWallet(local.wallet.id, "Renamed")
    expect(renamed.wallet.name).toBe("Renamed")
    if (!("vaultId" in local.wallet)) {
      throw new Error("Expected a local wallet in the test fixture.")
    }
    const vaultFile = join(vaultDir, `${local.wallet.vaultId}.vault.json`)
    await manager.deleteWallet(local.wallet.id)
    await expect(manager.getWallet(local.wallet.id)).resolves.toBeUndefined()
    await expect(persistence.getActiveContext()).resolves.toBeUndefined()
    await expect(stat(vaultFile)).rejects.toMatchObject({ code: "ENOENT" })
    database.close()
  })

  it("persists imported HD secrets before public success and compensates DB failure", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const persistence = createWalletPublicStatePersistenceService(database.db)
    const vaultDir = await makeVaultDir()
    const vault = createTestVault(vaultDir)
    const failingPersistence: WalletPublicStatePersistenceService = {
      ...persistence,
      create: async () => {
        throw new Error("database unavailable")
      },
    }
    const manager = createWalletManager({
      idFactory: createIdFactory(),
      now: () => timestamp,
      persistence: failingPersistence,
      vault,
    })

    await expect(
      manager.importHdWallet({ mnemonic, name: "Imported", passphrase: "secret-passphrase" })
    ).rejects.toThrow("database unavailable")
    await expect(stat(join(vaultDir, "vault_1.vault.json"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(persistence.listWallets()).resolves.toEqual([])
    database.close()
  })

  it("retains a generated-wallet error state when vault initialization fails", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const persistence = createWalletPublicStatePersistenceService(database.db)
    const vaultDir = await makeVaultDir()
    const realVault = createTestVault(vaultDir)
    const manager = createWalletManager({
      idFactory: createIdFactory(),
      mnemonicFactory: () => mnemonic,
      now: () => timestamp,
      persistence,
      vault: {
        ...realVault,
        create: async () => {
          throw new Error(`must not expose ${mnemonic}`)
        },
      },
    })

    const error = await manager.generateHdWallet({ name: "Failed" }).catch((reason) => reason)
    expect(error).toBeInstanceOf(WalletManagerError)
    expect(error).toMatchObject({ code: "WALLET_CREATION_FAILED" })
    expect(String(error)).not.toContain(mnemonic)
    await expect(persistence.listWallets({ statuses: ["error"] })).resolves.toHaveLength(1)
    database.close()
  })
})
