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

export const chainNamespaces = ["eip155"] as const
export type ChainNamespace = (typeof chainNamespaces)[number]

export const curves = ["secp256k1"] as const
export type Curve = (typeof curves)[number]

export const walletAccountSchema = z
  .object({
    createdAt: timestampSchema,
    fingerprint: walletFingerprintSchema,
    id: walletAccountIdSchema,
    index: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(128),
    updatedAt: timestampSchema,
    walletId: walletIdSchema,
  })
  .strict()

export type WalletAccount = z.infer<typeof walletAccountSchema>

const derivationPathSchema = z.string().regex(/^m(?:\/[0-9]+['h]?)+$/u)

export const chainAccountSchema = z
  .object({
    address: hexAddressSchema,
    chainId: chainIdSchema,
    createdAt: timestampSchema,
    derivationPath: derivationPathSchema.optional(),
    id: chainAccountIdSchema,
    namespace: z.enum(chainNamespaces),
    publicKey: hexDataSchema.optional(),
    updatedAt: timestampSchema,
    walletAccountId: walletAccountIdSchema,
  })
  .strict()

export type ChainAccount = z.infer<typeof chainAccountSchema>

export const EVM_HD_PATH_TEMPLATE = "m/44'/60'/0'/0/{index}" as const
export const EVM_HD_PROBE_PATH = "m/44'/60'/0'/0/0" as const

const pathTemplateSchema = z
  .string()
  .refine((value) => value.split("{index}").length === 2, "Path must contain one {index}.")
  .refine(
    (value) => /^m(?:\/[0-9]+['h]?)*\/\{index\}$/u.test(value),
    "Unsupported HD path template."
  )

export const hdDerivationSchemeSchema = z
  .object({
    curve: z.literal("secp256k1"),
    derivePosition: z.literal(4),
    namespace: z.literal("eip155"),
    pathTemplate: pathTemplateSchema,
    probePath: derivationPathSchema,
    walletId: walletIdSchema,
  })
  .strict()

export type HdDerivationScheme = z.infer<typeof hdDerivationSchemeSchema>

export const defaultEvmHdDerivationScheme = (
  walletId: WalletAccount["walletId"]
): HdDerivationScheme => ({
  curve: "secp256k1",
  derivePosition: 4,
  namespace: "eip155",
  pathTemplate: EVM_HD_PATH_TEMPLATE,
  probePath: EVM_HD_PROBE_PATH,
  walletId,
})

export const derivePath = (scheme: HdDerivationScheme, index: number): string => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("Wallet account index must be a non-negative safe integer.")
  }
  return scheme.pathTemplate.replace("{index}", String(index))
}
