import type { Address, Hex, SignableMessage, TypedData, TypedDataDefinition } from "viem"

import type { ChainAccountId, ChainId, WalletAccountId, WalletId } from "./primitives.js"

export const walletModes = ["conditional-auto-signing", "human-approval", "read-only"] as const
export type WalletMode = (typeof walletModes)[number]

export type SigningAccountRef = {
  readonly address: Address
  readonly chainAccountId: ChainAccountId
  readonly chainId: ChainId
  readonly walletAccountId: WalletAccountId
  readonly walletId: WalletId
}

export type SignTransactionParameters = {
  readonly chainId: ChainId
  readonly data?: Hex
  readonly gas?: bigint
  readonly maxFeePerGas?: bigint
  readonly maxPriorityFeePerGas?: bigint
  readonly nonce?: number
  readonly to?: Address
  readonly value?: bigint
}

export interface WalletSigner {
  readonly address: Address
  signMessage(parameters: { readonly message: SignableMessage }): Promise<Hex>
  signTransaction(parameters: SignTransactionParameters): Promise<Hex>
  signTypedData<const TTypedData extends TypedData>(
    parameters: TypedDataDefinition<TTypedData>
  ): Promise<Hex>
}

export const signingIntentKinds = [
  "personal-sign",
  "send-transaction",
  "sign-transaction",
  "typed-data",
] as const
export type SigningIntentKind = (typeof signingIntentKinds)[number]

export type SigningIntentBase = {
  readonly account: SigningAccountRef
  readonly correlationId: string
  readonly createdAt: string
  readonly id: string
  readonly origin?: string
}

export type PersonalSignIntent = SigningIntentBase & {
  readonly kind: "personal-sign"
  readonly message: Hex | string
}

export type TypedDataSignIntent = SigningIntentBase & {
  readonly domain: unknown
  readonly kind: "typed-data"
  readonly message: unknown
  readonly primaryType: string
  readonly types: unknown
}

export type TransactionIntent = SigningIntentBase & {
  readonly kind: "send-transaction" | "sign-transaction"
  readonly transaction: SignTransactionParameters
}

export type SigningIntent = PersonalSignIntent | TransactionIntent | TypedDataSignIntent
