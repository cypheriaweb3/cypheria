import { createHash, randomUUID } from "node:crypto"

import type { AuditLogService, SigningIntentRecord } from "@cypheria/db"
import {
  evmChainIdentityFromHex,
  evmChainIdentityToHex,
  evmChainIdentityToNumber,
  type NetworkDefinition,
  parseChainKey,
  toChainKey,
} from "@cypheria/network-core"
import type { SigningAccountRef, WalletMode } from "@cypheria/wallet-core"
import {
  DappSessionError,
  type DappSessionManager,
  dappPermissionRecordSchema,
  type EthereumProviderPermissionRecord,
  type EthereumProviderPersistence,
  ethereumReadOnlyMethods,
  type ProviderError,
  type ProviderMethod,
  type ProviderRequest,
  type ProviderResponse,
  providerRequestSchema,
} from "@cypheria/wallet-provider"
import { z } from "zod"

import type { RuntimeService } from "../index.js"
import {
  type CreateNetworkInput,
  type NetworkManager,
  type NetworkRpcRouter,
  NetworkRuntimeError,
  type NetworkView,
} from "../network-service/index.js"
import type { SigningIntentRuntimeService } from "../signing-intent-service/index.js"

export type EthereumPermissionGrant = {
  readonly accountAddresses: EthereumProviderPermissionRecord["accountAddresses"]
  readonly chainKey: EthereumProviderPermissionRecord["chainKey"]
  readonly expiresAt?: string
  readonly methods: readonly ProviderMethod[]
  readonly walletId: EthereumProviderPermissionRecord["walletId"]
}

/** @deprecated Use EthereumPermissionGrant. */
export type DappPermissionGrant = EthereumPermissionGrant

export type EthereumPermissionAuthorizer = (input: {
  readonly request: ProviderRequest<"eth_requestAccounts" | "wallet_requestPermissions">
  readonly requestedMethods: readonly ProviderMethod[]
}) => Promise<EthereumPermissionGrant | undefined> | EthereumPermissionGrant | undefined

export type EthereumNetworkApproval =
  | {
      readonly kind: "add"
      readonly origin: string
      readonly currentNetwork?: NetworkDefinition
      readonly proposal: NetworkView
      readonly metadataChanges: readonly string[]
    }
  | {
      readonly kind: "switch"
      readonly origin: string
      readonly currentNetwork?: NetworkDefinition
      readonly targetNetwork: NetworkDefinition
    }

export type EthereumNetworkAuthorizer = (
  approval: EthereumNetworkApproval
) => Promise<boolean> | boolean

/** @deprecated Use EthereumPermissionAuthorizer. */
export type DappPermissionAuthorizer = EthereumPermissionAuthorizer

export type ActiveEthereumSigningContext = {
  readonly account: SigningAccountRef
  readonly mode: WalletMode
}

/** @deprecated Use ActiveEthereumSigningContext. */
export type ActiveDappSigningContext = ActiveEthereumSigningContext

export type EthereumProviderRuntimeServiceOptions = {
  readonly audit: Pick<AuditLogService, "append">
  readonly dispatch?: (
    request: ProviderRequest,
    permission?: EthereumProviderPermissionRecord
  ) => Promise<unknown> | unknown
  readonly executeSigningIntent: (intent: SigningIntentRecord) => Promise<unknown>
  readonly getActiveSigningContext: () => Promise<ActiveEthereumSigningContext | undefined>
  readonly idFactory?: { readonly permissionId: () => string }
  readonly networkAuthorizer?: EthereumNetworkAuthorizer
  readonly networks?: Pick<
    NetworkManager,
    "addEndpoints" | "create" | "getDappContext" | "list" | "setDappContext"
  >
  readonly now?: () => string
  readonly permissionAuthorizer: EthereumPermissionAuthorizer
  readonly persistence: Pick<EthereumProviderPersistence, "listPermissions" | "savePermission">
  readonly sessions: Pick<DappSessionManager, "validateRequest">
  readonly signingIntents: Pick<SigningIntentRuntimeService, "create">
  readonly router?: Pick<NetworkRpcRouter, "request">
}

/** @deprecated Use EthereumProviderRuntimeServiceOptions. */
export type DappProviderRuntimeServiceOptions = EthereumProviderRuntimeServiceOptions

export type EthereumProviderRuntimeService = RuntimeService & {
  readonly handle: (request: unknown) => Promise<ProviderResponse>
}

/** @deprecated Use EthereumProviderRuntimeService. */
export type DappProviderRuntimeService = EthereumProviderRuntimeService

class DappProviderError extends Error {
  readonly error: ProviderError

  constructor(error: ProviderError) {
    super(error.message)
    this.name = "DappProviderError"
    this.error = error
  }
}

const denied = (message: string): DappProviderError =>
  new DappProviderError({ code: 4100, message })

const invalidParams = (message: string): DappProviderError =>
  new DappProviderError({ code: -32602, message })

const disconnected = (message: string): DappProviderError =>
  new DappProviderError({ code: 4900, message })

const chainUnavailable = (message: string): DappProviderError =>
  new DappProviderError({ code: 4901, message })

const unknownChain = (message: string): DappProviderError =>
  new DappProviderError({ code: 4902, message })

const isExpired = (permission: EthereumProviderPermissionRecord, now: string): boolean =>
  permission.expiresAt ? Date.parse(permission.expiresAt) <= Date.parse(now) : false

const requestedPermissionMethods = (request: ProviderRequest): ProviderMethod[] => {
  if (request.method === "eth_requestAccounts") {
    return ["eth_accounts", "eth_requestAccounts"]
  }
  const [capabilities] = z
    .tuple([z.record(z.string(), z.unknown())])
    .rest(z.never())
    .parse(request.params)
  const grantableMethods = new Set<string>([
    "eth_accounts",
    "eth_sendTransaction",
    "eth_signTypedData_v4",
    "personal_sign",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ])
  const keys = Object.keys(capabilities)
  if (keys.some((method) => !grantableMethods.has(method))) {
    throw invalidParams("An unsupported wallet permission was requested.")
  }
  const methods = keys as ProviderMethod[]
  if (methods.length === 0) throw invalidParams("No supported wallet permission was requested.")
  return methods
}

const parseHexQuantity = (value: unknown, field: string): bigint | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)) {
    throw invalidParams(`${field} must be a canonical hexadecimal quantity.`)
  }
  return BigInt(value)
}

const parseNonce = (value: unknown): number | undefined => {
  const quantity = parseHexQuantity(value, "nonce")
  if (quantity === undefined) return undefined
  const nonce = Number(quantity)
  if (!Number.isSafeInteger(nonce)) throw invalidParams("nonce is too large.")
  return nonce
}

const evmChainNumber = (chainKey: SigningAccountRef["chainKey"]): number => {
  const chain = parseChainKey(chainKey)
  if (chain.namespace !== "eip155") throw denied("The active account is not an EVM account.")
  return evmChainIdentityToNumber(chain)
}

const createSigningDraft = (request: ProviderRequest, context: ActiveDappSigningContext) => {
  const base = {
    account: context.account,
    correlationId: String(request.id),
    origin: request.origin,
  }
  if (request.method === "personal_sign") {
    const [message, address] = z.tuple([z.string(), z.string()]).parse(request.params)
    if (address.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested signing account is not active.")
    }
    return { ...base, kind: "personal-sign" as const, message }
  }
  if (request.method === "eth_signTypedData_v4") {
    const [address, serialized] = z.tuple([z.string(), z.string()]).parse(request.params)
    if (address.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested signing account is not active.")
    }
    const typedData = z
      .object({
        domain: z.unknown(),
        message: z.unknown(),
        primaryType: z.string().min(1),
        types: z.unknown(),
      })
      .parse(JSON.parse(serialized) as unknown)
    return { ...base, ...typedData, kind: "typed-data" as const }
  }
  if (request.method === "eth_sendTransaction") {
    const [transaction] = z
      .tuple([
        z
          .object({
            data: z
              .string()
              .regex(/^0x[0-9a-f]*$/iu)
              .optional(),
            from: z.string(),
            gas: z.unknown().optional(),
            maxFeePerGas: z.unknown().optional(),
            maxPriorityFeePerGas: z.unknown().optional(),
            nonce: z.unknown().optional(),
            to: z
              .string()
              .regex(/^0x[0-9a-f]{40}$/iu)
              .optional(),
            value: z.unknown().optional(),
          })
          .strict(),
      ])
      .parse(request.params)
    if (transaction.from.toLowerCase() !== context.account.address.toLowerCase()) {
      throw denied("The requested transaction account is not active.")
    }
    return {
      ...base,
      kind: "send-transaction" as const,
      transaction: {
        chainId: evmChainNumber(context.account.chainKey),
        ...(transaction.data ? { data: transaction.data } : {}),
        ...(transaction.gas === undefined ? {} : { gas: parseHexQuantity(transaction.gas, "gas") }),
        ...(transaction.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: parseHexQuantity(transaction.maxFeePerGas, "maxFeePerGas") }),
        ...(transaction.maxPriorityFeePerGas === undefined
          ? {}
          : {
              maxPriorityFeePerGas: parseHexQuantity(
                transaction.maxPriorityFeePerGas,
                "maxPriorityFeePerGas"
              ),
            }),
        ...(transaction.nonce === undefined ? {} : { nonce: parseNonce(transaction.nonce) }),
        ...(transaction.to ? { to: transaction.to } : {}),
        ...(transaction.value === undefined
          ? {}
          : { value: parseHexQuantity(transaction.value, "value") }),
      },
    }
  }
  throw new DappProviderError({
    code: 4200,
    message: `Unsupported signing method: ${request.method}`,
  })
}

const signingMethods = new Set<ProviderMethod>([
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
])

const addEthereumChainParamsSchema = z
  .tuple([
    z
      .object({
        blockExplorerUrls: z
          .array(z.url({ protocol: /^https$/u }))
          .max(8)
          .optional(),
        chainId: z.string(),
        chainName: z.string().trim().min(1).max(80),
        nativeCurrency: z
          .object({
            decimals: z.number().int().min(0).max(255),
            name: z.string().trim().min(1).max(80),
            symbol: z.string().trim().min(1).max(16),
          })
          .strict(),
        rpcUrls: z
          .array(z.url({ protocol: /^https$/u }))
          .min(1)
          .max(8),
      })
      .strict(),
  ])
  .rest(z.never())

const switchEthereumChainParamsSchema = z
  .tuple([z.object({ chainId: z.string() }).strict()])
  .rest(z.never())

const networkError = (error: NetworkRuntimeError): DappProviderError => {
  if (error.code === "NETWORK_NOT_FOUND") return unknownChain("The requested chain is not added.")
  if (
    error.code === "NETWORK_DISABLED" ||
    error.code === "NETWORK_IDENTITY_MISMATCH" ||
    error.code === "RPC_ENDPOINT_UNAVAILABLE"
  ) {
    return chainUnavailable("The selected chain is unavailable.")
  }
  return disconnected("The network request could not be completed.")
}

export const createDappProviderRuntimeService = (
  options: EthereumProviderRuntimeServiceOptions
): EthereumProviderRuntimeService => {
  const now = options.now ?? (() => new Date().toISOString())
  const permissionId = options.idFactory?.permissionId ?? (() => `dapp_permission_${randomUUID()}`)

  const appendAudit = async (
    eventType: string,
    request: ProviderRequest,
    outcome: string
  ): Promise<void> => {
    await options.audit.append({
      actor: request.origin,
      correlationId: String(request.id),
      createdAt: now(),
      eventType,
      payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`,
      payloadSummary: `${request.method}: ${outcome}.`,
      source: "runtime.dapp-provider-service",
    })
  }

  const resolveNetwork = async (
    request: ProviderRequest,
    preferredChainKey?: string
  ): Promise<NetworkDefinition> => {
    if (!options.networks) throw disconnected("Network management is unavailable.")
    const views = await options.networks.list()
    const context = await options.networks.getDappContext(request.origin, "eip155")
    const selected = context
      ? views.find(({ network }) => network.id === context.networkId)
      : views.find(
          ({ network }) =>
            network.chain.namespace === "eip155" &&
            network.enabled &&
            !network.deprecated &&
            (!preferredChainKey || toChainKey(network.chain) === preferredChainKey)
        )
    if (!selected?.network.enabled || selected.network.deprecated) {
      throw chainUnavailable("No enabled Ethereum network is selected for this site.")
    }
    if (!context) {
      await options.networks.setDappContext({
        networkId: selected.network.id,
        origin: request.origin,
        protocol: "eip155",
        updatedAt: now(),
      })
    }
    return selected.network
  }

  const authorizeNetwork = async (approval: EthereumNetworkApproval): Promise<void> => {
    if (!options.networkAuthorizer || !(await options.networkAuthorizer(approval))) {
      throw new DappProviderError({ code: 4001, message: "User rejected the network request." })
    }
  }

  const switchNetwork = async (request: ProviderRequest): Promise<null> => {
    let chainKey: string
    try {
      const [{ chainId }] = switchEthereumChainParamsSchema.parse(request.params)
      chainKey = toChainKey(evmChainIdentityFromHex(chainId))
    } catch {
      throw invalidParams("wallet_switchEthereumChain parameters are invalid.")
    }
    if (!options.networks) throw disconnected("Network management is unavailable.")
    const views = await options.networks.list()
    const target = views.find(({ network }) => toChainKey(network.chain) === chainKey)?.network
    if (!target) throw unknownChain("The requested chain is not added.")
    if (!target.enabled || target.deprecated) {
      throw chainUnavailable("The requested chain is disabled.")
    }
    const current = await resolveNetwork(request).catch(() => undefined)
    if (current?.id !== target.id) {
      await authorizeNetwork({
        kind: "switch",
        origin: request.origin,
        ...(current ? { currentNetwork: current } : {}),
        targetNetwork: target,
      })
      await options.networks.setDappContext({
        networkId: target.id,
        origin: request.origin,
        protocol: "eip155",
        updatedAt: now(),
      })
    }
    return null
  }

  const addNetwork = async (request: ProviderRequest): Promise<null> => {
    if (!options.networks) throw disconnected("Network management is unavailable.")
    let input: CreateNetworkInput
    try {
      const [proposal] = addEthereumChainParamsSchema.parse(request.params)
      const chain = evmChainIdentityFromHex(proposal.chainId)
      input = {
        chain,
        enabled: true,
        endpoints: proposal.rpcUrls.map((url, index) => ({
          enabled: true,
          label: `dApp RPC ${index + 1}`,
          localDevelopment: false,
          transport: "http" as const,
          url,
        })),
        explorers: (proposal.blockExplorerUrls ?? []).map((url, index) => ({
          name: `Explorer ${index + 1}`,
          url,
        })),
        name: proposal.chainName,
        nativeCurrency: proposal.nativeCurrency,
        testnet: false,
        verification: { kind: "evm-chain-id" },
      }
    } catch {
      throw invalidParams("wallet_addEthereumChain parameters are invalid.")
    }

    const views = await options.networks.list()
    const current = await resolveNetwork(request).catch(() => undefined)
    const existing = views.find(
      ({ network }) => toChainKey(network.chain) === toChainKey(input.chain)
    )
    let target: NetworkDefinition
    if (existing) {
      if (!existing.network.enabled || existing.network.deprecated) {
        throw chainUnavailable("The requested chain is configured but disabled.")
      }
      const knownUrls = new Set(existing.endpoints.map(({ connection }) => connection.displayUrl))
      const endpoints = input.endpoints.filter(({ url }) => !knownUrls.has(url))
      if (endpoints.length > 0) {
        await options.networks.addEndpoints(existing.network.id, endpoints, async (proposal) => {
          await authorizeNetwork({
            kind: "add",
            origin: request.origin,
            ...(current ? { currentNetwork: current } : {}),
            proposal,
            metadataChanges: ["rpcUrls"],
          })
          return true
        })
      } else {
        await authorizeNetwork({
          kind: "add",
          origin: request.origin,
          ...(current ? { currentNetwork: current } : {}),
          proposal: existing,
          metadataChanges: [],
        })
      }
      target = existing.network
    } else {
      const created = await options.networks.create(input, async (proposal) => {
        await authorizeNetwork({
          kind: "add",
          origin: request.origin,
          ...(current ? { currentNetwork: current } : {}),
          proposal,
          metadataChanges: [
            "chainId",
            "chainName",
            "nativeCurrency",
            "rpcUrls",
            ...(input.explorers.length ? ["blockExplorerUrls"] : []),
          ],
        })
        return true
      })
      target = created.network
    }
    if (!target.enabled || target.deprecated) {
      throw chainUnavailable("The requested chain is disabled.")
    }
    await options.networks.setDappContext({
      networkId: target.id,
      origin: request.origin,
      protocol: "eip155",
      updatedAt: now(),
    })
    return null
  }

  const process = async (request: ProviderRequest): Promise<unknown> => {
    try {
      await options.sessions.validateRequest(request)
    } catch (error) {
      if (error instanceof DappSessionError) {
        throw denied("The provider request does not belong to an active dApp session.")
      }
      throw error
    }
    const currentTime = now()
    let permissions = (await options.persistence.listPermissions(request.origin)).filter(
      (permission) =>
        permission.sessionKey === request.sessionKey && !isExpired(permission, currentTime)
    )
    if (request.method === "wallet_switchEthereumChain") return switchNetwork(request)
    if (request.method === "wallet_addEthereumChain") return addNetwork(request)

    const selectedNetwork = options.networks
      ? await resolveNetwork(request, request.chainKey)
      : undefined
    const selectedChainKey = selectedNetwork ? toChainKey(selectedNetwork.chain) : request.chainKey
    if (selectedChainKey) {
      permissions = permissions.filter((permission) => permission.chainKey === selectedChainKey)
    }

    if (request.method === "eth_accounts") {
      return [
        ...new Set(
          permissions
            .filter((permission) => permission.methods.includes("eth_accounts"))
            .flatMap((permission) => permission.accountAddresses)
        ),
      ]
    }

    if (
      request.method === "eth_requestAccounts" ||
      request.method === "wallet_requestPermissions"
    ) {
      if (request.method === "eth_requestAccounts") {
        const existingAccounts = [
          ...new Set(
            permissions
              .filter((permission) => permission.methods.includes("eth_accounts"))
              .flatMap((permission) => permission.accountAddresses)
          ),
        ]
        if (existingAccounts.length > 0) return existingAccounts
      }
      let requestedMethods: ProviderMethod[]
      try {
        requestedMethods = requestedPermissionMethods(request)
      } catch (error) {
        if (error instanceof DappProviderError) throw error
        throw invalidParams("The wallet permission request is invalid.")
      }
      const grant = await options.permissionAuthorizer({
        request: request as ProviderRequest<"eth_requestAccounts" | "wallet_requestPermissions">,
        requestedMethods,
      })
      if (!grant) throw new DappProviderError({ code: 4001, message: "User rejected the request." })
      if (grant.methods.some((method) => !requestedMethods.includes(method))) {
        throw denied("The permission grant exceeds the requested methods.")
      }
      if (
        (selectedChainKey !== undefined && selectedChainKey !== grant.chainKey) ||
        (request.method === "eth_requestAccounts" && !grant.methods.includes("eth_accounts"))
      ) {
        throw denied("The permission grant does not match the requested wallet context.")
      }
      const createdAt = now()
      const existing = permissions.find(
        (permission) =>
          permission.walletId === grant.walletId && permission.chainKey === grant.chainKey
      )
      const permission = dappPermissionRecordSchema.parse({
        ...grant,
        accountAddresses: [
          ...new Set([...(existing?.accountAddresses ?? []), ...grant.accountAddresses]),
        ],
        createdAt: existing?.createdAt ?? createdAt,
        id: existing?.id ?? permissionId(),
        methods: [...new Set([...(existing?.methods ?? []), ...grant.methods])],
        origin: request.origin,
        sessionKey: request.sessionKey,
        updatedAt: createdAt,
      }) as EthereumProviderPermissionRecord
      const saved = await options.persistence.savePermission(permission)
      await appendAudit("dapp.permission.granted", request, saved.id)
      return request.method === "eth_requestAccounts"
        ? saved.accountAddresses
        : grant.methods.map((method) => ({ caveats: [], parentCapability: method }))
    }

    if (ethereumReadOnlyMethods.includes(request.method as never)) {
      if (request.method === "eth_chainId" && selectedNetwork?.chain.namespace === "eip155") {
        return evmChainIdentityToHex(selectedNetwork.chain)
      }
      if (options.router && selectedChainKey) {
        return options.router.request(
          selectedChainKey,
          request.method === "eth_call" || request.method === "eth_estimateGas"
            ? "simulate"
            : "read",
          { method: request.method, ...(request.params ? { params: request.params } : {}) },
          { operationKey: `${request.origin}:${request.sessionKey}` }
        )
      }
      if (options.dispatch) return options.dispatch(request)
      throw disconnected("RPC routing is unavailable.")
    }

    if (signingMethods.has(request.method)) {
      const context = await options.getActiveSigningContext()
      const permission = context
        ? permissions.find(
            (candidate) =>
              candidate.methods.includes(request.method) &&
              (selectedChainKey === undefined || selectedChainKey === candidate.chainKey) &&
              context.account.walletId === candidate.walletId &&
              context.account.chainKey === candidate.chainKey &&
              candidate.accountAddresses.some(
                (address) => address.toLowerCase() === context.account.address.toLowerCase()
              )
          )
        : undefined
      if (!context || !permission) {
        throw denied("The permitted wallet account is not active.")
      }
      let draft: ReturnType<typeof createSigningDraft>
      try {
        draft = createSigningDraft(request, context)
      } catch (error) {
        if (error instanceof DappProviderError) throw error
        throw invalidParams("The signing request parameters are invalid.")
      }
      const intent = await options.signingIntents.create({
        intent: draft,
        mode: context.mode,
        source: "dapp",
      })
      if (intent.status === "rejected") throw denied("Signing policy rejected the request.")
      return options.executeSigningIntent(intent)
    }

    const permission = permissions.find(
      (candidate) =>
        candidate.methods.includes(request.method) &&
        (selectedChainKey === undefined || selectedChainKey === candidate.chainKey)
    )
    if (!permission) throw denied("The dApp does not have permission for this wallet method.")
    if (!options.dispatch) throw disconnected("The wallet method is unavailable.")
    return options.dispatch(request, permission)
  }

  const handle = async (requestValue: unknown): Promise<ProviderResponse> => {
    let request: ProviderRequest
    try {
      request = providerRequestSchema.parse(requestValue) as ProviderRequest
    } catch {
      const id =
        requestValue && typeof requestValue === "object" && "id" in requestValue
          ? (requestValue as { id?: unknown }).id
          : "invalid"
      return {
        error: { code: -32602, message: "Invalid provider request." },
        id: typeof id === "string" || typeof id === "number" ? id : "invalid",
      }
    }
    try {
      const result = await process(request)
      await appendAudit("dapp.provider.request", request, "succeeded")
      return { id: request.id, result }
    } catch (error) {
      const providerError =
        error instanceof DappProviderError
          ? error.error
          : error instanceof NetworkRuntimeError
            ? networkError(error).error
            : { code: -32603, message: "Internal provider error." }
      await appendAudit("dapp.provider.request", request, `failed (${providerError.code})`).catch(
        () => undefined
      )
      return { error: providerError, id: request.id }
    }
  }

  return {
    handle,
    handlers: [{ handler: handle, method: "dapp.provider-request" }],
    name: "dapp-provider",
    namespace: "dapp",
  }
}

export const createEthereumProviderRuntimeService = createDappProviderRuntimeService
