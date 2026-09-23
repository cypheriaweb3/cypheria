import { createHash } from "node:crypto"

import { and, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { threadMessageRequests } from "./schema/index.js"

export type ThreadMessageRequestResolution =
  | { readonly status: "new" }
  | { readonly status: "pending" }
  | { readonly status: "conflict" }
  | { readonly status: "completed"; readonly turnId: string }

export type ThreadMessageRequestInput = {
  readonly clientMessageId: string
  readonly request: unknown
  readonly threadId: string
}

export type ThreadMessageRequestPersistenceService = {
  claim(input: ThreadMessageRequestInput, now?: number): Promise<ThreadMessageRequestResolution>
  complete(threadId: string, clientMessageId: string, turnId: string, now?: number): Promise<void>
  inspect(input: ThreadMessageRequestInput): Promise<ThreadMessageRequestResolution>
}

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    }
    return candidate
  }) ?? "undefined"

const fingerprint = (request: unknown): string =>
  createHash("sha256").update(stableJson(request)).digest("hex")

const resolveRecord = (
  record: typeof threadMessageRequests.$inferSelect | undefined,
  expectedFingerprint: string
): ThreadMessageRequestResolution => {
  if (!record) return { status: "new" }
  if (record.fingerprint !== expectedFingerprint) return { status: "conflict" }
  if (record.status === "pending") return { status: "pending" }
  if (!record.turnId) throw new Error("Completed Thread message request is missing its turn ID")
  return { status: "completed", turnId: record.turnId }
}

const read = async (
  db: Pick<CypheriaDatabase, "select">,
  threadId: string,
  clientMessageId: string
): Promise<typeof threadMessageRequests.$inferSelect | undefined> => {
  const [record] = await db
    .select()
    .from(threadMessageRequests)
    .where(
      and(
        eq(threadMessageRequests.threadId, threadId),
        eq(threadMessageRequests.clientMessageId, clientMessageId)
      )
    )
    .limit(1)
  return record
}

export const createThreadMessageRequestPersistenceService = (
  db: CypheriaDatabase
): ThreadMessageRequestPersistenceService => ({
  async claim(input, now = Date.now()) {
    const expectedFingerprint = fingerprint(input.request)
    return db.transaction(async (tx) => {
      const existing = await read(tx, input.threadId, input.clientMessageId)
      const resolution = resolveRecord(existing, expectedFingerprint)
      if (resolution.status !== "new") return resolution
      await tx.insert(threadMessageRequests).values({
        clientMessageId: input.clientMessageId,
        createdAt: now,
        fingerprint: expectedFingerprint,
        status: "pending",
        threadId: input.threadId,
        turnId: null,
        updatedAt: now,
      })
      return resolution
    })
  },

  async complete(threadId, clientMessageId, turnId, now = Date.now()) {
    const existing = await read(db, threadId, clientMessageId)
    if (!existing) throw new Error("Thread message request was not claimed")
    if (existing.status === "completed") {
      if (existing.turnId !== turnId) throw new Error("Thread message request turn ID changed")
      return
    }
    await db
      .update(threadMessageRequests)
      .set({ status: "completed", turnId, updatedAt: now })
      .where(
        and(
          eq(threadMessageRequests.threadId, threadId),
          eq(threadMessageRequests.clientMessageId, clientMessageId)
        )
      )
  },

  async inspect(input) {
    return resolveRecord(
      await read(db, input.threadId, input.clientMessageId),
      fingerprint(input.request)
    )
  },
})
