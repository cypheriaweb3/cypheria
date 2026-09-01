import { type Address, getAddress, type Hex, isAddress } from "viem"
import { z } from "zod"

export type HexAddress = Address
export type HexData = Hex
export type ChainId = number

export type WalletId = `wallet_${string}`
export type WalletAccountId = `account_${string}`
export type ChainAccountId = `chain_account_${string}`
export type VaultId = `vault_${string}`
export type WalletFingerprint = `sha256:${string}`

const prefixedIdSchema = <TPrefix extends string>(prefix: TPrefix) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]*$`, "u"))

export const walletIdSchema = prefixedIdSchema("wallet").transform((value) => value as WalletId)
export const walletAccountIdSchema = prefixedIdSchema("account").transform(
  (value) => value as WalletAccountId
)
export const chainAccountIdSchema = prefixedIdSchema("chain_account").transform(
  (value) => value as ChainAccountId
)
export const vaultIdSchema = prefixedIdSchema("vault").transform((value) => value as VaultId)

export const walletFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .transform((value) => value as WalletFingerprint)

export const chainIdSchema = z.number().int().positive()

export const hexAddressSchema = z
  .string()
  .refine(isAddress, "Invalid EVM address.")
  .transform((value) => getAddress(value))

export const hexDataSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2})*$/u)
  .transform((value) => value as HexData)

export const timestampSchema = z.iso.datetime()
