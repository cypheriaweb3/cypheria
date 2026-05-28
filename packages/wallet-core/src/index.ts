export const walletModes = ["conditional-auto-signing", "human-approval", "read-only"] as const

export type WalletMode = (typeof walletModes)[number]

export const walletSourceTypes = ["external", "local", "privy", "read-only"] as const

export type WalletSourceType = (typeof walletSourceTypes)[number]

export type HexAddress = `0x${string}`
export type HexData = `0x${string}`
export type ChainId = number

export type WalletAccount = {
  readonly address: HexAddress
  readonly chainIds: readonly ChainId[]
  readonly id: string
  readonly label?: string
  readonly sourceId: string
  readonly sourceType: WalletSourceType
}

export type LocalWalletSource = {
  readonly id: string
  readonly kind: "local"
  readonly label: string
  readonly vaultId: string
}

export type PrivyWalletSource = {
  readonly id: string
  readonly kind: "privy"
  readonly label: string
  readonly privyUserId: string
  readonly walletId?: string
}

export type ExternalWalletProvider = "injected" | "walletconnect" | "reown" | "unknown"

export type ExternalWalletSource = {
  readonly id: string
  readonly kind: "external"
  readonly label: string
  readonly provider: ExternalWalletProvider
}

export type ReadOnlyWalletSource = {
  readonly id: string
  readonly kind: "read-only"
  readonly label: string
}

export type WalletSource =
  | ExternalWalletSource
  | LocalWalletSource
  | PrivyWalletSource
  | ReadOnlyWalletSource

export type RpcEndpoint = {
  readonly chainId: ChainId
  readonly headers?: Readonly<Record<string, string>>
  readonly id: string
  readonly label?: string
  readonly url: string
}

export type ChainDefinition = {
  readonly blockExplorerUrl?: string
  readonly id: ChainId
  readonly name: string
  readonly nativeCurrency: {
    readonly decimals: number
    readonly name: string
    readonly symbol: string
  }
  readonly rpcEndpoints: readonly RpcEndpoint[]
  readonly testnet?: boolean
}

export const signingIntentKinds = [
  "personal-sign",
  "send-transaction",
  "sign-transaction",
  "typed-data",
] as const

export type SigningIntentKind = (typeof signingIntentKinds)[number]

export type SigningIntentBase = {
  readonly account: WalletAccount
  readonly chainId: ChainId
  readonly correlationId: string
  readonly createdAt: string
  readonly id: string
  readonly origin?: string
}

export type PersonalSignIntent = SigningIntentBase & {
  readonly kind: "personal-sign"
  readonly message: HexData | string
}

export type TypedDataSignIntent = SigningIntentBase & {
  readonly domain: unknown
  readonly kind: "typed-data"
  readonly message: unknown
  readonly primaryType: string
  readonly types: unknown
}

export type TransactionRequest = {
  readonly data?: HexData
  readonly from: HexAddress
  readonly gas?: HexData
  readonly maxFeePerGas?: HexData
  readonly maxPriorityFeePerGas?: HexData
  readonly nonce?: HexData
  readonly to?: HexAddress
  readonly value?: HexData
}

export type TransactionIntent = SigningIntentBase & {
  readonly kind: "send-transaction" | "sign-transaction"
  readonly transaction: TransactionRequest
}

export type SigningIntent = PersonalSignIntent | TransactionIntent | TypedDataSignIntent

export type WalletPermissionMethod =
  | "eth_accounts"
  | "eth_chainId"
  | "eth_requestAccounts"
  | "eth_sendTransaction"
  | "eth_signTypedData_v4"
  | "personal_sign"
  | "wallet_addEthereumChain"
  | "wallet_requestPermissions"
  | "wallet_switchEthereumChain"

export type WalletPermission = {
  readonly accountId: string
  readonly chainId: ChainId
  readonly expiresAt?: string
  readonly id: string
  readonly methods: readonly WalletPermissionMethod[]
  readonly mode: WalletMode
  readonly origin: string
  readonly sourceId: string
}

export type ActiveWalletContext = {
  readonly account?: WalletAccount
  readonly chain?: ChainDefinition
  readonly mode: WalletMode
  readonly source?: WalletSource
}
