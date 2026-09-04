import { toChainKey } from "@cypheria/network-core"
import {
  type ChainAccount,
  defaultEvmHdDerivationScheme,
  type Wallet,
  type WalletAccount,
} from "@cypheria/wallet-core"
import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createNetworkPersistenceService } from "./network.js"
import { chainAccounts, walletAccounts, walletHdSchemes } from "./schema/index.js"
import { createWalletPublicStatePersistenceService, type WalletPublicState } from "./wallet.js"

const timestamp = "2026-09-01T00:00:00.000Z"
const fingerprint = `sha256:${"1".repeat(64)}` as const

const hdState = {
  wallet: {
    id: "wallet_hd",
    name: "Primary",
    kind: "hd",
    fingerprint,
    vaultId: "vault_hd",
    metadata: { notBackedUp: true },
    status: "initializing",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  accounts: [
    {
      id: "account_primary",
      walletId: "wallet_hd",
      index: 0,
      name: "Account 1",
      fingerprint,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  chainAccounts: [
    {
      id: "chain_account_mainnet",
      walletAccountId: "account_primary",
      chain: { namespace: "eip155", reference: "1" },
      address: "0x0000000000000000000000000000000000000001",
      publicKey: "0x02",
      derivationPath: "m/44'/60'/0'/0/0",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  hdSchemes: [defaultEvmHdDerivationScheme("wallet_hd")],
} satisfies WalletPublicState

describe("wallet public-state persistence", () => {
  it("round-trips an HD wallet graph and exposes recovery states", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)

    await expect(service.create(hdState)).resolves.toEqual(hdState)
    await expect(service.get(hdState.wallet.id)).resolves.toEqual(hdState)
    await expect(service.listWallets({ statuses: ["initializing"] })).resolves.toEqual([
      hdState.wallet,
    ])
    await expect(service.listWallets({ statuses: ["error"] })).resolves.toEqual([])

    const readyWallet = {
      ...hdState.wallet,
      metadata: { notBackedUp: false },
      status: "ready",
      updatedAt: "2026-09-01T00:01:00.000Z",
    } satisfies Wallet
    await expect(service.updateWallet(readyWallet)).resolves.toEqual(readyWallet)
    expect((await service.get(readyWallet.id))?.wallet).toEqual(readyWallet)

    database.close()
  })

  it("rejects secret material and inconsistent ownership before writing", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)

    const stateWithSecret = {
      ...hdState,
      wallet: { ...hdState.wallet, privateKey: `0x${"2".repeat(64)}` },
    } as unknown as WalletPublicState
    await expect(service.create(stateWithSecret)).rejects.toThrow()
    await expect(service.listWallets()).resolves.toEqual([])

    const inconsistentState = {
      ...hdState,
      accounts: [{ ...hdState.accounts[0], walletId: "wallet_other" }],
    } as WalletPublicState
    await expect(service.create(inconsistentState)).rejects.toThrow(
      "Every wallet account must belong to the persisted wallet."
    )
    await expect(service.listWallets()).resolves.toEqual([])

    database.close()
  })

  it("persists a validated active context and clears it through cascades", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)
    const networks = createNetworkPersistenceService(database.db)
    await networks.reconcileCatalog()
    const ethereum = (await networks.listNetworks()).find(
      ({ network }) => toChainKey(network.chain) === "eip155:1"
    )
    if (!ethereum) throw new Error("Ethereum catalog fixture is missing.")
    await service.create(hdState)
    const context = {
      walletId: "wallet_hd",
      walletAccountId: "account_primary",
      chainAccountId: "chain_account_mainnet",
      mode: "human-approval",
      networkId: ethereum.network.id,
      updatedAt: timestamp,
    } as const

    await expect(service.setActiveContext(context)).resolves.toEqual(context)
    await expect(service.getActiveContext()).resolves.toEqual(context)
    await expect(
      service.setActiveContext({ ...context, chainAccountId: "chain_account_missing" })
    ).rejects.toThrow("Active wallet context")

    await service.delete(hdState.wallet.id)
    await expect(service.getActiveContext()).resolves.toBeUndefined()
    database.close()
  })

  it("appends and reorders wallet accounts atomically", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)
    await service.create(hdState)
    const firstAccount = hdState.accounts[0]
    const firstChainAccount = hdState.chainAccounts[0]
    if (!firstAccount || !firstChainAccount) {
      throw new Error("HD fixture must include its primary account")
    }
    const secondAccount: WalletAccount = {
      ...firstAccount,
      fingerprint: `sha256:${"2".repeat(64)}` as const,
      id: "account_second",
      index: 1,
      name: "Account 2",
    }
    const secondChainAccount: ChainAccount = {
      ...firstChainAccount,
      address: "0x0000000000000000000000000000000000000002" as const,
      derivationPath: "m/44'/60'/0'/0/1",
      id: "chain_account_second",
      walletAccountId: secondAccount.id,
    }
    await service.addAccount(hdState.wallet.id, secondAccount, [secondChainAccount])
    await service.reorderWalletAccounts(hdState.wallet.id, [secondAccount.id, firstAccount.id])

    const reordered = await service.get(hdState.wallet.id)
    expect(reordered?.accounts.map(({ id, index }) => ({ id, index }))).toEqual([
      { id: secondAccount.id, index: 0 },
      { id: firstAccount.id, index: 1 },
    ])
    expect(reordered?.chainAccounts.find(({ id }) => id === secondChainAccount.id)).toMatchObject({
      derivationPath: "m/44'/60'/0'/0/1",
    })
    await expect(
      service.reorderWalletAccounts(hdState.wallet.id, [secondAccount.id])
    ).rejects.toThrow("every account")
    database.close()
  })

  it("persists wallet ordering and appends newly created wallets", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)
    const watchState = (suffix: string, fingerprintCharacter: string): WalletPublicState => ({
      wallet: {
        id: `wallet_${suffix}`,
        name: `Watch ${suffix}`,
        kind: "watch",
        fingerprint: `sha256:${fingerprintCharacter.repeat(64)}`,
        metadata: {},
        status: "ready",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
    })
    const first = watchState("first", "2")
    const second = watchState("second", "3")
    const third = watchState("third", "4")
    await service.create(first)
    await service.create(second)

    await service.reorderWallets([second.wallet.id, first.wallet.id])
    expect((await service.listWallets()).map(({ id }) => id)).toEqual([
      second.wallet.id,
      first.wallet.id,
    ])
    await expect(service.reorderWallets([first.wallet.id])).rejects.toThrow(
      "every persisted wallet"
    )

    await service.create(third)
    expect((await service.listWallets()).map(({ id }) => id)).toEqual([
      second.wallet.id,
      first.wallet.id,
      third.wallet.id,
    ])
    database.close()
  })

  it("enforces uniqueness and cascades wallet deletion", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)

    await service.create(hdState)
    await expect(
      service.create({
        wallet: {
          id: "wallet_watch",
          name: "Watch",
          kind: "watch",
          fingerprint,
          metadata: {},
          status: "ready",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        accounts: [],
        chainAccounts: [],
        hdSchemes: [],
      })
    ).rejects.toThrow()

    const duplicateAccountState = {
      wallet: {
        ...hdState.wallet,
        fingerprint: `sha256:${"2".repeat(64)}` as const,
        id: "wallet_duplicate" as const,
        name: "Duplicate account names",
        vaultId: "vault_duplicate" as const,
      },
      accounts: [
        {
          id: "account_duplicate_1" as const,
          walletId: "wallet_duplicate" as const,
          index: 0,
          name: "Duplicate",
          fingerprint: `sha256:${"3".repeat(64)}` as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "account_duplicate_2" as const,
          walletId: "wallet_duplicate" as const,
          index: 1,
          name: "Duplicate",
          fingerprint: `sha256:${"4".repeat(64)}` as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      chainAccounts: [],
      hdSchemes: [defaultEvmHdDerivationScheme("wallet_duplicate")],
    } satisfies WalletPublicState
    await expect(service.create(duplicateAccountState)).rejects.toThrow()
    await expect(service.get(duplicateAccountState.wallet.id)).resolves.toBeUndefined()

    await service.delete(hdState.wallet.id)
    await expect(service.get(hdState.wallet.id)).resolves.toBeUndefined()
    await expect(database.db.select().from(walletAccounts)).resolves.toEqual([])
    await expect(database.db.select().from(chainAccounts)).resolves.toEqual([])
    await expect(database.db.select().from(walletHdSchemes)).resolves.toEqual([])

    database.close()
  })
})
