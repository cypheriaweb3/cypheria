import {
  bundledNetworkCatalog,
  type NetworkCatalogEntry,
  type NetworkCredentialRef,
  type NetworkDefinition,
  type NetworkId,
  networkCatalogEntrySchema,
  networkDefinitionSchema,
  networkIdSchema,
  type RpcEndpoint,
  type RpcEndpointId,
  rpcEndpointIdSchema,
  rpcEndpointSchema,
  timestampSchema,
  toChainKey,
} from "@cypheria/network-core"
import { normalizeDappOrigin } from "@cypheria/wallet-provider"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import type { CypheriaDatabase } from "./client.js"
import { dappNetworkContexts, networkRpcEndpoints, networks } from "./schema/index.js"

export type NetworkWithEndpoints = {
  readonly network: NetworkDefinition
  readonly endpoints: readonly RpcEndpoint[]
}

export type DappNetworkContext = {
  readonly origin: string
  readonly protocol: "eip155" | "solana"
  readonly networkId: NetworkId
  readonly updatedAt: string
}

export type CatalogReconciliationResult = {
  readonly insertedNetworks: number
  readonly updatedNetworks: number
  readonly insertedEndpoints: number
  readonly updatedEndpoints: number
  readonly deprecatedNetworks: number
  readonly deprecatedEndpoints: number
}

export type NetworkPersistenceService = {
  readonly reconcileCatalog: (
    catalog?: readonly NetworkCatalogEntry[],
    now?: string
  ) => Promise<CatalogReconciliationResult>
  readonly listNetworks: () => Promise<NetworkWithEndpoints[]>
  readonly getNetwork: (networkId: NetworkId) => Promise<NetworkWithEndpoints | undefined>
  readonly createNetwork: (
    network: NetworkDefinition,
    endpoints: readonly RpcEndpoint[]
  ) => Promise<NetworkWithEndpoints>
  readonly updateNetwork: (
    network: NetworkDefinition,
    expectedRevision: number
  ) => Promise<NetworkDefinition>
  readonly saveEndpoint: (endpoint: RpcEndpoint, expectedRevision?: number) => Promise<RpcEndpoint>
  readonly saveEndpoints: (endpoints: readonly RpcEndpoint[]) => Promise<readonly RpcEndpoint[]>
  readonly deleteEndpoint: (endpointId: RpcEndpointId) => Promise<NetworkCredentialRef | undefined>
  readonly removeCustomNetwork: (networkId: NetworkId) => Promise<NetworkCredentialRef[]>
  readonly getDappContext: (
    origin: string,
    protocol: DappNetworkContext["protocol"]
  ) => Promise<DappNetworkContext | undefined>
  readonly setDappContext: (context: DappNetworkContext) => Promise<DappNetworkContext>
  readonly clearDappContexts: (networkId: NetworkId) => Promise<void>
}

type NetworkRow = typeof networks.$inferSelect
type EndpointRow = typeof networkRpcEndpoints.$inferSelect

const fromNetworkRow = (row: NetworkRow): NetworkDefinition =>
  networkDefinitionSchema.parse({
    id: row.id,
    chain: { namespace: row.namespace, reference: row.reference },
    name: row.name,
    nativeCurrency: row.nativeCurrency,
    explorers: row.explorers,
    verification: row.verification,
    testnet: row.testnet,
    source: row.source,
    ...(row.catalogKey ? { catalogKey: row.catalogKey } : {}),
    enabled: row.enabled,
    deprecated: row.deprecated,
    position: row.position,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const toNetworkRow = (network: NetworkDefinition): typeof networks.$inferInsert => ({
  id: network.id,
  namespace: network.chain.namespace,
  reference: network.chain.reference,
  name: network.name,
  nativeCurrency: network.nativeCurrency,
  explorers: [...network.explorers],
  verification: network.verification,
  testnet: network.testnet,
  source: network.source,
  catalogKey: network.catalogKey ?? null,
  enabled: network.enabled,
  deprecated: network.deprecated,
  position: network.position,
  revision: network.revision,
  createdAt: network.createdAt,
  updatedAt: network.updatedAt,
})

const fromEndpointRow = (row: EndpointRow): RpcEndpoint =>
  rpcEndpointSchema.parse({
    id: row.id,
    networkId: row.networkId,
    label: row.label,
    transport: row.transport,
    connection:
      row.connectionKind === "public"
        ? { kind: "public", url: row.url }
        : {
            kind: "protected",
            displayUrl: row.displayUrl,
            credentialRef: row.credentialRef,
          },
    source: row.source,
    localDevelopment: row.localDevelopment,
    enabled: row.enabled,
    deprecated: row.deprecated,
    position: row.position,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const toEndpointRow = (endpoint: RpcEndpoint): typeof networkRpcEndpoints.$inferInsert => ({
  id: endpoint.id,
  networkId: endpoint.networkId,
  label: endpoint.label,
  transport: endpoint.transport,
  connectionKind: endpoint.connection.kind,
  url: endpoint.connection.kind === "public" ? endpoint.connection.url : null,
  displayUrl: endpoint.connection.kind === "protected" ? endpoint.connection.displayUrl : null,
  credentialRef:
    endpoint.connection.kind === "protected" ? endpoint.connection.credentialRef : null,
  source: endpoint.source,
  localDevelopment: endpoint.localDevelopment,
  enabled: endpoint.enabled,
  deprecated: endpoint.deprecated,
  position: endpoint.position,
  revision: endpoint.revision,
  createdAt: endpoint.createdAt,
  updatedAt: endpoint.updatedAt,
})

const stableIdPart = (value: string) => value.replaceAll("-", "_")
const catalogNetworkId = (entry: NetworkCatalogEntry): NetworkId =>
  networkIdSchema.parse(`network_${stableIdPart(entry.catalogKey)}`)
const catalogEndpointId = (entry: NetworkCatalogEntry, endpointKey: string): RpcEndpointId =>
  rpcEndpointIdSchema.parse(`rpc_${stableIdPart(entry.catalogKey)}_${stableIdPart(endpointKey)}`)

const parseContext = (context: DappNetworkContext): DappNetworkContext => ({
  origin: normalizeDappOrigin(context.origin),
  protocol: z.enum(["eip155", "solana"]).parse(context.protocol),
  networkId: networkIdSchema.parse(context.networkId),
  updatedAt: timestampSchema.parse(context.updatedAt),
})

const dappProtocolSchema = z.enum(["eip155", "solana"])

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const networkMatchesCatalog = (row: NetworkRow, entry: NetworkCatalogEntry): boolean =>
  row.name === entry.name &&
  row.testnet === entry.testnet &&
  !row.deprecated &&
  sameJson(row.nativeCurrency, entry.nativeCurrency) &&
  sameJson(row.explorers, entry.explorers) &&
  sameJson(row.verification, entry.verification)

const endpointMatchesCatalog = (
  row: EndpointRow,
  endpoint: NetworkCatalogEntry["endpoints"][number]
): boolean =>
  row.label === endpoint.label &&
  row.transport === endpoint.transport &&
  row.connectionKind === "public" &&
  row.url === endpoint.url &&
  !row.localDevelopment &&
  !row.deprecated

const loadNetwork = async (
  db: CypheriaDatabase,
  networkId: NetworkId
): Promise<NetworkWithEndpoints | undefined> => {
  const [row] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1)
  if (!row) return undefined
  const endpointRows = await db
    .select()
    .from(networkRpcEndpoints)
    .where(eq(networkRpcEndpoints.networkId, networkId))
    .orderBy(asc(networkRpcEndpoints.position), asc(networkRpcEndpoints.id))
  return { network: fromNetworkRow(row), endpoints: endpointRows.map(fromEndpointRow) }
}

export const createNetworkPersistenceService = (
  db: CypheriaDatabase
): NetworkPersistenceService => ({
  reconcileCatalog: async (
    catalogValue = bundledNetworkCatalog,
    nowValue = new Date().toISOString()
  ) => {
    const catalog = networkCatalogEntrySchema.array().parse(catalogValue)
    const now = timestampSchema.parse(nowValue)
    const existingNetworks = await db.select().from(networks)
    const existingEndpoints = await db.select().from(networkRpcEndpoints)
    const catalogKeys = new Set(catalog.map(({ catalogKey }) => catalogKey))
    const catalogEndpointIds = new Set<RpcEndpointId>()
    let nextNetworkPosition = Math.max(-1, ...existingNetworks.map(({ position }) => position)) + 1
    const result = {
      insertedNetworks: 0,
      updatedNetworks: 0,
      insertedEndpoints: 0,
      updatedEndpoints: 0,
      deprecatedNetworks: 0,
      deprecatedEndpoints: 0,
    }

    for (const entry of catalog) {
      const id = catalogNetworkId(entry)
      const existing = existingNetworks.find(({ catalogKey }) => catalogKey === entry.catalogKey)
      const network: NetworkDefinition = networkDefinitionSchema.parse({
        id,
        chain: entry.chain,
        name: entry.name,
        nativeCurrency: entry.nativeCurrency,
        explorers: entry.explorers,
        verification: entry.verification,
        testnet: entry.testnet,
        source: "builtin",
        catalogKey: entry.catalogKey,
        enabled: existing?.enabled ?? true,
        deprecated: false,
        position: existing?.position ?? nextNetworkPosition++,
        revision: existing
          ? existing.revision + (networkMatchesCatalog(existing, entry) ? 0 : 1)
          : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing && networkMatchesCatalog(existing, entry) ? existing.updatedAt : now,
      })
      if (existing) {
        if (
          existing.id !== id ||
          `${existing.namespace}:${existing.reference}` !== toChainKey(entry.chain)
        ) {
          throw new Error(`Catalog identity changed for ${entry.catalogKey}.`)
        }
        if (!networkMatchesCatalog(existing, entry)) {
          await db.update(networks).set(toNetworkRow(network)).where(eq(networks.id, id))
          result.updatedNetworks += 1
        }
      } else {
        await db.insert(networks).values(toNetworkRow(network))
        result.insertedNetworks += 1
      }

      let nextEndpointPosition =
        Math.max(
          -1,
          ...existingEndpoints
            .filter(({ networkId }) => networkId === id)
            .map(({ position }) => position)
        ) + 1
      for (const catalogEndpoint of entry.endpoints) {
        const endpointId = catalogEndpointId(entry, catalogEndpoint.key)
        catalogEndpointIds.add(endpointId)
        const current = existingEndpoints.find(({ id: value }) => value === endpointId)
        const endpoint = rpcEndpointSchema.parse({
          id: endpointId,
          networkId: id,
          label: catalogEndpoint.label,
          transport: catalogEndpoint.transport,
          connection: { kind: "public", url: catalogEndpoint.url },
          source: "builtin",
          localDevelopment: false,
          enabled: current?.enabled ?? true,
          deprecated: false,
          position: current?.position ?? nextEndpointPosition++,
          revision: current
            ? current.revision + (endpointMatchesCatalog(current, catalogEndpoint) ? 0 : 1)
            : 1,
          createdAt: current?.createdAt ?? now,
          updatedAt:
            current && endpointMatchesCatalog(current, catalogEndpoint) ? current.updatedAt : now,
        })
        if (current) {
          if (!endpointMatchesCatalog(current, catalogEndpoint)) {
            await db
              .update(networkRpcEndpoints)
              .set(toEndpointRow(endpoint))
              .where(eq(networkRpcEndpoints.id, endpointId))
            result.updatedEndpoints += 1
          }
        } else {
          await db.insert(networkRpcEndpoints).values(toEndpointRow(endpoint))
          result.insertedEndpoints += 1
        }
      }
    }

    for (const row of existingNetworks) {
      if (
        row.source === "builtin" &&
        row.catalogKey &&
        !catalogKeys.has(row.catalogKey) &&
        (!row.deprecated || row.enabled)
      ) {
        await db
          .update(networks)
          .set({ deprecated: true, enabled: false, revision: row.revision + 1, updatedAt: now })
          .where(eq(networks.id, row.id))
        result.deprecatedNetworks += 1
      }
    }
    for (const row of existingEndpoints) {
      if (
        row.source === "builtin" &&
        !catalogEndpointIds.has(row.id) &&
        (!row.deprecated || row.enabled)
      ) {
        await db
          .update(networkRpcEndpoints)
          .set({ deprecated: true, enabled: false, revision: row.revision + 1, updatedAt: now })
          .where(eq(networkRpcEndpoints.id, row.id))
        result.deprecatedEndpoints += 1
      }
    }
    return result
  },
  listNetworks: async () => {
    const rows = await db.select().from(networks).orderBy(asc(networks.position), asc(networks.id))
    const endpointRows = await db
      .select()
      .from(networkRpcEndpoints)
      .orderBy(asc(networkRpcEndpoints.position), asc(networkRpcEndpoints.id))
    return rows.map((row) => ({
      network: fromNetworkRow(row),
      endpoints: endpointRows.filter(({ networkId }) => networkId === row.id).map(fromEndpointRow),
    }))
  },
  getNetwork: (networkId) => loadNetwork(db, networkIdSchema.parse(networkId)),
  createNetwork: async (networkValue, endpointValues) => {
    const network = networkDefinitionSchema.parse(networkValue)
    const endpoints = endpointValues.map((endpoint) => rpcEndpointSchema.parse(endpoint))
    if (
      network.source !== "custom" ||
      endpoints.some(
        (endpoint) => endpoint.networkId !== network.id || endpoint.source !== "custom"
      ) ||
      new Set(endpoints.map(({ id }) => id)).size !== endpoints.length ||
      new Set(endpoints.map(({ position }) => position)).size !== endpoints.length
    ) {
      throw new Error("Custom network endpoints must belong to their network.")
    }
    await db.batch([
      db.insert(networks).values(toNetworkRow(network)),
      ...(endpoints.length > 0
        ? [db.insert(networkRpcEndpoints).values(endpoints.map(toEndpointRow))]
        : []),
    ] as const)
    return { network, endpoints }
  },
  updateNetwork: async (networkValue, expectedRevision) => {
    const network = networkDefinitionSchema.parse(networkValue)
    const [existing] = await db.select().from(networks).where(eq(networks.id, network.id)).limit(1)
    if (!existing) throw new Error("Network does not exist.")
    if (existing.revision !== expectedRevision || network.revision !== expectedRevision + 1) {
      throw new Error("NETWORK_REVISION_CONFLICT")
    }
    if (
      existing.namespace !== network.chain.namespace ||
      existing.reference !== network.chain.reference ||
      existing.source !== network.source ||
      existing.catalogKey !== (network.catalogKey ?? null)
    ) {
      throw new Error("Network identity and ownership are immutable.")
    }
    const [updated] = await db
      .update(networks)
      .set(toNetworkRow(network))
      .where(and(eq(networks.id, network.id), eq(networks.revision, expectedRevision)))
      .returning()
    if (!updated) throw new Error("NETWORK_REVISION_CONFLICT")
    return fromNetworkRow(updated)
  },
  saveEndpoint: async (endpointValue, expectedRevision) => {
    const endpoint = rpcEndpointSchema.parse(endpointValue)
    const [network] = await db
      .select({ id: networks.id })
      .from(networks)
      .where(eq(networks.id, endpoint.networkId))
      .limit(1)
    if (!network) throw new Error("Network does not exist.")
    const [existing] = await db
      .select()
      .from(networkRpcEndpoints)
      .where(eq(networkRpcEndpoints.id, endpoint.id))
      .limit(1)
    if (existing) {
      if (
        expectedRevision === undefined ||
        existing.revision !== expectedRevision ||
        endpoint.revision !== expectedRevision + 1
      ) {
        throw new Error("NETWORK_REVISION_CONFLICT")
      }
      if (existing.networkId !== endpoint.networkId || existing.source !== endpoint.source) {
        throw new Error("Endpoint ownership is immutable.")
      }
      const [updated] = await db
        .update(networkRpcEndpoints)
        .set(toEndpointRow(endpoint))
        .where(
          and(
            eq(networkRpcEndpoints.id, endpoint.id),
            eq(networkRpcEndpoints.revision, expectedRevision)
          )
        )
        .returning()
      if (!updated) throw new Error("NETWORK_REVISION_CONFLICT")
      return fromEndpointRow(updated)
    }
    if (expectedRevision !== undefined || endpoint.revision !== 1 || endpoint.source !== "custom") {
      throw new Error("NETWORK_REVISION_CONFLICT")
    }
    const [inserted] = await db
      .insert(networkRpcEndpoints)
      .values(toEndpointRow(endpoint))
      .returning()
    if (!inserted) throw new Error("Endpoint was not persisted.")
    return fromEndpointRow(inserted)
  },
  saveEndpoints: async (endpointValues) => {
    const endpoints = endpointValues.map((endpoint) => rpcEndpointSchema.parse(endpoint))
    if (
      endpoints.some((endpoint) => endpoint.source !== "custom" || endpoint.revision !== 1) ||
      new Set(endpoints.map(({ id }) => id)).size !== endpoints.length
    ) {
      throw new Error("Only new custom endpoints can be saved as a batch.")
    }
    if (endpoints.length === 0) return []
    const [first, ...rest] = endpoints.map((endpoint) =>
      db.insert(networkRpcEndpoints).values(toEndpointRow(endpoint))
    )
    if (!first) return []
    await db.batch([first, ...rest])
    return endpoints
  },
  deleteEndpoint: async (endpointIdValue) => {
    const endpointId = rpcEndpointIdSchema.parse(endpointIdValue)
    const [row] = await db
      .select()
      .from(networkRpcEndpoints)
      .where(eq(networkRpcEndpoints.id, endpointId))
      .limit(1)
    if (!row) return undefined
    if (row.source === "builtin") throw new Error("Built-in endpoints can only be disabled.")
    await db.delete(networkRpcEndpoints).where(eq(networkRpcEndpoints.id, endpointId))
    return row.credentialRef ?? undefined
  },
  removeCustomNetwork: async (networkIdValue) => {
    const networkId = networkIdSchema.parse(networkIdValue)
    const [network] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1)
    if (!network) return []
    if (network.source !== "custom") throw new Error("Built-in networks can only be disabled.")
    const refs = await db
      .select({ credentialRef: networkRpcEndpoints.credentialRef })
      .from(networkRpcEndpoints)
      .where(eq(networkRpcEndpoints.networkId, networkId))
    await db.delete(networks).where(eq(networks.id, networkId))
    return refs.flatMap(({ credentialRef }) => (credentialRef ? [credentialRef] : []))
  },
  getDappContext: async (originValue, protocolValue) => {
    const origin = normalizeDappOrigin(originValue)
    const protocol = dappProtocolSchema.parse(protocolValue)
    const [row] = await db
      .select()
      .from(dappNetworkContexts)
      .where(
        and(eq(dappNetworkContexts.origin, origin), eq(dappNetworkContexts.protocol, protocol))
      )
      .limit(1)
    return row ? parseContext(row) : undefined
  },
  setDappContext: async (contextValue) => {
    const context = parseContext(contextValue)
    const [network] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, context.networkId))
      .limit(1)
    if (!network?.enabled || network.deprecated) {
      throw new Error("NETWORK_DISABLED")
    }
    if (network.namespace !== context.protocol) {
      throw new Error("NETWORK_IDENTITY_MISMATCH")
    }
    await db
      .insert(dappNetworkContexts)
      .values(context)
      .onConflictDoUpdate({
        target: [dappNetworkContexts.origin, dappNetworkContexts.protocol],
        set: { networkId: context.networkId, updatedAt: context.updatedAt },
      })
    return context
  },
  clearDappContexts: async (networkIdValue) => {
    const networkId = networkIdSchema.parse(networkIdValue)
    await db.delete(dappNetworkContexts).where(eq(dappNetworkContexts.networkId, networkId))
  },
})
