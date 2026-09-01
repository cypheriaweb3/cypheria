import { defaultEvmHdDerivationScheme, type Wallet } from "@cypheria/wallet-core"
import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { ensureDatabaseSchema } from "./migrations.js"
import { chainAccounts, walletAccounts, walletHdSchemes } from "./schema.js"
import { createWalletPublicStatePersistenceService, type WalletPublicState } from "./wallet.js"

const timestamp = "2026-09-01T00:00:00.000Z"
const fingerprint = `sha256:${"1".repeat(64)}` as const

const hdState = {
  accounts: [
    {
      createdAt: timestamp,
      fingerprint,
      id: "account_primary",
      index: 0,
      name: "Account 1",
      updatedAt: timestamp,
      walletId: "wallet_hd",
    },
  ],
  chainAccounts: [
    {
      address: "0x0000000000000000000000000000000000000001",
      chainId: 1,
      createdAt: timestamp,
      derivationPath: "m/44'/60'/0'/0/0",
      id: "chain_account_mainnet",
      namespace: "eip155",
      publicKey: "0x02",
      updatedAt: timestamp,
      walletAccountId: "account_primary",
    },
  ],
  hdSchemes: [defaultEvmHdDerivationScheme("wallet_hd")],
  wallet: {
    createdAt: timestamp,
    fingerprint,
    id: "wallet_hd",
    kind: "hd",
    metadata: { notBackedUp: true },
    name: "Primary",
    provider: "local-vault",
    status: "initializing",
    updatedAt: timestamp,
    vaultId: "vault_hd",
  },
} satisfies WalletPublicState

describe("wallet public-state persistence", () => {
  it("round-trips an HD wallet graph and exposes recovery states", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
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
    await ensureDatabaseSchema(database.client)
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
    await ensureDatabaseSchema(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)
    await service.create(hdState)
    const context = {
      chainAccountId: "chain_account_mainnet",
      mode: "human-approval",
      updatedAt: timestamp,
      walletAccountId: "account_primary",
      walletId: "wallet_hd",
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

  it("enforces uniqueness and cascades wallet deletion", async () => {
    const database = createInMemoryDatabase()
    await ensureDatabaseSchema(database.client)
    const service = createWalletPublicStatePersistenceService(database.db)

    await service.create(hdState)
    await expect(
      service.create({
        accounts: [],
        chainAccounts: [],
        hdSchemes: [],
        wallet: {
          createdAt: timestamp,
          fingerprint,
          id: "wallet_watch",
          kind: "watch",
          metadata: {},
          name: "Watch",
          provider: "read-only",
          status: "ready",
          updatedAt: timestamp,
        },
      })
    ).rejects.toThrow()

    const duplicateAccountState = {
      accounts: [
        {
          createdAt: timestamp,
          fingerprint: `sha256:${"3".repeat(64)}` as const,
          id: "account_duplicate_1" as const,
          index: 0,
          name: "Duplicate",
          updatedAt: timestamp,
          walletId: "wallet_duplicate" as const,
        },
        {
          createdAt: timestamp,
          fingerprint: `sha256:${"4".repeat(64)}` as const,
          id: "account_duplicate_2" as const,
          index: 1,
          name: "Duplicate",
          updatedAt: timestamp,
          walletId: "wallet_duplicate" as const,
        },
      ],
      chainAccounts: [],
      hdSchemes: [defaultEvmHdDerivationScheme("wallet_duplicate")],
      wallet: {
        ...hdState.wallet,
        fingerprint: `sha256:${"2".repeat(64)}` as const,
        id: "wallet_duplicate" as const,
        name: "Duplicate account names",
        vaultId: "vault_duplicate" as const,
      },
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
