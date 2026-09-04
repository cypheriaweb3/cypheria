import { z } from "zod"

import type { CypheriaDatabase } from "./client.js"
import { signingIntentClaims } from "./schema/index.js"

const intentIdSchema = z.string().regex(/^signing_intent_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
const payloadHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)

export type SigningIntentReplayStore = {
  readonly claim: (intentId: string, payloadHash: string) => Promise<boolean>
}

export const createSigningIntentReplayStore = (
  db: CypheriaDatabase,
  now: () => string = () => new Date().toISOString()
): SigningIntentReplayStore => ({
  claim: async (intentIdValue, payloadHashValue) => {
    const intentId = intentIdSchema.parse(intentIdValue)
    const payloadHash = payloadHashSchema.parse(payloadHashValue)
    const inserted = await db
      .insert(signingIntentClaims)
      .values({ intentId, payloadHash, claimedAt: z.iso.datetime().parse(now()) })
      .onConflictDoNothing({ target: signingIntentClaims.intentId })
      .returning({ intentId: signingIntentClaims.intentId })
    return inserted.length === 1
  },
})
