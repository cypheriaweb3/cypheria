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
      wallet: {
        id: "wallet_browser",
        name: "Browser wallet",
        kind: "watch",
        fingerprint: `sha256:${"1".repeat(64)}`,
        metadata: {},
        status: "ready",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
    })
    const service = createDappBrowserPersistenceService(database.db)
    const session = createDappSession("https://app.example", timestamp)
    await expect(service.saveSession(session)).resolves.toEqual(session)

    const permission = {
      id: "dapp_permission_one",
      origin: session.origin,
      sessionKey: session.key,
      walletId: "wallet_browser" as const,
      chainKey: "eip155:1" as const,
      accountAddresses: ["0x0000000000000000000000000000000000000001"] as const,
      methods: ["eth_accounts", "personal_sign"] as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await expect(service.savePermission(permission)).resolves.toEqual(permission)
    await expect(service.listPermissions(session.origin)).resolves.toEqual([permission])

    const solanaPermission: SolanaProviderPermissionRecord = {
      id: "solana_permission_one",
      origin: session.origin,
      sessionKey: session.key,
      walletId: "wallet_browser" as const,
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
            chainKey: "solana:mainnet" as const,
            protocol: "solana" as const,
            publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            walletAccountId: "account_solana",
            walletId: "wallet_browser" as const,
          },
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await expect(service.saveSolanaPermission(solanaPermission)).resolves.toEqual(solanaPermission)
    await expect(service.listSolanaPermissions(session.origin)).resolves.toEqual([solanaPermission])
    await service.revokeChainPermissions("eip155:1")
    await expect(service.listPermissions(session.origin)).resolves.toEqual([])
    await expect(service.listSolanaPermissions(session.origin)).resolves.toEqual([solanaPermission])
    await service.revokeChainPermissions("solana:mainnet")
    await expect(service.listSolanaPermissions(session.origin)).resolves.toEqual([])
    database.close()
  })
})
