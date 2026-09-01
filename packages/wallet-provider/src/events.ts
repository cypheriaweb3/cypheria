import { z } from "zod"

import { providerErrorSchema } from "./ethereum.js"
import { jsonRpcValueSchema } from "./json-rpc.js"
import { dappSessionKeySchema } from "./session.js"
import { solanaWalletAccountDescriptorSchema } from "./solana.js"

const eventScope = {
  origin: z.string().url(),
  sessionKey: dappSessionKeySchema,
}

export const walletProviderEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      ...eventScope,
      event: z.literal("ethereum.accountsChanged"),
      payload: z.array(z.string().regex(/^0x[0-9a-f]{40}$/iu)),
    })
    .strict(),
  z
    .object({
      ...eventScope,
      event: z.literal("ethereum.chainChanged"),
      payload: z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu),
    })
    .strict(),
  z
    .object({
      ...eventScope,
      event: z.literal("ethereum.connect"),
      payload: z.object({ chainId: z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu) }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventScope,
      event: z.literal("ethereum.disconnect"),
      payload: providerErrorSchema,
    })
    .strict(),
  z
    .object({
      ...eventScope,
      event: z.literal("ethereum.message"),
      payload: z.object({ data: jsonRpcValueSchema, type: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventScope,
      event: z.literal("solana.accountsChanged"),
      payload: z.array(solanaWalletAccountDescriptorSchema),
    })
    .strict(),
])

export type WalletProviderEvent = z.output<typeof walletProviderEventSchema>
