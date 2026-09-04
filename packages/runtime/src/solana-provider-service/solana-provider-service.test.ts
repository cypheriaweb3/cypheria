import {
  applyDatabaseMigrations,
  createAuditLogService,
  createDappBrowserPersistenceService,
  createInMemoryDatabase,
  createWalletPublicStatePersistenceService,
  type SigningIntentRecord,
} from "@cypheria/db"
import { parseSigningIntent } from "@cypheria/wallet-core"
import {
  createDappSessionManager,
  createSolanaWallet,
  SolanaSignMessage,
  StandardConnect,
} from "@cypheria/wallet-provider"
import { describe, expect, it, vi } from "vitest"

import { createSolanaProviderRuntimeService } from "./service.js"

const timestamp = "2026-09-01T10:00:00.000Z"
const publicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
const account = {
  address: "11111111111111111111111111111111",
  chains: ["solana:mainnet" as const],
  features: [SolanaSignMessage] as const,
  publicKey,
}
const signingAccount = {
  address: account.address,
  chainAccountId: "chain_account_solana" as const,
  chainKey: "solana:mainnet" as const,
  protocol: "solana" as const,
  publicKey,
  walletAccountId: "account_solana" as const,
  walletId: "wallet_solana" as const,
}

describe("Solana provider runtime service", () => {
  it("persists connect permission and routes signing through an auditable intent", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await createWalletPublicStatePersistenceService(database.db).create({
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
      wallet: {
        createdAt: timestamp,
        fingerprint: `sha256:${"4".repeat(64)}`,
        id: signingAccount.walletId,
        kind: "watch",
        metadata: {},
        name: "Solana executor",
        status: "ready",
        updatedAt: timestamp,
      },
    })
    const persistence = createDappBrowserPersistenceService(database.db)
    const sessions = createDappSessionManager({ now: () => timestamp, persistence })
    const session = await sessions.open("https://sol.example/swap")
    let intentNumber = 0
    const created: SigningIntentRecord[] = []
    const service = createSolanaProviderRuntimeService({
      audit: createAuditLogService(database.db),
      executeSigningIntent: async (record) => {
        const payload = record.intent.kind === "solana-sign-message" ? record.intent.payload : ""
        return {
          signature:
            "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
          signatureType: "ed25519",
          signedMessage: payload,
        }
      },
      idFactory: { permissionId: () => "solana_permission_runtime" },
      now: () => timestamp,
      permissionAuthorizer: () => ({
        bindings: [{ account, mode: "human-approval", signingAccount }],
        walletId: signingAccount.walletId,
      }),
      persistence,
      sessions,
      signingIntents: {
        create: async (input) => {
          const intent = parseSigningIntent({
            ...input.intent,
            createdAt: timestamp,
            id: `signing_intent_solana_${++intentNumber}`,
          })
          const record: SigningIntentRecord = {
            approvalId: "approval_solana",
            decision: "require-human-approval",
            decisionId: "policy_decision_solana",
            expiresAt: "2026-09-01T10:05:00.000Z",
            intent,
            mode: input.mode,
            payloadHash: `sha256:${"5".repeat(64)}`,
            revision: 1,
            source: input.source,
            status: "pending-approval",
            updatedAt: timestamp,
          }
          created.push(record)
          return record
        },
      },
    })
    const wallet = createSolanaWallet({
      chains: ["solana:mainnet"],
      icon: "data:image/png;base64,AA==",
      name: "Cypheria",
      origin: session.origin,
      sessionKey: session.key,
      transport: service.handle,
    })

    const connected = await wallet.wallet.features[StandardConnect].connect()
    const connectedAccount = connected.accounts[0]
    if (!connectedAccount) throw new Error("Expected a connected Solana account.")
    const output = await wallet.wallet.features[SolanaSignMessage].signMessage({
      account: connectedAccount,
      message: new Uint8Array([1, 2, 3]),
    })
    expect(output[0]?.signature).toHaveLength(64)
    expect(created[0]?.intent).toMatchObject({
      chainKey: "solana:mainnet",
      kind: "solana-sign-message",
      origin: session.origin,
      payload: "AQID",
    })
    expect(await persistence.listSolanaPermissions(session.origin)).toHaveLength(1)
    expect(
      (await createAuditLogService(database.db).list()).map((entry) => entry.eventType)
    ).toContain("dapp.solana.permission.granted")
    database.close()
  })

  it("keeps silent connect non-interactive when no permission exists", async () => {
    const permissionAuthorizer = vi.fn()
    const service = createSolanaProviderRuntimeService({
      audit: { append: vi.fn(async (entry) => ({ ...entry, id: "audit_solana" })) },
      executeSigningIntent: vi.fn(),
      permissionAuthorizer,
      persistence: {
        listSolanaPermissions: async () => [],
        saveSolanaPermission: async (permission) => permission,
      },
      sessions: {
        validateRequest: async () => ({
          createdAt: timestamp,
          key: "cypheria:dapp:https://sol.example",
          origin: "https://sol.example",
          partition: "persist:cypheria:dapp:https://sol.example",
        }),
      },
      signingIntents: { create: vi.fn() },
    })
    await expect(
      service.handle({
        id: "solana_silent",
        input: { silent: true },
        method: StandardConnect,
        origin: "https://sol.example",
        sessionKey: "cypheria:dapp:https://sol.example",
      })
    ).resolves.toEqual({ id: "solana_silent", result: { accounts: [] } })
    expect(permissionAuthorizer).not.toHaveBeenCalled()
  })
})
