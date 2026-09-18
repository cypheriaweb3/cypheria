export * from "./eip6963.js"
export * from "./ethereum.js"
export * from "./events.js"
export * from "./json-rpc.js"
export * from "./session.js"
export * from "./solana.js"

import { z } from "zod"
import { providerRequestSchema, providerResponseSchema } from "./ethereum.js"
import { solanaProviderRequestSchema, solanaProviderResponseSchema } from "./solana.js"

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
