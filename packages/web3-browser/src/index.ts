import type { ChainId, HexAddress, WalletPermissionMethod } from "@cypheria/wallet-core"

export type DappSessionKey = `cypheria:dapp:${string}`

export const providerMethods = [
  "eth_accounts",
  "eth_chainId",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "personal_sign",
  "wallet_addEthereumChain",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
] as const satisfies readonly WalletPermissionMethod[]

export type ProviderMethod = (typeof providerMethods)[number]

export type DappSession = {
  readonly createdAt: string
  readonly key: DappSessionKey
  readonly lastUsedAt?: string
  readonly origin: string
  readonly partition: string
}

export type DappPermissionRecord = {
  readonly accountAddresses: readonly HexAddress[]
  readonly chainId: ChainId
  readonly createdAt: string
  readonly expiresAt?: string
  readonly id: string
  readonly methods: readonly ProviderMethod[]
  readonly origin: string
  readonly sessionKey: DappSessionKey
  readonly updatedAt: string
  readonly walletId: string
}

export type ProviderRequestId = number | string

export type ProviderRequest<TMethod extends ProviderMethod = ProviderMethod, TParams = unknown> = {
  readonly chainId?: ChainId
  readonly id: ProviderRequestId
  readonly method: TMethod
  readonly origin: string
  readonly params?: TParams
  readonly sessionKey: DappSessionKey
}

export type ProviderSuccessResponse<TResult = unknown> = {
  readonly id: ProviderRequestId
  readonly result: TResult
}

export type ProviderError = {
  readonly code: number
  readonly data?: unknown
  readonly message: string
}

export type ProviderErrorResponse = {
  readonly error: ProviderError
  readonly id: ProviderRequestId
}

export type ProviderResponse<TResult = unknown> =
  | ProviderErrorResponse
  | ProviderSuccessResponse<TResult>

export type ProviderBridgeRequestArguments<TMethod extends string = string, TParams = unknown> = {
  readonly method: TMethod
  readonly params?: TParams
}

export type ProviderBridgeTransport = (
  request: ProviderRequest
) => Promise<ProviderResponse> | ProviderResponse

export type ProviderBridgeOptions = {
  readonly chainId?: ChainId
  readonly origin: string
  readonly sessionKey?: DappSessionKey
  readonly transport: ProviderBridgeTransport
}

export type ProviderBridge = {
  readonly request: <TResult = unknown>(args: ProviderBridgeRequestArguments) => Promise<TResult>
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

export type RequestAccountsRequest = ProviderRequest<"eth_requestAccounts", readonly unknown[]>

export type SwitchEthereumChainParams = readonly [
  {
    readonly chainId: `0x${string}`
  },
]

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

export const createDappSessionKey = (origin: string): DappSessionKey =>
  `cypheria:dapp:${new URL(origin).origin}`

export const createDappSession = (
  origin: string,
  createdAt = new Date().toISOString()
): DappSession => {
  const normalizedOrigin = new URL(origin).origin
  const key = createDappSessionKey(normalizedOrigin)

  return {
    createdAt,
    key,
    origin: normalizedOrigin,
    partition: `persist:${key}`,
  }
}

export const isProviderMethod = (value: string): value is ProviderMethod =>
  providerMethods.includes(value as ProviderMethod)

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

export const createProviderBridge = (options: ProviderBridgeOptions): ProviderBridge => {
  const origin = new URL(options.origin).origin
  const sessionKey = options.sessionKey ?? createDappSessionKey(origin)
  const nextRequestId = createProviderRequestIdGenerator()

  return {
    request: async <TResult = unknown>(args: ProviderBridgeRequestArguments): Promise<TResult> => {
      if (!isProviderMethod(args.method)) {
        throw new ProviderRpcError(createUnsupportedMethodError(args.method))
      }

      const request: ProviderRequest = {
        chainId: options.chainId,
        id: nextRequestId(),
        method: args.method,
        origin,
        params: args.params,
        sessionKey,
      }
      const response = await options.transport(request)

      if ("error" in response) {
        throw new ProviderRpcError(response.error)
      }

      return response.result as TResult
    },
  }
}
