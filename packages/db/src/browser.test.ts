import {
  createDappSession,
  type SolanaProviderPermissionRecord,
  SolanaSignMessage,
} from "@cypheria/wallet-provider"
import { describe, expect, it } from "vitest"

import { createDappBrowserPersistenceService } from "./browser.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createWalletPublicStatePersistenceService } from "./wallet.js"

const timestamp = "2026-09-01T08:00:00.000Z"

describe("dApp browser persistence", () => {
  it("persists isolated sessions and origin-scoped permissions", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await createWalletPublicStatePersistenceService(database.db).create({
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
      wallet: {
        createdAt: timestamp,
        fingerprint: `sha256:${"1".repeat(64)}`,
        id: "wallet_browser",
        kind: "watch",
        metadata: {},
        name: "Browser wallet",
        provider: "read-only",
        status: "ready",
        updatedAt: timestamp,
      },
    })
    const service = createDappBrowserPersistenceService(database.db)
    const session = createDappSession("https://app.example", timestamp)
    await expect(service.saveSession(session)).resolves.toEqual(session)

    const permission = {
      accountAddresses: ["0x0000000000000000000000000000000000000001"] as const,
      chainId: 1,
      createdAt: timestamp,
      id: "dapp_permission_one",
      methods: ["eth_accounts", "personal_sign"] as const,
      origin: session.origin,
      sessionKey: session.key,
      updatedAt: timestamp,
      walletId: "wallet_browser" as const,
    }
    await expect(service.savePermission(permission)).resolves.toEqual(permission)
    await expect(service.listPermissions(session.origin)).resolves.toEqual([permission])
    await expect(service.deletePermission(permission.id)).resolves.toBe(true)
    await expect(service.listPermissions(session.origin)).resolves.toEqual([])

    const solanaPermission: SolanaProviderPermissionRecord = {
      bindings: [
        {
          account: {
            address: "11111111111111111111111111111111",
            chains: ["solana:mainnet" as const],
            features: [SolanaSignMessage] as const,
            publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          },
          mode: "human-approval" as const,
          signingAccount: {
            address: "11111111111111111111111111111111",
            chainAccountId: "chain_account_solana",
            chainId: "solana:mainnet" as const,
            protocol: "solana" as const,
            publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            walletAccountId: "account_solana",
            walletId: "wallet_browser" as const,
          },
        },
      ],
      createdAt: timestamp,
      id: "solana_permission_one",
      origin: session.origin,
      sessionKey: session.key,
      updatedAt: timestamp,
      walletId: "wallet_browser" as const,
    }
    await expect(service.saveSolanaPermission(solanaPermission)).resolves.toEqual(solanaPermission)
    await expect(service.listSolanaPermissions(session.origin)).resolves.toEqual([solanaPermission])
    await expect(service.deleteSolanaPermission(solanaPermission.id)).resolves.toBe(true)
    await expect(service.listSolanaPermissions(session.origin)).resolves.toEqual([])
    database.close()
  })
})
