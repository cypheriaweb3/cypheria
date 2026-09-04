import {
  applyDatabaseMigrations,
  createAuditLogService,
  createDappBrowserPersistenceService,
  createInMemoryDatabase,
  createWalletPublicStatePersistenceService,
  type DappNetworkContext,
  type SigningIntentRecord,
} from "@cypheria/db"
import { parseSigningIntent, type SigningAccountRef } from "@cypheria/wallet-core"
import { createDappSessionManager, createProviderBridge } from "@cypheria/wallet-provider"
import { describe, expect, it, vi } from "vitest"

import { CypheriaRuntime } from "../index.js"
import type { NetworkView } from "../network-service/index.js"
import { createEthereumProviderRuntimeService } from "./service.js"

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
      chainKey: "eip155:1",
      walletAccountId: "account_browser",
      walletId: "wallet_browser",
    }
    const createdIntents: SigningIntentRecord[] = []
    const executeSigningIntent = vi.fn(async () => "0xsigned")
    let intentId = 0
    const service = createEthereumProviderRuntimeService({
      audit: createAuditLogService(database.db),
      dispatch: (request) => {
        if (request.method === "eth_chainId") return "0x1"
        if (request.method === "eth_call") return "0x"
        throw new Error("Unexpected non-signing request.")
      },
      executeSigningIntent,
      getActiveSigningContext: async () => ({ account, mode: "human-approval" }),
      idFactory: { permissionId: () => "dapp_permission_browser" },
      now: () => timestamp,
      permissionAuthorizer: ({ requestedMethods }) => ({
        accountAddresses: [address],
        chainKey: "eip155:1",
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
      chainKey: "eip155:1",
      origin: session.origin,
      sessionKey: session.key,
      transport: (request) => runtime.request("dapp.provider-request", request) as Promise<never>,
    })

    await expect(bridge.request({ method: "eth_chainId" })).resolves.toBe("0x1")
    await expect(
      bridge.request({
        method: "eth_call",
        params: [{ to: address }, "latest"],
      })
    ).resolves.toBe("0x")
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
    const service = createEthereumProviderRuntimeService({
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

  it("isolates network selection by origin and approves verified add and switch proposals", async () => {
    const origin = "https://network.example"
    const sessionKey = "cypheria:dapp:https://network.example" as const
    const network = (id: `network_${string}`, reference: string, name: string): NetworkView => ({
      endpoints: [],
      network: {
        chain: { namespace: "eip155" as const, reference },
        createdAt: timestamp,
        deprecated: false,
        enabled: true,
        explorers: [],
        id,
        name,
        nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
        position: 0,
        revision: 1,
        source: "custom" as const,
        testnet: false,
        updatedAt: timestamp,
        verification: { kind: "evm-chain-id" as const },
      },
    })
    const views: NetworkView[] = [
      network("network_mainnet", "1", "Ethereum"),
      network("network_sepolia", "11155111", "Sepolia"),
    ]
    let context: DappNetworkContext | undefined
    const approvals: unknown[] = []
    const rpcRequest = vi.fn(async () => "0x123")
    const service = createEthereumProviderRuntimeService({
      audit: { append: vi.fn(async (entry) => ({ ...entry, id: "audit_network" })) },
      executeSigningIntent: vi.fn(),
      getActiveSigningContext: async () => undefined,
      networkAuthorizer: async (approval) => {
        approvals.push(approval)
        return true
      },
      networks: {
        addEndpoints: vi.fn(async () => []),
        create: async (input, beforeCommit) => {
          const created = network("network_polygon", input.chain.reference, input.name)
          const proposal = {
            ...created,
            endpoints: input.endpoints.map((endpoint, index) => ({
              ...endpoint,
              connection: { displayUrl: endpoint.url, kind: "protected" as const },
              createdAt: timestamp,
              deprecated: false,
              enabled: endpoint.enabled ?? true,
              health: { consecutiveFailures: 0, state: "healthy" as const },
              id: `rpc_polygon_${index}` as const,
              networkId: created.network.id,
              localDevelopment: endpoint.localDevelopment ?? false,
              position: index,
              revision: 1,
              source: "custom" as const,
              updatedAt: timestamp,
            })),
          }
          if (beforeCommit && !(await beforeCommit(proposal))) throw new Error("rejected")
          views.push(proposal)
          return proposal
        },
        getDappContext: async () => context,
        list: async () => views,
        setDappContext: async (next) => {
          context = next
          return next
        },
      },
      permissionAuthorizer: () => undefined,
      persistence: { listPermissions: async () => [], savePermission: async (value) => value },
      router: { request: rpcRequest },
      sessions: {
        validateRequest: async () => ({
          createdAt: timestamp,
          key: sessionKey,
          origin,
          partition: "persist:network",
        }),
      },
      signingIntents: { create: vi.fn() },
    })

    await expect(
      service.handle({ id: 1, method: "eth_chainId", origin, sessionKey })
    ).resolves.toEqual({ id: 1, result: "0x1" })
    await expect(
      service.handle({ id: 2, method: "eth_blockNumber", origin, sessionKey })
    ).resolves.toEqual({ id: 2, result: "0x123" })
    expect(rpcRequest).toHaveBeenCalledWith(
      "eip155:1",
      "read",
      { method: "eth_blockNumber" },
      { operationKey: `${origin}:${sessionKey}` }
    )

    await expect(
      service.handle({
        id: 3,
        method: "wallet_switchEthereumChain",
        origin,
        params: [{ chainId: "0xaa36a7" }],
        sessionKey,
      })
    ).resolves.toEqual({ id: 3, result: null })
    expect(context?.networkId).toBe("network_sepolia")

    await expect(
      service.handle({
        id: 4,
        method: "wallet_addEthereumChain",
        origin,
        params: [
          {
            chainId: "0x89",
            chainName: "Polygon",
            nativeCurrency: { decimals: 18, name: "POL", symbol: "POL" },
            rpcUrls: ["https://polygon.example/rpc"],
          },
        ],
        sessionKey,
      })
    ).resolves.toEqual({ id: 4, result: null })
    expect(context?.networkId).toBe("network_polygon")
    expect(approvals).toHaveLength(2)
    expect(approvals[1]).toMatchObject({
      kind: "add",
      metadataChanges: ["chainId", "chainName", "nativeCurrency", "rpcUrls"],
    })
  })
})
