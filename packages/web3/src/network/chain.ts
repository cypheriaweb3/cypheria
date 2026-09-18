import { z } from "zod"
import type { ChainKey } from "./primitives.js"

const evmReferencePattern = /^[1-9][0-9]*$/u
const solanaReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const ethereumHexChainIdPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu

const isSafePositiveDecimal = (value: string): boolean => {
  if (!evmReferencePattern.test(value)) return false
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value
}

export const evmChainIdentitySchema = z
  .object({
    namespace: z.literal("eip155"),
    reference: z.string().refine(isSafePositiveDecimal, "Invalid canonical EVM chain reference."),
  })
  .strict()

export const solanaChainIdentitySchema = z
  .object({
    namespace: z.literal("solana"),
    reference: z.string().regex(solanaReferencePattern),
  })
  .strict()

export const chainIdentitySchema = z.discriminatedUnion("namespace", [
  evmChainIdentitySchema,
  solanaChainIdentitySchema,
])

export type EvmChainIdentity = z.infer<typeof evmChainIdentitySchema>
export type SolanaChainIdentity = z.infer<typeof solanaChainIdentitySchema>
export type ChainIdentity = z.infer<typeof chainIdentitySchema>

export const chainKeySchema = z
  .string()
  .refine((value) => {
    try {
      parseChainKey(value)
      return true
    } catch {
      return false
    }
  }, "Invalid canonical chain key.")
  .transform((value) => value as ChainKey)

export const toChainKey = (identity: ChainIdentity): ChainKey =>
  `${identity.namespace}:${identity.reference}`

export const parseChainKey = (value: string): ChainIdentity => {
  const separator = value.indexOf(":")
  if (separator < 1) throw new Error("Invalid chain key.")
  return chainIdentitySchema.parse({
    namespace: value.slice(0, separator),
    reference: value.slice(separator + 1),
  })
}

export const evmChainIdentityFromNumber = (chainId: number): EvmChainIdentity =>
  evmChainIdentitySchema.parse({ namespace: "eip155", reference: String(chainId) })

export const evmChainIdentityFromHex = (chainId: string): EvmChainIdentity => {
  if (!ethereumHexChainIdPattern.test(chainId)) throw new Error("Invalid EIP-1193 chain ID.")
  const parsed = Number(BigInt(chainId))
  return evmChainIdentityFromNumber(parsed)
}

export const evmChainIdentityToNumber = (identity: EvmChainIdentity): number =>
  Number(evmChainIdentitySchema.parse(identity).reference)

export const evmChainIdentityToHex = (identity: EvmChainIdentity): `0x${string}` =>
  `0x${evmChainIdentityToNumber(identity).toString(16)}`

export const solanaChainIdentityFromWalletStandard = (chain: string): SolanaChainIdentity => {
  const identity = parseChainKey(chain)
  if (identity.namespace !== "solana") throw new Error("Expected a Solana chain identifier.")
  return identity
}

export const solanaChainIdentityToWalletStandard = (
  identity: SolanaChainIdentity
): `solana:${string}` => `solana:${solanaChainIdentitySchema.parse(identity).reference}`
