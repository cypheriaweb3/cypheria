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

/** User-selected policy posture for an active wallet context. */
export const walletModes = ["conditional-auto-signing", "human-approval", "read-only"] as const
export type WalletMode = (typeof walletModes)[number]

/** Immutable references binding an EVM signing request to persisted public state. */
export type SigningAccountRef = {
  readonly walletId: WalletId
  readonly walletAccountId: WalletAccountId
  readonly chainAccountId: ChainAccountId
  readonly chainId: ChainId
  readonly address: Address
}

/** Solana equivalent of SigningAccountRef, including the expected public key. */
export type SolanaSigningAccountRef = {
  readonly protocol: "solana"
  readonly walletId: WalletId
  readonly walletAccountId: WalletAccountId
  readonly chainAccountId: ChainAccountId
  readonly chainId: `solana:${string}`
  readonly address: string
  readonly publicKey: string
}

/** Runtime validator for EVM account references received across trust boundaries. */
export const signingAccountRefSchema = z
  .object({
    walletId: walletIdSchema,
    walletAccountId: walletAccountIdSchema,
    chainAccountId: chainAccountIdSchema,
    chainId: chainIdSchema,
    address: hexAddressSchema,
  })
  .strict()

/** Runtime validator for Solana account references received across trust boundaries. */
export const solanaSigningAccountRefSchema = z
  .object({
    protocol: z.literal("solana"),
    walletId: walletIdSchema,
    walletAccountId: walletAccountIdSchema,
    chainAccountId: chainAccountIdSchema,
    chainId: z.string().regex(/^solana:[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    address: z.string().min(32).max(44),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]{42}[AQgw]=$/u),
  })
  .strict()

/**
 * Supported EVM transaction fields for signing. Broadcasting is intentionally not
 * part of this type or the WalletSigner capability.
 */
export type SignTransactionParameters = {
  readonly chainId: ChainId
  readonly to?: Address
  readonly value?: bigint
  readonly data?: Hex
  readonly nonce?: number
  readonly gas?: bigint
  readonly maxFeePerGas?: bigint
  readonly maxPriorityFeePerGas?: bigint
}

/** Rejects unknown or negative transaction fields before policy evaluation. */
export const signTransactionParametersSchema = z
  .object({
    chainId: chainIdSchema,
    to: hexAddressSchema.optional(),
    value: z.bigint().nonnegative().optional(),
    data: hexDataSchema.optional(),
    nonce: z.number().int().nonnegative().optional(),
    gas: z.bigint().nonnegative().optional(),
    maxFeePerGas: z.bigint().nonnegative().optional(),
    maxPriorityFeePerGas: z.bigint().nonnegative().optional(),
  })
  .strict()

/**
 * Opaque signing capability exposed by trusted runtime adapters. It deliberately
 * has no private-key, mnemonic, keystore, or transaction-broadcasting API.
 */
export interface WalletSigner {
  readonly address: Address
  signMessage(parameters: { readonly message: SignableMessage }): Promise<Hex>
  signTransaction(parameters: SignTransactionParameters): Promise<Hex>
  signTypedData<const TTypedData extends TypedData>(
    parameters: TypedDataDefinition<TTypedData>
  ): Promise<Hex>
}

/** Auditable operations that must pass signing policy before execution. */
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

/** Shared identity, provenance, and account binding for every signing intent. */
export type SigningIntentBase<TAccount = SigningAccountRef> = {
  readonly id: string
  readonly correlationId: string
  readonly origin?: string
  readonly account: TAccount
  readonly createdAt: string
}

/** Raw-message request corresponding to EVM `personal_sign`. */
export type PersonalSignIntent = SigningIntentBase & {
  readonly kind: "personal-sign"
  readonly message: Hex | string
}

/** Structured EIP-712 request; viem performs the final typed-data validation. */
export type TypedDataSignIntent = SigningIntentBase & {
  readonly kind: "typed-data"
  readonly domain: unknown
  readonly types: unknown
  readonly primaryType: string
  readonly message: unknown
}

/** Transaction review request, retaining whether the caller also requested broadcast. */
export type TransactionIntent = SigningIntentBase & {
  readonly kind: "send-transaction" | "sign-transaction"
  readonly transaction: SignTransactionParameters
}

/** Solana signing request with transport-safe encoded payload bytes. */
export type SolanaSigningIntent = SigningIntentBase<SolanaSigningAccountRef> & {
  readonly kind:
    | "solana-sign-and-send-transaction"
    | "solana-sign-message"
    | "solana-sign-transaction"
  readonly chainId: `solana:${string}`
  readonly payload: string
}

export type SigningIntent =
  | PersonalSignIntent
  | SolanaSigningIntent
  | TransactionIntent
  | TypedDataSignIntent

const signingIntentBaseShape = {
  id: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  correlationId: z.string().min(1),
  origin: z.string().min(1).optional(),
  account: signingAccountRefSchema,
} as const

/** Complete persisted schema for an EVM personal-message intent. */
export const personalSignIntentSchema = z
  .object({
    kind: z.literal("personal-sign"),
    ...signingIntentBaseShape,
    message: z.string(),
    createdAt: timestampSchema,
  })
  .strict()

/** Complete persisted schema for an EIP-712 intent. */
export const typedDataSignIntentSchema = z
  .object({
    kind: z.literal("typed-data"),
    ...signingIntentBaseShape,
    domain: z.unknown(),
    types: z.unknown(),
    primaryType: z.string().min(1),
    message: z.unknown(),
    createdAt: timestampSchema,
  })
  .strict()

/** Complete persisted schema shared by sign-only and send transaction requests. */
export const transactionIntentSchema = z
  .object({
    kind: z.enum(["send-transaction", "sign-transaction"]),
    ...signingIntentBaseShape,
    transaction: signTransactionParametersSchema,
    createdAt: timestampSchema,
  })
  .strict()

const solanaSigningIntentRequestShape = {
  correlationId: z.string().min(1),
  origin: z.string().min(1).optional(),
  account: solanaSigningAccountRefSchema,
  chainId: z.string().regex(/^solana:[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  payload: z.string().min(1).max(2_000_000),
} as const

const solanaSigningIntentKindSchema = z.enum([
  "solana-sign-message",
  "solana-sign-transaction",
  "solana-sign-and-send-transaction",
])

const refineSolanaIntentChain = (
  intent: { readonly account: { readonly chainId: string }; readonly chainId: string },
  context: z.RefinementCtx
): void => {
  // Keep the top-level routing key bound to the account authorized by policy.
  if (intent.chainId !== intent.account.chainId) {
    context.addIssue({ code: "custom", message: "The Solana intent chain is inconsistent." })
  }
}

/** Validates a Solana request before persistence assigns its ID and timestamp. */
export const solanaSigningIntentDraftSchema = z
  .object({
    kind: solanaSigningIntentKindSchema,
    ...solanaSigningIntentRequestShape,
  })
  .strict()
  .superRefine(refineSolanaIntentChain)

/** Complete persisted schema for all supported Solana signing operations. */
export const solanaSigningIntentSchema = z
  .object({
    kind: solanaSigningIntentKindSchema,
    id: z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u),
    ...solanaSigningIntentRequestShape,
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine(refineSolanaIntentChain)

/**
 * Validates a complete persisted intent. The discriminant selects protocol-specific
 * payload validation while strict child schemas reject unexpected fields.
 */
export const signingIntentSchema = z.discriminatedUnion("kind", [
  personalSignIntentSchema,
  transactionIntentSchema,
  typedDataSignIntentSchema,
  solanaSigningIntentSchema,
])

/** Parses untrusted input into a complete signing intent. */
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

// Tagged containers preserve bigint values and distinguish arrays from objects;
// sorted object keys make the serialized form deterministic for hashing and replay checks.
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
    // Class instances may hide executable or lossy serialization behavior.
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

/** Produces a deterministic JSON representation that preserves bigint values. */
export const serializeSigningIntent = (intent: SigningIntent): string =>
  JSON.stringify(encodeIntentValue(parseSigningIntent(intent)))

/** Restores and revalidates an intent instead of trusting serialized storage. */
export const deserializeSigningIntent = (serialized: string): SigningIntent =>
  parseSigningIntent(decodeIntentValue(JSON.parse(serialized) as EncodedIntentValue))
