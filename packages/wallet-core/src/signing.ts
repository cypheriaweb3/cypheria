import type { Address, Hex, SignableMessage, TypedData, TypedDataDefinition } from "viem"
import { z } from "zod"

import {
  type ChainAccountId,
  type ChainId,
  chainAccountIdSchema,
  chainIdSchema,
  hexAddressSchema,
  hexDataSchema,
  timestampSchema,
  type WalletAccountId,
  type WalletId,
  walletAccountIdSchema,
  walletIdSchema,
} from "./primitives.js"

export const walletModes = ["conditional-auto-signing", "human-approval", "read-only"] as const
export type WalletMode = (typeof walletModes)[number]

export type SigningAccountRef = {
  readonly address: Address
  readonly chainAccountId: ChainAccountId
  readonly chainId: ChainId
  readonly walletAccountId: WalletAccountId
  readonly walletId: WalletId
}

export type SolanaSigningAccountRef = {
  readonly address: string
  readonly chainAccountId: ChainAccountId
  readonly chainId: `solana:${string}`
  readonly protocol: "solana"
  readonly publicKey: string
  readonly walletAccountId: WalletAccountId
  readonly walletId: WalletId
}

export const signingAccountRefSchema = z
  .object({
    address: hexAddressSchema,
    chainAccountId: chainAccountIdSchema,
    chainId: chainIdSchema,
    walletAccountId: walletAccountIdSchema,
    walletId: walletIdSchema,
  })
  .strict()

export const solanaSigningAccountRefSchema = z
  .object({
    address: z.string().min(32).max(44),
    chainAccountId: chainAccountIdSchema,
    chainId: z.string().regex(/^solana:[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    protocol: z.literal("solana"),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]{42}[AQgw]=$/u),
    walletAccountId: walletAccountIdSchema,
    walletId: walletIdSchema,
  })
  .strict()

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

export const signTransactionParametersSchema = z
  .object({
    chainId: chainIdSchema,
    data: hexDataSchema.optional(),
    gas: z.bigint().nonnegative().optional(),
    maxFeePerGas: z.bigint().nonnegative().optional(),
    maxPriorityFeePerGas: z.bigint().nonnegative().optional(),
    nonce: z.number().int().nonnegative().optional(),
    to: hexAddressSchema.optional(),
    value: z.bigint().nonnegative().optional(),
  })
  .strict()

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
  "solana-sign-message",
  "solana-sign-transaction",
  "solana-sign-and-send-transaction",
] as const
export type SigningIntentKind = (typeof signingIntentKinds)[number]

export type SigningIntentBase<TAccount = SigningAccountRef> = {
  readonly account: TAccount
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

export type SolanaSigningIntent = SigningIntentBase<SolanaSigningAccountRef> & {
  readonly chainId: `solana:${string}`
  readonly kind:
    | "solana-sign-and-send-transaction"
    | "solana-sign-message"
    | "solana-sign-transaction"
  readonly payload: string
}

export type SigningIntent =
  | PersonalSignIntent
  | SolanaSigningIntent
  | TransactionIntent
  | TypedDataSignIntent

const signingIntentBaseShape = {
  account: signingAccountRefSchema,
  correlationId: z.string().min(1),
  createdAt: timestampSchema,
  id: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  origin: z.string().min(1).optional(),
} as const

export const personalSignIntentSchema = z
  .object({
    ...signingIntentBaseShape,
    kind: z.literal("personal-sign"),
    message: z.string(),
  })
  .strict()

export const typedDataSignIntentSchema = z
  .object({
    ...signingIntentBaseShape,
    domain: z.unknown(),
    kind: z.literal("typed-data"),
    message: z.unknown(),
    primaryType: z.string().min(1),
    types: z.unknown(),
  })
  .strict()

export const transactionIntentSchema = z
  .object({
    ...signingIntentBaseShape,
    kind: z.enum(["send-transaction", "sign-transaction"]),
    transaction: signTransactionParametersSchema,
  })
  .strict()

const solanaSigningIntentDraftShape = {
  account: solanaSigningAccountRefSchema,
  chainId: z.string().regex(/^solana:[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  correlationId: z.string().min(1),
  kind: z.enum([
    "solana-sign-message",
    "solana-sign-transaction",
    "solana-sign-and-send-transaction",
  ]),
  origin: z.string().min(1).optional(),
  payload: z.string().min(1).max(2_000_000),
} as const

const refineSolanaIntentChain = (
  intent: { readonly account: { readonly chainId: string }; readonly chainId: string },
  context: z.RefinementCtx
): void => {
  if (intent.chainId !== intent.account.chainId) {
    context.addIssue({ code: "custom", message: "The Solana intent chain is inconsistent." })
  }
}

export const solanaSigningIntentDraftSchema = z
  .object(solanaSigningIntentDraftShape)
  .strict()
  .superRefine(refineSolanaIntentChain)

export const solanaSigningIntentSchema = z
  .object({
    ...solanaSigningIntentDraftShape,
    createdAt: timestampSchema,
    id: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  })
  .strict()
  .superRefine(refineSolanaIntentChain)

export const signingIntentSchema = z.discriminatedUnion("kind", [
  personalSignIntentSchema,
  transactionIntentSchema,
  typedDataSignIntentSchema,
  solanaSigningIntentSchema,
])

export const parseSigningIntent = (value: unknown): SigningIntent =>
  signingIntentSchema.parse(value) as SigningIntent

type EncodedIntentValue =
  | boolean
  | null
  | number
  | string
  | ["array", EncodedIntentValue[]]
  | ["bigint", string]
  | ["object", [string, EncodedIntentValue][]]

const encodeIntentValue = (value: unknown): EncodedIntentValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The signing intent contains a non-finite number.")
    return value
  }
  if (typeof value === "bigint") {
    return ["bigint", value.toString()]
  }
  if (Array.isArray(value)) {
    return ["array", value.map(encodeIntentValue)]
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("The signing intent contains an unsupported object.")
    }
    return [
      "object",
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, encodeIntentValue(item)]),
    ]
  }
  throw new Error("The signing intent contains an unsupported value.")
}

const decodeIntentValue = (value: EncodedIntentValue): unknown => {
  if (!Array.isArray(value)) {
    return value
  }
  if (value[0] === "bigint") {
    return BigInt(value[1])
  }
  if (value[0] === "array") {
    return value[1].map(decodeIntentValue)
  }
  return Object.fromEntries(value[1].map(([key, item]) => [key, decodeIntentValue(item)]))
}

export const serializeSigningIntent = (intent: SigningIntent): string =>
  JSON.stringify(encodeIntentValue(parseSigningIntent(intent)))

export const deserializeSigningIntent = (serialized: string): SigningIntent =>
  parseSigningIntent(decodeIntentValue(JSON.parse(serialized) as EncodedIntentValue))
