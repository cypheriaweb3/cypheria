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

export const signingAccountRefSchema = z
  .object({
    address: hexAddressSchema,
    chainAccountId: chainAccountIdSchema,
    chainId: chainIdSchema,
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

export const signingIntentSchema = z.discriminatedUnion("kind", [
  personalSignIntentSchema,
  transactionIntentSchema,
  typedDataSignIntentSchema,
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
