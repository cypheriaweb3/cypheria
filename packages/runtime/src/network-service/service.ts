import { randomUUID } from "node:crypto"
import type {
  AuditLogService,
  DappNetworkContext,
  NetworkPersistenceService,
  NetworkWithEndpoints,
} from "@cypheria/db"
import {
  type ChainKey,
  chainIdentitySchema,
  chainKeySchema,
  evmChainIdentityFromHex,
  type NetworkDefinition,
  type NetworkId,
  nativeCurrencySchema,
  networkDefinitionSchema,
  networkExplorerSchema,
  networkIdSchema,
  networkVerificationSchema,
  normalizeRpcUrl,
  projectRpcEndpoint,
  type RpcEndpoint,
  type RpcEndpointHealth,
  type RpcEndpointId,
  type RpcEndpointView,
  redactRpcUrl,
  rpcEndpointIdSchema,
  rpcEndpointSchema,
  timestampSchema,
  toChainKey,
} from "@cypheria/network-core"
import { z } from "zod"
import type { NetworkCredential, NetworkCredentialStore } from "../network-credentials/index.js"
import {
  assertRpcDestination,
  NetworkRuntimeError,
  type NetworkRuntimeErrorCode,
  type ResolveRpcAddresses,
} from "./destination.js"
import {
  createFetchRpcTransport,
  createWebSocketRpcTransport,
  type RpcTransport,
} from "./transport.js"

export type RpcPurpose = "read" | "simulate" | "broadcast" | "subscribe"

export type RpcRequest = {
  readonly method: string
  readonly params?: unknown
}

export type RpcRoutingOptions = {
  /** Keeps related calls on the same endpoint until that endpoint becomes unusable. */
  readonly operationKey?: string
}

export type NetworkView = {
  readonly network: NetworkDefinition
  readonly endpoints: readonly RpcEndpointView[]
}

export type NetworkRpcRouterOptions = {
  readonly credentials: NetworkCredentialStore
  readonly now?: () => string
  readonly persistence: Pick<NetworkPersistenceService, "getNetwork" | "listNetworks">
  readonly resolveAddresses?: ResolveRpcAddresses
  readonly timeoutMs?: number
  readonly transport?: RpcTransport
  readonly websocketTransport?: RpcTransport
}

type InternalEndpointHealth = RpcEndpointHealth & { readonly cooldownUntil?: number }

const emptyHealth = (): InternalEndpointHealth => ({
  state: "unknown",
  consecutiveFailures: 0,
})

const endpointUrl = async (
  endpoint: RpcEndpoint,
  credentials: NetworkCredentialStore
): Promise<NetworkCredential> => {
  if (endpoint.connection.kind === "public") return { url: endpoint.connection.url }
  const credential = await credentials.get(endpoint.connection.credentialRef)
  if (!credential) {
    throw new NetworkRuntimeError(
      "RPC_ENDPOINT_UNAVAILABLE",
      "The protected RPC credential is unavailable."
    )
  }
  return credential
}

export class NetworkRpcRouter {
  readonly #chainEpochs = new Map<ChainKey, number>()
  readonly #credentials: NetworkCredentialStore
  readonly #health = new Map<RpcEndpointId, InternalEndpointHealth>()
  readonly #operationEndpoints = new Map<string, RpcEndpointId>()
  readonly #now: () => string
  readonly #persistence: NetworkRpcRouterOptions["persistence"]
  readonly #resolveAddresses?: ResolveRpcAddresses
  readonly #timeoutMs: number
  readonly #transport: RpcTransport
  readonly #websocketTransport: RpcTransport

  constructor(options: NetworkRpcRouterOptions) {
    this.#credentials = options.credentials
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#persistence = options.persistence
    this.#resolveAddresses = options.resolveAddresses
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#transport = options.transport ?? createFetchRpcTransport()
    this.#websocketTransport = options.websocketTransport ?? createWebSocketRpcTransport()
  }

  getHealth(endpointId: RpcEndpointId): RpcEndpointHealth {
    const { cooldownUntil: _, ...health } = this.#health.get(endpointId) ?? emptyHealth()
    return health
  }

  clearHealth(endpointIds: readonly RpcEndpointId[]): void {
    for (const endpointId of endpointIds) this.#health.delete(endpointId)
  }

  invalidateChain(chainKeyValue: ChainKey): void {
    const chainKey = chainKeySchema.parse(chainKeyValue)
    this.#chainEpochs.set(chainKey, (this.#chainEpochs.get(chainKey) ?? 0) + 1)
    this.#operationEndpoints.clear()
  }

  async #execute(endpoint: RpcEndpoint, request: RpcRequest): Promise<unknown> {
    const credential = await endpointUrl(endpoint, this.#credentials)
    await assertRpcDestination(
      credential.url,
      { localDevelopment: endpoint.localDevelopment },
      this.#resolveAddresses
    )
    return (endpoint.transport === "websocket" ? this.#websocketTransport : this.#transport)({
      url: credential.url,
      headers: credential.headers,
      method: request.method,
      params: request.params,
      timeoutMs: this.#timeoutMs,
    })
  }

  #markSuccess(endpoint: RpcEndpoint, observedChainKey?: ChainKey, latencyMs?: number): void {
    this.#health.set(endpoint.id, {
      state: "healthy",
      observedChainKey,
      latencyMs,
      lastSuccessAt: this.#now(),
      consecutiveFailures: 0,
    })
  }

  #markFailure(endpoint: RpcEndpoint): void {
    const current = this.#health.get(endpoint.id) ?? emptyHealth()
    const consecutiveFailures = current.consecutiveFailures + 1
    const cooldown = consecutiveFailures >= 3
    this.#health.set(endpoint.id, {
      ...current,
      state: cooldown ? "cooldown" : "degraded",
      lastFailureAt: this.#now(),
      consecutiveFailures,
      ...(cooldown ? { cooldownUntil: Date.now() + 30_000 } : {}),
    })
  }

  async probe(network: NetworkDefinition, endpoint: RpcEndpoint): Promise<RpcEndpointHealth> {
    const startedAt = performance.now()
    try {
      let observedChainKey: ChainKey
      if (network.chain.namespace === "eip155") {
        const chainId = await this.#execute(endpoint, { method: "eth_chainId" })
        if (typeof chainId !== "string") {
          throw new NetworkRuntimeError(
            "NETWORK_IDENTITY_MISMATCH",
            "The EVM RPC returned an invalid chain ID."
          )
        }
        observedChainKey = toChainKey(evmChainIdentityFromHex(chainId))
        if (observedChainKey !== toChainKey(network.chain)) {
          throw new NetworkRuntimeError(
            "NETWORK_IDENTITY_MISMATCH",
            "The EVM RPC chain ID does not match the network."
          )
        }
        await this.#execute(endpoint, { method: "eth_blockNumber" })
      } else {
        await this.#execute(endpoint, { method: "getVersion" })
        const genesisHash = await this.#execute(endpoint, { method: "getGenesisHash" })
        if (
          typeof genesisHash !== "string" ||
          network.verification.kind !== "solana-genesis-hash" ||
          genesisHash !== network.verification.genesisHash
        ) {
          throw new NetworkRuntimeError(
            "NETWORK_IDENTITY_MISMATCH",
            "The Solana RPC genesis hash does not match the network."
          )
        }
        observedChainKey = toChainKey(network.chain)
      }
      this.#markSuccess(endpoint, observedChainKey, performance.now() - startedAt)
      return this.getHealth(endpoint.id)
    } catch (error) {
      this.#markFailure(endpoint)
      throw error
    }
  }

  async request(
    chainKeyValue: ChainKey,
    purpose: RpcPurpose,
    request: RpcRequest,
    routing: RpcRoutingOptions = {}
  ): Promise<unknown> {
    const chainKey = chainKeySchema.parse(chainKeyValue)
    const requestEpoch = this.#chainEpochs.get(chainKey) ?? 0
    const networks = await this.#persistence.listNetworks()
    const entry = networks.find(({ network }) => toChainKey(network.chain) === chainKey)
    if (!entry) throw new NetworkRuntimeError("NETWORK_NOT_FOUND", "The network is not configured.")
    if (!entry.network.enabled || entry.network.deprecated) {
      throw new NetworkRuntimeError("NETWORK_DISABLED", "The network is disabled.")
    }
    const transport = purpose === "subscribe" ? "websocket" : "http"
    const endpoints = entry.endpoints
      .filter(
        (endpoint) => endpoint.enabled && !endpoint.deprecated && endpoint.transport === transport
      )
      .sort((left, right) => {
        const stickyEndpointId = routing.operationKey
          ? this.#operationEndpoints.get(routing.operationKey)
          : undefined
        const stickyOrder =
          Number(right.id === stickyEndpointId) - Number(left.id === stickyEndpointId)
        if (stickyOrder !== 0) return stickyOrder
        const leftCooldown = this.#health.get(left.id)?.cooldownUntil ?? 0
        const rightCooldown = this.#health.get(right.id)?.cooldownUntil ?? 0
        const now = Date.now()
        return (
          Number(leftCooldown > now) - Number(rightCooldown > now) || left.position - right.position
        )
      })
    if (endpoints.length === 0) {
      throw new NetworkRuntimeError(
        "RPC_ENDPOINT_UNAVAILABLE",
        "No compatible RPC endpoint is enabled."
      )
    }

    let lastError: unknown
    for (const [index, endpoint] of endpoints.entries()) {
      let failureRecorded = false
      try {
        const health = this.#health.get(endpoint.id)
        if (health?.state !== "healthy" || health.observedChainKey !== chainKey) {
          try {
            await this.probe(entry.network, endpoint)
          } catch (error) {
            failureRecorded = true
            throw error
          }
        }
        const result = await this.#execute(endpoint, request)
        if ((this.#chainEpochs.get(chainKey) ?? 0) !== requestEpoch) {
          throw new NetworkRuntimeError("NETWORK_DISABLED", "The network became unavailable.")
        }
        this.#markSuccess(endpoint, chainKey)
        if (routing.operationKey) this.#operationEndpoints.set(routing.operationKey, endpoint.id)
        return result
      } catch (error) {
        // probe() records its own failure; request failures are recorded here.
        if (!failureRecorded) this.#markFailure(endpoint)
        lastError = error
        if (purpose === "broadcast") {
          if (error instanceof NetworkRuntimeError && !error.retryable) throw error
          throw new NetworkRuntimeError(
            "RPC_BROADCAST_INDETERMINATE",
            "The broadcast outcome is indeterminate and was not retried."
          )
        }
        if (
          !(error instanceof NetworkRuntimeError) ||
          !error.retryable ||
          index === endpoints.length - 1
        ) {
          throw error
        }
      }
    }
    throw lastError
  }
}

export const createRpcEndpointInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    transport: z.enum(["http", "websocket"]),
    url: z.url(),
    headers: z.record(z.string().min(1), z.string()).optional(),
    localDevelopment: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict()

export const createNetworkInputSchema = z
  .object({
    chain: chainIdentitySchema,
    name: z.string().trim().min(1).max(80),
    nativeCurrency: nativeCurrencySchema,
    explorers: z.array(networkExplorerSchema).max(8),
    verification: networkVerificationSchema,
    testnet: z.boolean(),
    enabled: z.boolean().default(true),
    endpoints: z.array(createRpcEndpointInputSchema).min(1),
  })
  .strict()

export type CreateRpcEndpointInput = z.input<typeof createRpcEndpointInputSchema>
export type CreateNetworkInput = z.input<typeof createNetworkInputSchema>

export type NetworkLifecycleCoordinator = {
  readonly clearWorkspaceContext?: (networkId: NetworkId) => Promise<void>
  readonly failPendingWork?: (chainKey: ChainKey) => Promise<void>
  readonly pauseAutomations?: (chainKey: ChainKey) => Promise<void>
  readonly revokeDappGrants?: (networkId: NetworkId, chainKey: ChainKey) => Promise<void>
}

export type NetworkManagerOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly credentials: NetworkCredentialStore
  readonly idFactory?: {
    readonly networkId: () => NetworkId
    readonly endpointId: () => RpcEndpointId
    readonly credentialRef: () => `network_credential_${string}`
  }
  readonly lifecycle?: NetworkLifecycleCoordinator
  readonly now?: () => string
  readonly persistence: NetworkPersistenceService
  readonly router: NetworkRpcRouter
}

export type NetworkManager = {
  readonly initialize: () => Promise<void>
  readonly list: () => Promise<NetworkView[]>
  readonly create: (
    input: CreateNetworkInput,
    beforeCommit?: (proposal: NetworkView) => Promise<boolean> | boolean
  ) => Promise<NetworkView>
  readonly setEnabled: (
    networkId: NetworkId,
    enabled: boolean,
    expectedRevision: number
  ) => Promise<NetworkDefinition>
  readonly addEndpoint: (
    networkId: NetworkId,
    input: CreateRpcEndpointInput
  ) => Promise<RpcEndpointView>
  readonly addEndpoints: (
    networkId: NetworkId,
    inputs: readonly CreateRpcEndpointInput[],
    beforeCommit?: (proposal: NetworkView) => Promise<boolean> | boolean
  ) => Promise<readonly RpcEndpointView[]>
  readonly probeEndpoint: (endpointId: RpcEndpointId) => Promise<RpcEndpointHealth>
  readonly setEndpointEnabled: (
    endpointId: RpcEndpointId,
    enabled: boolean,
    expectedRevision: number
  ) => Promise<RpcEndpointView>
  readonly reorderNetworks: (networkIds: readonly NetworkId[]) => Promise<void>
  readonly reorderEndpoints: (
    networkId: NetworkId,
    endpointIds: readonly RpcEndpointId[]
  ) => Promise<void>
  readonly removeEndpoint: (endpointId: RpcEndpointId) => Promise<void>
  readonly removeCustomNetwork: (networkId: NetworkId, confirmed: boolean) => Promise<void>
  readonly getDappContext: NetworkPersistenceService["getDappContext"]
  readonly setDappContext: (context: DappNetworkContext) => Promise<DappNetworkContext>
}

const defaultIds = {
  networkId: () => networkIdSchema.parse(`network_${randomUUID()}`),
  endpointId: () => rpcEndpointIdSchema.parse(`rpc_${randomUUID()}`),
  credentialRef: () => `network_credential_${randomUUID()}` as const,
}

const mapNetworkView = (router: NetworkRpcRouter, entry: NetworkWithEndpoints): NetworkView => ({
  network: entry.network,
  endpoints: entry.endpoints.map((endpoint) =>
    projectRpcEndpoint(endpoint, router.getHealth(endpoint.id))
  ),
})

export const createNetworkManager = (options: NetworkManagerOptions): NetworkManager => {
  const ids = options.idFactory ?? defaultIds
  const now = options.now ?? (() => new Date().toISOString())

  const audit = async (eventType: string, summary: string, correlationId: string) => {
    await options.audit.append({
      actor: "user",
      correlationId,
      eventType,
      payloadSummary: summary,
      source: "runtime.network-service",
    })
  }

  const createEndpoint = async (
    networkId: NetworkId,
    position: number,
    inputValue: CreateRpcEndpointInput
  ): Promise<RpcEndpoint> => {
    const input = createRpcEndpointInputSchema.parse(inputValue)
    const normalizedUrl = normalizeRpcUrl(input.url, {
      allowLoopbackDevelopment: input.localDevelopment,
      transport: input.transport,
    })
    const credentialRef = ids.credentialRef()
    await options.credentials.put(
      credentialRef,
      { url: normalizedUrl, ...(input.headers ? { headers: input.headers } : {}) },
      input.transport,
      { allowLoopbackDevelopment: input.localDevelopment }
    )
    const timestamp = timestampSchema.parse(now())
    return rpcEndpointSchema.parse({
      id: ids.endpointId(),
      networkId,
      label: input.label,
      transport: input.transport,
      connection: { kind: "protected", displayUrl: redactRpcUrl(normalizedUrl), credentialRef },
      source: "custom",
      localDevelopment: input.localDevelopment,
      enabled: input.enabled,
      deprecated: false,
      position,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  const addEndpoints = async (
    networkIdValue: NetworkId,
    inputs: readonly CreateRpcEndpointInput[],
    beforeCommit?: (proposal: NetworkView) => Promise<boolean> | boolean
  ): Promise<readonly RpcEndpointView[]> => {
    const networkId = networkIdSchema.parse(networkIdValue)
    const current = await options.persistence.getNetwork(networkId)
    if (!current) throw new NetworkRuntimeError("NETWORK_NOT_FOUND", "The network was not found.")
    const endpoints: RpcEndpoint[] = []
    try {
      for (const [offset, input] of inputs.entries()) {
        const endpoint = await createEndpoint(networkId, current.endpoints.length + offset, input)
        endpoints.push(endpoint)
        await options.router.probe(current.network, endpoint)
      }
      const proposal = mapNetworkView(options.router, {
        network: current.network,
        endpoints: [...current.endpoints, ...endpoints],
      })
      if (beforeCommit && !(await beforeCommit(proposal))) {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "User rejected the endpoint proposal.")
      }
      const saved = await options.persistence.saveEndpoints(endpoints)
      await audit("network.endpoints-added", `Added ${saved.length} RPC endpoint(s).`, networkId)
      return saved.map((endpoint) =>
        projectRpcEndpoint(endpoint, options.router.getHealth(endpoint.id))
      )
    } catch (error) {
      await Promise.all(
        endpoints.map((endpoint) =>
          endpoint.connection.kind === "protected"
            ? options.credentials.delete(endpoint.connection.credentialRef)
            : Promise.resolve()
        )
      )
      throw error
    }
  }

  return {
    initialize: async () => {
      await options.persistence.reconcileCatalog()
      const entries = await options.persistence.listNetworks()
      await Promise.allSettled(
        entries.flatMap(({ network, endpoints }) =>
          network.enabled && !network.deprecated
            ? endpoints
                .filter((endpoint) => endpoint.enabled && !endpoint.deprecated)
                .map((endpoint) => options.router.probe(network, endpoint))
            : []
        )
      )
    },
    list: async () =>
      (await options.persistence.listNetworks()).map((entry) =>
        mapNetworkView(options.router, entry)
      ),
    create: async (inputValue, beforeCommit) => {
      const input = createNetworkInputSchema.parse(inputValue)
      const { endpoints: endpointInputs, ...networkInput } = input
      const id = ids.networkId()
      const createdAt = timestampSchema.parse(now())
      const position = (await options.persistence.listNetworks()).length
      const network = networkDefinitionSchema.parse({
        ...networkInput,
        id,
        source: "custom",
        deprecated: false,
        position,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
      })
      const endpoints: RpcEndpoint[] = []
      try {
        for (const [endpointPosition, endpointInput] of endpointInputs.entries()) {
          const endpoint = await createEndpoint(id, endpointPosition, endpointInput)
          endpoints.push(endpoint)
          await options.router.probe(network, endpoint)
        }
        const proposal = mapNetworkView(options.router, { network, endpoints })
        if (beforeCommit && !(await beforeCommit(proposal))) {
          throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "User rejected the network proposal.")
        }
        const created = await options.persistence.createNetwork(network, endpoints)
        await audit("network.created", `Created ${toChainKey(network.chain)}.`, network.id)
        return mapNetworkView(options.router, created)
      } catch (error) {
        await Promise.all(
          endpoints.map((endpoint) =>
            endpoint.connection.kind === "protected"
              ? options.credentials.delete(endpoint.connection.credentialRef)
              : Promise.resolve()
          )
        )
        throw error
      }
    },
    setEnabled: async (networkIdValue, enabled, expectedRevision) => {
      const networkId = networkIdSchema.parse(networkIdValue)
      const current = await options.persistence.getNetwork(networkId)
      if (!current) throw new NetworkRuntimeError("NETWORK_NOT_FOUND", "The network was not found.")
      if (enabled && current.network.deprecated) {
        throw new NetworkRuntimeError("NETWORK_DISABLED", "A deprecated network cannot be enabled.")
      }
      if (enabled && !current.network.enabled) {
        const endpoints = current.endpoints.filter(
          (endpoint) => endpoint.enabled && !endpoint.deprecated && endpoint.transport === "http"
        )
        if (endpoints.length === 0) {
          throw new NetworkRuntimeError(
            "RPC_ENDPOINT_UNAVAILABLE",
            "The network has no enabled HTTP RPC endpoint."
          )
        }
        try {
          await Promise.any(
            endpoints.map((endpoint) => options.router.probe(current.network, endpoint))
          )
        } catch {
          throw new NetworkRuntimeError(
            "RPC_ENDPOINT_UNAVAILABLE",
            "No RPC endpoint passed the network identity probe."
          )
        }
      }
      const updated = await options.persistence.updateNetwork(
        {
          ...current.network,
          enabled,
          revision: expectedRevision + 1,
          updatedAt: timestampSchema.parse(now()),
        },
        expectedRevision
      )
      if (!enabled) {
        await options.persistence.clearDappContexts(networkId)
        await options.lifecycle?.clearWorkspaceContext?.(networkId)
        await options.lifecycle?.revokeDappGrants?.(networkId, toChainKey(updated.chain))
        await options.lifecycle?.pauseAutomations?.(toChainKey(updated.chain))
        await options.lifecycle?.failPendingWork?.(toChainKey(updated.chain))
      }
      await audit(
        enabled ? "network.enabled" : "network.disabled",
        `${enabled ? "Enabled" : "Disabled"} ${toChainKey(updated.chain)}.`,
        networkId
      )
      return updated
    },
    addEndpoint: async (networkIdValue, input) => {
      const [endpoint] = await addEndpoints(networkIdValue, [input])
      if (!endpoint) {
        throw new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "The RPC endpoint was not added.")
      }
      return endpoint
    },
    addEndpoints,
    probeEndpoint: async (endpointIdValue) => {
      const endpointId = rpcEndpointIdSchema.parse(endpointIdValue)
      const entry = (await options.persistence.listNetworks()).find(({ endpoints }) =>
        endpoints.some(({ id }) => id === endpointId)
      )
      const endpoint = entry?.endpoints.find(({ id }) => id === endpointId)
      if (!entry || !endpoint) {
        throw new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "The RPC endpoint was not found.")
      }
      return options.router.probe(entry.network, endpoint)
    },
    setEndpointEnabled: async (endpointIdValue, enabled, expectedRevision) => {
      const endpointId = rpcEndpointIdSchema.parse(endpointIdValue)
      const entry = (await options.persistence.listNetworks()).find(({ endpoints }) =>
        endpoints.some(({ id }) => id === endpointId)
      )
      const endpoint = entry?.endpoints.find(({ id }) => id === endpointId)
      if (!entry || !endpoint) {
        throw new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "The RPC endpoint was not found.")
      }
      if (
        !enabled &&
        entry.network.enabled &&
        endpoint.transport === "http" &&
        entry.endpoints.filter(
          (candidate) =>
            candidate.id !== endpoint.id &&
            candidate.transport === "http" &&
            candidate.enabled &&
            !candidate.deprecated
        ).length === 0
      ) {
        throw new NetworkRuntimeError(
          "RPC_ENDPOINT_UNAVAILABLE",
          "An enabled network must keep at least one HTTP RPC endpoint."
        )
      }
      if (enabled && !endpoint.enabled) {
        await options.router.probe(entry.network, endpoint)
      }
      const updated = await options.persistence.saveEndpoint(
        {
          ...endpoint,
          enabled,
          revision: expectedRevision + 1,
          updatedAt: timestampSchema.parse(now()),
        },
        expectedRevision
      )
      if (!enabled) options.router.clearHealth([endpointId])
      await audit(
        enabled ? "network.endpoint-enabled" : "network.endpoint-disabled",
        `${enabled ? "Enabled" : "Disabled"} RPC endpoint ${endpointId}.`,
        endpointId
      )
      return projectRpcEndpoint(updated, options.router.getHealth(endpointId))
    },
    reorderNetworks: async (networkIds) => {
      await options.persistence.reorderNetworks(networkIds, timestampSchema.parse(now()))
      await audit("network.reordered", "Reordered networks.", "network-order")
    },
    reorderEndpoints: async (networkId, endpointIds) => {
      await options.persistence.reorderEndpoints(
        networkIdSchema.parse(networkId),
        endpointIds,
        timestampSchema.parse(now())
      )
      await audit("network.endpoints-reordered", "Reordered RPC endpoints.", networkId)
    },
    removeEndpoint: async (endpointIdValue) => {
      const endpointId = rpcEndpointIdSchema.parse(endpointIdValue)
      const entry = (await options.persistence.listNetworks()).find(({ endpoints }) =>
        endpoints.some(({ id }) => id === endpointId)
      )
      const endpoint = entry?.endpoints.find(({ id }) => id === endpointId)
      if (!entry || !endpoint) {
        throw new NetworkRuntimeError("RPC_ENDPOINT_UNAVAILABLE", "The RPC endpoint was not found.")
      }
      if (
        entry.network.enabled &&
        endpoint.transport === "http" &&
        entry.endpoints.filter(
          (candidate) =>
            candidate.id !== endpoint.id &&
            candidate.transport === "http" &&
            candidate.enabled &&
            !candidate.deprecated
        ).length === 0
      ) {
        throw new NetworkRuntimeError(
          "RPC_ENDPOINT_UNAVAILABLE",
          "An enabled network must keep at least one HTTP RPC endpoint."
        )
      }
      const reference = await options.persistence.deleteEndpoint(endpointId)
      if (reference) await options.credentials.delete(reference)
      options.router.clearHealth([endpointId])
      await audit("network.endpoint-removed", `Removed RPC endpoint ${endpointId}.`, endpointId)
    },
    removeCustomNetwork: async (networkIdValue, confirmed) => {
      const networkId = networkIdSchema.parse(networkIdValue)
      if (!confirmed)
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "Confirmation is required.")
      const current = await options.persistence.getNetwork(networkId)
      if (!current) throw new NetworkRuntimeError("NETWORK_NOT_FOUND", "The network was not found.")
      if (current.network.source !== "custom") {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "Built-in networks cannot be removed.")
      }
      const chainKey = toChainKey(current.network.chain)
      await options.lifecycle?.clearWorkspaceContext?.(networkId)
      await options.lifecycle?.revokeDappGrants?.(networkId, chainKey)
      await options.lifecycle?.pauseAutomations?.(chainKey)
      await options.lifecycle?.failPendingWork?.(chainKey)
      const refs = await options.persistence.removeCustomNetwork(networkId)
      await Promise.all(refs.map((reference) => options.credentials.delete(reference)))
      options.router.clearHealth(current.endpoints.map(({ id }) => id))
      await audit("network.removed", `Removed connectivity for ${chainKey}.`, networkId)
    },
    getDappContext: options.persistence.getDappContext,
    setDappContext: async (context) => {
      const saved = await options.persistence.setDappContext(context)
      await audit(
        "network.dapp-context-selected",
        `Selected ${saved.networkId} for ${new URL(saved.origin).origin} (${saved.protocol}).`,
        saved.networkId
      )
      return saved
    },
  }
}

export { NetworkRuntimeError, type NetworkRuntimeErrorCode }
