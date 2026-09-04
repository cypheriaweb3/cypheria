import {
  bundledNetworkCatalog,
  type NetworkDefinition,
  type RpcEndpoint,
} from "@cypheria/network-core"
import { createDappSession } from "@cypheria/wallet-provider"
import { describe, expect, it } from "vitest"
import { createDappBrowserPersistenceService } from "./browser.js"
import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createNetworkPersistenceService } from "./network.js"

const timestamp = "2026-09-04T00:00:00.000Z"

describe("network persistence", () => {
  it("reconciles the catalog without overwriting preferences or churning revisions", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const service = createNetworkPersistenceService(database.db)

    await expect(service.reconcileCatalog(bundledNetworkCatalog, timestamp)).resolves.toEqual({
      insertedNetworks: bundledNetworkCatalog.length,
      updatedNetworks: 0,
      insertedEndpoints: bundledNetworkCatalog.length,
      updatedEndpoints: 0,
      deprecatedNetworks: 0,
      deprecatedEndpoints: 0,
    })
    const [ethereum] = await service.listNetworks()
    if (!ethereum) throw new Error("Expected the bundled Ethereum network.")
    await service.updateNetwork(
      { ...ethereum.network, enabled: false, revision: 2, updatedAt: timestamp },
      1
    )

    await expect(service.reconcileCatalog(bundledNetworkCatalog, timestamp)).resolves.toEqual({
      insertedNetworks: 0,
      updatedNetworks: 0,
      insertedEndpoints: 0,
      updatedEndpoints: 0,
      deprecatedNetworks: 0,
      deprecatedEndpoints: 0,
    })
    expect((await service.getNetwork(ethereum.network.id))?.network.enabled).toBe(false)
    expect((await service.getNetwork(ethereum.network.id))?.network.revision).toBe(2)
    database.close()
  })

  it("clears network contexts but returns credential refs when a custom network is removed", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const browser = createDappBrowserPersistenceService(database.db)
    const session = createDappSession("https://app.example", timestamp)
    await browser.saveSession(session)
    const service = createNetworkPersistenceService(database.db)
    const network: NetworkDefinition = {
      id: "network_custom",
      chain: { namespace: "eip155", reference: "31337" },
      name: "Local development",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      explorers: [],
      testnet: true,
      source: "custom",
      enabled: true,
      deprecated: false,
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const endpoint: RpcEndpoint = {
      id: "rpc_custom",
      networkId: network.id,
      label: "Protected RPC",
      transport: "http",
      connection: {
        kind: "protected",
        displayUrl: "https://rpc.example/redacted",
        credentialRef: "network_credential_custom",
      },
      source: "custom",
      enabled: true,
      deprecated: false,
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await service.createNetwork(network, [endpoint])
    await service.setDappContext({
      origin: session.origin,
      protocol: "eip155",
      networkId: network.id,
      updatedAt: timestamp,
    })

    await expect(service.removeCustomNetwork(network.id)).resolves.toEqual([
      "network_credential_custom",
    ])
    await expect(service.getNetwork(network.id)).resolves.toBeUndefined()
    await expect(service.getDappContext(session.origin, "eip155")).resolves.toBeUndefined()
    database.close()
  })

  it("rejects a context whose protocol does not match the network identity", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const browser = createDappBrowserPersistenceService(database.db)
    const session = createDappSession("https://app.example", timestamp)
    await browser.saveSession(session)
    const service = createNetworkPersistenceService(database.db)
    await service.reconcileCatalog(bundledNetworkCatalog, timestamp)
    const ethereum = (await service.listNetworks()).find(
      ({ network }) => network.chain.namespace === "eip155"
    )
    if (!ethereum) throw new Error("Expected an EVM network.")

    await expect(
      service.setDappContext({
        origin: session.origin,
        protocol: "solana",
        networkId: ethereum.network.id,
        updatedAt: timestamp,
      })
    ).rejects.toThrow("NETWORK_IDENTITY_MISMATCH")
    database.close()
  })
})
