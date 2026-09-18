export * from "./eip6963.ts"
export * from "./ethereum.ts"
export * from "./events.ts"
export * from "./json-rpc.ts"
export * from "./session.ts"
export * from "./solana.ts"

import { z } from "zod"
import { providerRequestSchema, providerResponseSchema } from "./ethereum.ts"
import { solanaProviderRequestSchema, solanaProviderResponseSchema } from "./solana.ts"

export const walletProviderRequestSchema = z.union([
  providerRequestSchema,
  solanaProviderRequestSchema,
])
export const walletProviderResponseSchema = z.union([
  providerResponseSchema,
  solanaProviderResponseSchema,
])
export type WalletProviderRequest = z.output<typeof walletProviderRequestSchema>
export type WalletProviderResponse = z.output<typeof walletProviderResponseSchema>
