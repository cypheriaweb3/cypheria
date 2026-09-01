import {
  applyDatabaseMigrations,
  createAuditLogService,
  createDappBrowserPersistenceService,
  createInMemoryDatabase,
  createWalletPublicStatePersistenceService,
  type SigningIntentRecord,
} from "@cypheria/db"
import { parseSigningIntent, type SigningAccountRef } from "@cypheria/wallet-core"
import { createDappSessionManager, createProviderBridge } from "@cypheria/web3-browser"
import { describe, expect, it, vi } from "vitest"

import { CypheriaRuntime } from "../index.js"
import { createDappProviderRuntimeService } from "./service.js"

const timestamp = "2026-09-01T09:00:00.000Z"
const address = "0x0000000000000000000000000000000000000001" as const

describe("dApp provider runtime service", () => {
  it("routes isolated, permissioned signing requests through signing intents", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    await createWalletPublicStatePersistenceService(database.db).create({
      accounts: [],
      chainAccounts: [],
      hdSchemes: [],
      wallet: {
        createdAt: timestamp,
        fingerprint: `sha256:${"2".repeat(64)}`,
        id: "wallet_browser",
        kind: "watch",
        metadata: {},
        name: "Browser wallet",
        provider: "read-only",
        status: "ready",
        updatedAt: timestamp,
      },
    })
    const persistence = createDappBrowserPersistenceService(database.db)
    const sessions = createDappSessionManager({ now: () => timestamp, persistence })
    const session = await sessions.open("https://app.example/swap")
    const account: SigningAccountRef = {
      address,
      chainAccountId: "chain_account_browser",
      chainId: 1,
      walletAccountId: "account_browser",
      walletId: "wallet_browser",
    }
    const createdIntents: SigningIntentRecord[] = []
    const executeSigningIntent = vi.fn(async () => "0xsigned")
    let intentId = 0
    const service = createDappProviderRuntimeService({
      audit: createAuditLogService(database.db),
      dispatch: (request) => {
        if (request.method === "eth_chainId") return "0x1"
        throw new Error("Unexpected non-signing request.")
      },
      executeSigningIntent,
      getActiveSigningContext: async () => ({ account, mode: "human-approval" }),
      idFactory: { permissionId: () => "dapp_permission_browser" },
      now: () => timestamp,
      permissionAuthorizer: ({ requestedMethods }) => ({
        accountAddresses: [address],
        chainId: 1,
        methods: requestedMethods,
        walletId: account.walletId,
      }),
      persistence,
      sessions,
      signingIntents: {
        create: async (input) => {
          const intent = parseSigningIntent({
            ...input.intent,
            createdAt: timestamp,
            id: `signing_intent_browser_${++intentId}`,
          })
          const record: SigningIntentRecord = {
            approvalId: "approval_browser",
            decision: "require-human-approval",
            decisionId: "policy_decision_browser",
            expiresAt: "2026-09-01T09:05:00.000Z",
            intent,
            mode: input.mode,
            payloadHash: `sha256:${"3".repeat(64)}`,
            revision: 1,
            source: input.source,
            status: "pending-approval",
            updatedAt: timestamp,
          }
          createdIntents.push(record)
          return record
        },
      },
    })
    const runtime = new CypheriaRuntime({ ensureDirectories: false, services: [service] })
    await runtime.start()
    const bridge = createProviderBridge({
      chainId: 1,
      origin: session.origin,
      sessionKey: session.key,
      transport: (request) => runtime.request("dapp.provider-request", request) as Promise<never>,
    })

    await expect(bridge.request({ method: "eth_chainId" })).resolves.toBe("0x1")
    await expect(bridge.request({ method: "eth_accounts" })).resolves.toEqual([])
    await expect(bridge.request({ method: "eth_requestAccounts" })).resolves.toEqual([address])
    await expect(bridge.request({ method: "eth_accounts" })).resolves.toEqual([address])
    await expect(
      bridge.request({ method: "wallet_requestPermissions", params: [{ personal_sign: {} }] })
    ).resolves.toEqual([{ caveats: [], parentCapability: "personal_sign" }])
    await expect(bridge.request({ method: "eth_accounts" })).resolves.toEqual([address])
    await expect(
      bridge.request({ method: "personal_sign", params: ["hello", address] })
    ).resolves.toBe("0xsigned")

    expect(createdIntents).toHaveLength(1)
    expect(createdIntents[0]).toMatchObject({
      intent: { kind: "personal-sign", message: "hello", origin: session.origin },
      source: "dapp",
    })
    expect(executeSigningIntent).toHaveBeenCalledWith(createdIntents[0])
    expect(JSON.stringify(await createAuditLogService(database.db).list())).not.toContain("hello")
    await runtime.stop()
    database.close()
  })

  it("returns structured errors for denied permissions and spoofed sessions", async () => {
    const session = {
      createdAt: timestamp,
      key: "cypheria:dapp:https://app.example" as const,
      origin: "https://app.example",
      partition: "persist:cypheria:dapp:https://app.example",
    }
    const service = createDappProviderRuntimeService({
      audit: { append: vi.fn(async (entry) => ({ ...entry, id: "audit_one" })) },
      dispatch: () => "0x1",
      executeSigningIntent: async () => "unused",
      getActiveSigningContext: async () => undefined,
      permissionAuthorizer: () => undefined,
      persistence: { listPermissions: async () => [], savePermission: async (value) => value },
      sessions: {
        validateRequest: async (request) => {
          if (request.origin !== session.origin) throw new Error("spoofed")
          return session
        },
      },
      signingIntents: { create: async () => Promise.reject(new Error("unused")) },
    })
    await expect(
      service.handle({
        id: "request_denied",
        method: "eth_requestAccounts",
        origin: session.origin,
        sessionKey: session.key,
      })
    ).resolves.toMatchObject({ error: { code: 4001 } })
    await expect(
      service.handle({
        id: "request_spoofed",
        method: "eth_chainId",
        origin: "https://evil.example",
        sessionKey: "cypheria:dapp:https://evil.example",
      })
    ).resolves.toMatchObject({ error: { code: -32603 } })
  })
})
