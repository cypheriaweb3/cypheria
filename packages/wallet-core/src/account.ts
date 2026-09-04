import { z } from "zod"

import {
  chainAccountIdSchema,
  chainIdSchema,
  hexAddressSchema,
  hexDataSchema,
  timestampSchema,
  walletAccountIdSchema,
  walletFingerprintSchema,
  walletIdSchema,
} from "./primitives.js"

/** Chain namespaces currently understood by wallet-core. */
export const chainNamespaces = ["eip155"] as const
export type ChainNamespace = (typeof chainNamespaces)[number]

/** Curves currently supported for deterministic account derivation. */
export const curves = ["secp256k1"] as const
export type Curve = (typeof curves)[number]

/**
 * A logical account inside a wallet. `index` controls stable presentation order;
 * an HD account's immutable derivation position is recorded in its ChainAccount path.
 */
export const walletAccountSchema = z
  .object({
    id: walletAccountIdSchema,
    walletId: walletIdSchema,
    index: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(128),
    fingerprint: walletFingerprintSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export type WalletAccount = z.infer<typeof walletAccountSchema>

const derivationPathSchema = z.string().regex(/^m(?:\/[0-9]+['h]?)+$/u)

/** Public identity of one logical wallet account on a particular chain. */
export const chainAccountSchema = z
  .object({
    id: chainAccountIdSchema,
    walletAccountId: walletAccountIdSchema,
    namespace: z.enum(chainNamespaces),
    chainId: chainIdSchema,
    address: hexAddressSchema,
    publicKey: hexDataSchema.optional(),
    derivationPath: derivationPathSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export type ChainAccount = z.infer<typeof chainAccountSchema>

/** Supported BIP-44-style path; `{index}` is the only mutable segment. */
export const EVM_HD_PATH_TEMPLATE = "m/44'/60'/0'/0/{index}" as const
/**
 * Fixed index-zero path used to fingerprint an HD source independently of the
 * number or display order of accounts derived from it.
 */
export const EVM_HD_PROBE_PATH = "m/44'/60'/0'/0/0" as const

const pathTemplateSchema = z
  .string()
  .refine((value) => value.split("{index}").length === 2, "Path must contain one {index}.")
  .refine(
    (value) => /^m(?:\/[0-9]+['h]?)*\/\{index\}$/u.test(value),
    "Unsupported HD path template."
  )

/** Persisted recipe needed to derive additional accounts without guessing defaults. */
export const hdDerivationSchemeSchema = z
  .object({
    walletId: walletIdSchema,
    namespace: z.literal("eip155"),
    curve: z.literal("secp256k1"),
    pathTemplate: pathTemplateSchema,
    // Position 4 is the final, non-hardened segment in the V1 path template.
    derivePosition: z.literal(4),
    probePath: derivationPathSchema,
  })
  .strict()

export type HdDerivationScheme = z.infer<typeof hdDerivationSchemeSchema>

/** Creates the only HD derivation scheme supported in V1. */
export const defaultEvmHdDerivationScheme = (
  walletId: WalletAccount["walletId"]
): HdDerivationScheme => ({
  walletId,
  namespace: "eip155",
  curve: "secp256k1",
  pathTemplate: EVM_HD_PATH_TEMPLATE,
  derivePosition: 4,
  probePath: EVM_HD_PROBE_PATH,
})

/** Materializes a validated, non-negative account position into an HD path. */
export const derivePath = (scheme: HdDerivationScheme, index: number): string => {
  // Safe integers keep persisted account indexes and generated path segments exact.
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("Wallet account index must be a non-negative safe integer.")
  }
  return scheme.pathTemplate.replace("{index}", String(index))
}
