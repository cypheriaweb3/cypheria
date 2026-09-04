import {
  applyDatabaseMigrations,
  createAuditLogService,
  createInMemoryDatabase,
  createNetworkPersistenceService,
} from "@cypheria/db"
import type { NetworkDefinition, RpcEndpoint } from "@cypheria/network-core"
import { describe, expect, it, vi } from "vitest"
import { createMemoryNetworkCredentialStore } from "../network-credentials/index.js"
import {
  assertRpcDestination,
  createFetchRpcTransport,
  createNetworkManager,
  NetworkRpcRouter,
  NetworkRuntimeError,
} from "./index.js"

const timestamp = "2026-09-04T00:00:00.000Z"

const network: NetworkDefinition = {
  id: "network_test",
  chain: { namespace: "eip155", reference: "1" },
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  explorers: [],
  verification: { kind: "evm-chain-id" },
  testnet: false,
  source: "custom",
  enabled: true,
  deprecated: false,
  position: 0,
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const endpoint = (id: `rpc_${string}`, position: number): RpcEndpoint => ({
  id,
  networkId: network.id,
  label: id,
  transport: "http",
  connection: { kind: "public", url: `https://${id}.example/` },
  source: "custom",
  localDevelopment: false,
  enabled: true,
  deprecated: false,
  position,
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
})

const persistence = (endpoints: readonly RpcEndpoint[]) => ({
  getNetwork: async () => ({ network, endpoints }),
  listNetworks: async () => [{ network, endpoints }],
})

describe("RPC destination policy", () => {
  it("rejects private DNS answers and permits explicit loopback development", async () => {
    await expect(
      assertRpcDestination("https://rpc.example", { localDevelopment: false }, async () => [
        "192.168.1.10",
      ])
    ).rejects.toMatchObject({ code: "RPC_DESTINATION_BLOCKED" })
    await expect(
      assertRpcDestination("http://localhost:8545", { localDevelopment: true }, async () => [
        "127.0.0.1",
      ])
    ).resolves.toBeInstanceOf(URL)
  })
})

describe("NetworkRpcRouter", () => {
  it("fails over retryable reads and keeps deterministic errors on one endpoint", async () => {
    const endpoints = [endpoint("rpc_first", 0), endpoint("rpc_second", 1)]
    const retryingTransport = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockRejectedValueOnce(
        new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "unavailable", true)
      )
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockResolvedValueOnce("0x10")
    const router = new NetworkRpcRouter({
      credentials: createMemoryNetworkCredentialStore(),
      persistence: persistence(endpoints),
      resolveAddresses: async () => ["8.8.8.8"],
      transport: retryingTransport,
    })
    await expect(router.request("eip155:1", "read", { method: "eth_blockNumber" })).resolves.toBe(
      "0x10"
    )
    expect(retryingTransport).toHaveBeenCalledTimes(6)

    const deterministicTransport = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockRejectedValue(new NetworkRuntimeError("RPC_REQUEST_FAILED", "invalid params"))
    const deterministicRouter = new NetworkRpcRouter({
      credentials: createMemoryNetworkCredentialStore(),
      persistence: persistence(endpoints),
      resolveAddresses: async () => ["8.8.8.8"],
      transport: deterministicTransport,
    })
    await expect(
      deterministicRouter.request("eip155:1", "read", { method: "eth_call" })
    ).rejects.toMatchObject({ code: "RPC_REQUEST_FAILED" })
    expect(deterministicTransport).toHaveBeenCalledTimes(3)
  })

  it("never retries an ambiguous broadcast", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockRejectedValue(new NetworkRuntimeError("RPC_REQUEST_TIMEOUT", "timeout", true))
    const router = new NetworkRpcRouter({
      credentials: createMemoryNetworkCredentialStore(),
      persistence: persistence([endpoint("rpc_first", 0), endpoint("rpc_second", 1)]),
      resolveAddresses: async () => ["8.8.8.8"],
      transport,
    })
    await expect(
      router.request("eip155:1", "broadcast", { method: "eth_sendRawTransaction" })
    ).rejects.toMatchObject({ code: "RPC_BROADCAST_INDETERMINATE" })
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it("keeps related requests on the endpoint that completed the operation", async () => {
    const endpoints = [endpoint("rpc_first", 0), endpoint("rpc_second", 1)]
    const transport = vi
      .fn()
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockRejectedValueOnce(
        new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "unavailable", true)
      )
      .mockResolvedValueOnce("0x1")
      .mockResolvedValueOnce("0x10")
      .mockResolvedValueOnce("0x20")
      .mockResolvedValueOnce("0x21")
    const router = new NetworkRpcRouter({
      credentials: createMemoryNetworkCredentialStore(),
      persistence: persistence(endpoints),
      resolveAddresses: async () => ["8.8.8.8"],
      transport,
    })

    await router.request(
      "eip155:1",
      "read",
      { method: "eth_blockNumber" },
      { operationKey: "sync-head" }
    )
    await router.request(
      "eip155:1",
      "read",
      { method: "eth_blockNumber" },
      { operationKey: "sync-head" }
    )

    expect(transport.mock.calls.at(-1)?.[0].url).toBe("https://rpc_second.example/")
  })

  it("probes the endpoint identity before marking it healthy", async () => {
    const transport = vi.fn().mockResolvedValueOnce("0x1").mockResolvedValueOnce("0x10")
    const rpcEndpoint = endpoint("rpc_probe", 0)
    const router = new NetworkRpcRouter({
      credentials: createMemoryNetworkCredentialStore(),
      persistence: persistence([rpcEndpoint]),
      resolveAddresses: async () => ["8.8.8.8"],
      transport,
    })
    await expect(router.probe(network, rpcEndpoint)).resolves.toMatchObject({
      state: "healthy",
      observedChainKey: "eip155:1",
    })
  })
})

describe("fetch RPC transport", () => {
  it("bounds concurrent requests", async () => {
    const releases: Array<() => void> = []
    const fetch = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(Response.json({ jsonrpc: "2.0", id: 1, result: "ok" })))
        })
    )
    const transport = createFetchRpcTransport({ fetch, maxConcurrentRequests: 1 })
    const request = {
      method: "eth_blockNumber",
      timeoutMs: 1_000,
      url: "https://rpc.example/",
    }

    const first = transport(request)
    const second = transport(request)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    releases.shift()?.()
    await first
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    releases.shift()?.()
    await second
  })
})

describe("NetworkManager", () => {
  it("creates verified networks and performs explicit lifecycle cleanup on removal", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const networkPersistence = createNetworkPersistenceService(database.db)
    const credentials = createMemoryNetworkCredentialStore()
    const lifecycle = {
      clearWorkspaceContext: vi.fn(async () => undefined),
      failPendingWork: vi.fn(async () => undefined),
      pauseAutomations: vi.fn(async () => undefined),
      revokeDappGrants: vi.fn(async () => undefined),
    }
    const transport = vi.fn().mockResolvedValueOnce("0x539").mockResolvedValueOnce("0x1")
    const router = new NetworkRpcRouter({
      credentials,
      persistence: networkPersistence,
      resolveAddresses: async () => ["8.8.8.8"],
      transport,
    })
    const manager = createNetworkManager({
      audit: createAuditLogService(database.db),
      credentials,
      idFactory: {
        networkId: () => "network_local",
        endpointId: () => "rpc_local",
        credentialRef: () => "network_credential_local",
      },
      lifecycle,
      now: () => timestamp,
      persistence: networkPersistence,
      router,
    })
    const created = await manager.create({
      chain: { namespace: "eip155", reference: "1337" },
      name: "Development",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      explorers: [],
      verification: { kind: "evm-chain-id" },
      testnet: true,
      enabled: true,
      endpoints: [{ label: "RPC", transport: "http", url: "https://rpc.example/project-key" }],
    })
    expect(created.endpoints[0]?.connection).toEqual({
      kind: "protected",
      displayUrl: "https://rpc.example/redacted",
    })
    await expect(credentials.get("network_credential_local")).resolves.toMatchObject({
      url: "https://rpc.example/project-key",
    })

    await manager.removeCustomNetwork(created.network.id, true)
    await expect(credentials.get("network_credential_local")).resolves.toBeUndefined()
    expect(lifecycle.pauseAutomations).toHaveBeenCalledWith("eip155:1337")
    expect(lifecycle.revokeDappGrants).toHaveBeenCalledWith("network_local", "eip155:1337")
    database.close()
  })
})
