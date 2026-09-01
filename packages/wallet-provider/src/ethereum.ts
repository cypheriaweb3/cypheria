import type { ChainId, HexAddress, WalletId } from "@cypheria/wallet-core"
import { chainIdSchema, hexAddressSchema, walletIdSchema } from "@cypheria/wallet-core"
import { z } from "zod"

import { jsonRpcParamsSchema, jsonRpcValueSchema } from "./json-rpc.js"
import {
  createDappSessionKey,
  type DappSessionKey,
  dappSessionKeySchema,
  normalizeDappOrigin,
} from "./session.js"

export const ethereumProviderMethods = [
  "web3_clientVersion",
  "net_version",
  "eth_accounts",
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
  "wallet_addEthereumChain",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
] as const

export const ethereumReadOnlyMethods = [
  "web3_clientVersion",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
] as const satisfies readonly EthereumProviderMethod[]

export const providerMethods = ethereumProviderMethods
export type EthereumProviderMethod = (typeof ethereumProviderMethods)[number]
export type ProviderMethod = EthereumProviderMethod

export type EthereumProviderPermissionRecord = {
  readonly accountAddresses: readonly HexAddress[]
  readonly chainId: ChainId
  readonly createdAt: string
  readonly expiresAt?: string
  readonly id: string
  readonly methods: readonly EthereumProviderMethod[]
  readonly origin: string
  readonly sessionKey: DappSessionKey
  readonly updatedAt: string
  readonly walletId: WalletId
}

/** @deprecated Use EthereumProviderPermissionRecord. */
export type DappPermissionRecord = EthereumProviderPermissionRecord

export type EthereumProviderPersistence = {
  readonly deletePermission: (permissionId: string) => Promise<boolean>
  readonly getSession: (origin: string) => Promise<import("./session.js").DappSession | undefined>
  readonly listPermissions: (origin: string) => Promise<DappPermissionRecord[]>
  readonly savePermission: (permission: DappPermissionRecord) => Promise<DappPermissionRecord>
  readonly saveSession: (
    session: import("./session.js").DappSession
  ) => Promise<import("./session.js").DappSession>
}

/** @deprecated Use EthereumProviderPersistence. */
export type DappBrowserPersistence = EthereumProviderPersistence

export const providerMethodSchema = z.enum(ethereumProviderMethods)

export const dappPermissionRecordSchema = z
  .object({
    accountAddresses: z.array(hexAddressSchema).min(1).max(32),
    chainId: chainIdSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
    id: z
      .string()
      .max(128)
      .regex(/^dapp_permission_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    methods: z.array(providerMethodSchema).min(1).max(ethereumProviderMethods.length),
    origin: z.string().transform(normalizeDappOrigin),
    sessionKey: dappSessionKeySchema,
    updatedAt: z.iso.datetime(),
    walletId: walletIdSchema,
  })
  .strict()
  .superRefine((permission, context) => {
    if (permission.sessionKey !== createDappSessionKey(permission.origin)) {
      context.addIssue({ code: "custom", message: "The permission session scope is inconsistent." })
    }
    if (new Set(permission.accountAddresses).size !== permission.accountAddresses.length) {
      context.addIssue({ code: "custom", message: "Permission accounts must be unique." })
    }
    if (new Set(permission.methods).size !== permission.methods.length) {
      context.addIssue({ code: "custom", message: "Permission methods must be unique." })
    }
  })

export type ProviderRequestId = number | string
export type ProviderRequest<
  TMethod extends EthereumProviderMethod = EthereumProviderMethod,
  TParams = unknown,
> = {
  readonly chainId?: ChainId
  readonly id: ProviderRequestId
  readonly method: TMethod
  readonly origin: string
  readonly params?: TParams
  readonly sessionKey: DappSessionKey
}

export type ProviderError = {
  readonly code: number
  readonly data?: unknown
  readonly message: string
}
export type ProviderResponse<TResult = unknown> =
  | { readonly error: ProviderError; readonly id: ProviderRequestId }
  | { readonly id: ProviderRequestId; readonly result: TResult }

export const providerRequestSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    id: z.union([z.number().finite(), z.string().min(1).max(128)]),
    method: providerMethodSchema,
    origin: z.string().transform(normalizeDappOrigin),
    params: jsonRpcParamsSchema.optional(),
    sessionKey: dappSessionKeySchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sessionKey !== createDappSessionKey(request.origin)) {
      context.addIssue({ code: "custom", message: "The provider request scope is inconsistent." })
    }
  })

export const providerErrorSchema = z
  .object({
    code: z.number().int(),
    data: jsonRpcValueSchema.optional(),
    message: z.string().min(1).max(1024),
  })
  .strict()

export const providerResponseSchema = z.union([
  z.object({ error: providerErrorSchema, id: z.union([z.number(), z.string()]) }).strict(),
  z.object({ id: z.union([z.number(), z.string()]), result: jsonRpcValueSchema }).strict(),
])

export type Eip1193RequestArguments = {
  readonly method: string
  readonly params?: readonly unknown[] | Record<string, unknown>
}
export type ProviderBridgeRequestArguments<TMethod extends string = string, TParams = unknown> = {
  readonly method: TMethod
  readonly params?: TParams
}

export type Eip1193ProviderEventMap = {
  accountsChanged: readonly string[]
  chainChanged: string
  connect: { readonly chainId: string }
  disconnect: ProviderRpcError
  message: { readonly data: unknown; readonly type: string }
}

export type Eip1193Provider = {
  readonly request: (args: Eip1193RequestArguments) => Promise<unknown>
  readonly on: <TEvent extends keyof Eip1193ProviderEventMap>(
    event: TEvent,
    listener: (payload: Eip1193ProviderEventMap[TEvent]) => void
  ) => Eip1193Provider
  readonly removeListener: <TEvent extends keyof Eip1193ProviderEventMap>(
    event: TEvent,
    listener: (payload: Eip1193ProviderEventMap[TEvent]) => void
  ) => Eip1193Provider
}

export type ProviderBridge = Eip1193Provider
export type ProviderBridgeTransport = (
  request: ProviderRequest
) => Promise<ProviderResponse> | ProviderResponse
export type ProviderBridgeOptions = {
  readonly chainId?: ChainId
  readonly origin: string
  readonly sessionKey?: DappSessionKey
  readonly transport: ProviderBridgeTransport
}

export class ProviderRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(error: ProviderError) {
    super(error.message)
    this.name = "ProviderRpcError"
    this.code = error.code
    this.data = error.data
  }
}

export const isProviderMethod = (value: string): value is EthereumProviderMethod =>
  ethereumProviderMethods.includes(value as EthereumProviderMethod)

export const createProviderRequestIdGenerator = (
  prefix = "provider"
): (() => ProviderRequestId) => {
  let nextId = 1
  return () => `${prefix}_${nextId++}`
}

export const createUnsupportedMethodError = (method: string): ProviderError => ({
  code: 4200,
  message: `Unsupported provider method: ${method}`,
})

export type EthereumProviderController = {
  readonly emit: <TEvent extends keyof Eip1193ProviderEventMap>(
    event: TEvent,
    payload: Eip1193ProviderEventMap[TEvent]
  ) => void
  readonly provider: Eip1193Provider
}

export const createEthereumProvider = (
  options: ProviderBridgeOptions
): EthereumProviderController => {
  const origin = normalizeDappOrigin(options.origin)
  const sessionKey = options.sessionKey ?? createDappSessionKey(origin)
  const nextRequestId = createProviderRequestIdGenerator()
  const listeners = new Map<keyof Eip1193ProviderEventMap, Set<(payload: never) => void>>()
  let provider: Eip1193Provider
  provider = Object.freeze({
    request: async (args: Eip1193RequestArguments): Promise<unknown> => {
      if (!args || typeof args !== "object" || typeof args.method !== "string" || !args.method) {
        throw new ProviderRpcError({ code: -32602, message: "Invalid provider request arguments." })
      }
      if (!isProviderMethod(args.method)) {
        throw new ProviderRpcError(createUnsupportedMethodError(args.method))
      }
      let request: ProviderRequest
      try {
        request = providerRequestSchema.parse({
          chainId: options.chainId,
          id: nextRequestId(),
          method: args.method,
          origin,
          params: args.params,
          sessionKey,
        }) as ProviderRequest
      } catch {
        throw new ProviderRpcError({ code: -32602, message: "Invalid provider request arguments." })
      }
      let response: ProviderResponse
      try {
        response = providerResponseSchema.parse(
          await options.transport(request)
        ) as ProviderResponse
      } catch {
        throw new ProviderRpcError({
          code: -32603,
          message: "Invalid provider transport response.",
        })
      }
      if (response.id !== request.id) {
        throw new ProviderRpcError({ code: -32603, message: "Provider response ID mismatch." })
      }
      if ("error" in response) throw new ProviderRpcError(response.error)
      return response.result
    },
    on: <TEvent extends keyof Eip1193ProviderEventMap>(
      event: TEvent,
      listener: (payload: Eip1193ProviderEventMap[TEvent]) => void
    ) => {
      if (typeof listener !== "function")
        throw new TypeError("Provider listener must be a function.")
      const eventListeners = listeners.get(event) ?? new Set()
      eventListeners.add(listener as (payload: never) => void)
      listeners.set(event, eventListeners)
      return provider
    },
    removeListener: <TEvent extends keyof Eip1193ProviderEventMap>(
      event: TEvent,
      listener: (payload: Eip1193ProviderEventMap[TEvent]) => void
    ) => {
      listeners.get(event)?.delete(listener as (payload: never) => void)
      return provider
    },
  })
  return {
    emit: (event, payload) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload as never)
    },
    provider,
  }
}

export const createProviderBridge = (options: ProviderBridgeOptions): ProviderBridge =>
  createEthereumProvider(options).provider

export type RequestAccountsRequest = ProviderRequest<"eth_requestAccounts", readonly unknown[]>
export type SwitchEthereumChainParams = readonly [{ readonly chainId: `0x${string}` }]
export type SwitchEthereumChainRequest = ProviderRequest<
  "wallet_switchEthereumChain",
  SwitchEthereumChainParams
>
export type AddEthereumChainParams = readonly [
  {
    readonly blockExplorerUrls?: readonly string[]
    readonly chainId: `0x${string}`
    readonly chainName: string
    readonly nativeCurrency?: {
      readonly decimals: number
      readonly name: string
      readonly symbol: string
    }
    readonly rpcUrls: readonly string[]
  },
]
export type AddEthereumChainRequest = ProviderRequest<
  "wallet_addEthereumChain",
  AddEthereumChainParams
>
export type PersonalSignParams = readonly [string, HexAddress]
export type PersonalSignRequest = ProviderRequest<"personal_sign", PersonalSignParams>
export type SignTypedDataV4Params = readonly [HexAddress, string]
export type SignTypedDataV4Request = ProviderRequest<"eth_signTypedData_v4", SignTypedDataV4Params>
export type SendTransactionParams = readonly [
  {
    readonly data?: `0x${string}`
    readonly from: HexAddress
    readonly gas?: `0x${string}`
    readonly maxFeePerGas?: `0x${string}`
    readonly maxPriorityFeePerGas?: `0x${string}`
    readonly nonce?: `0x${string}`
    readonly to?: HexAddress
    readonly value?: `0x${string}`
  },
]
export type SendTransactionRequest = ProviderRequest<"eth_sendTransaction", SendTransactionParams>
export type KnownProviderRequest =
  | AddEthereumChainRequest
  | PersonalSignRequest
  | RequestAccountsRequest
  | SendTransactionRequest
  | SignTypedDataV4Request
  | SwitchEthereumChainRequest
