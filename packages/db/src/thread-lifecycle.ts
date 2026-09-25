import { randomUUID } from "node:crypto"

import { and, asc, eq, inArray, or } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { threadLifecycleOperations } from "./schema/index.js"

export const threadLifecycleKinds = ["create", "delete"] as const
export const threadLifecycleStatuses = [
  "pending",
  "harness-created",
  "harness-deleted",
  "failed",
] as const

export type ThreadLifecycleKind = (typeof threadLifecycleKinds)[number]
export type ThreadLifecycleStatus = (typeof threadLifecycleStatuses)[number]
export type ThreadLifecycleOperationRecord = typeof threadLifecycleOperations.$inferSelect

export type BeginThreadLifecycleOperationInput = {
  readonly agentId: string
  readonly agentSessionId?: string | null
  readonly input: Record<string, unknown>
  readonly kind: ThreadLifecycleKind
  readonly threadId: string
}

export type ThreadLifecyclePersistenceService = {
  begin(
    input: BeginThreadLifecycleOperationInput,
    now?: number
  ): Promise<ThreadLifecycleOperationRecord>
  complete(id: string): Promise<void>
  fail(id: string, error: string, now?: number): Promise<ThreadLifecycleOperationRecord>
  get(id: string): Promise<ThreadLifecycleOperationRecord | undefined>
  listRecoverable(): Promise<ThreadLifecycleOperationRecord[]>
  transition(
    id: string,
    patch: {
      readonly agentSessionId?: string | null
      readonly status: Exclude<ThreadLifecycleStatus, "pending" | "failed">
    },
    now?: number
  ): Promise<ThreadLifecycleOperationRecord>
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

const requireOperation = async (
  db: CypheriaDatabase,
  id: string
): Promise<ThreadLifecycleOperationRecord> => {
  const [record] = await db
    .select()
    .from(threadLifecycleOperations)
    .where(eq(threadLifecycleOperations.id, id))
    .limit(1)
  if (!record) throw new Error(`Thread lifecycle operation not found: ${id}`)
  return record
}

export const createThreadLifecyclePersistenceService = (
  db: CypheriaDatabase
): ThreadLifecyclePersistenceService => ({
  begin: async (input, now = nowSeconds()) => {
    const [record] = await db
      .insert(threadLifecycleOperations)
      .values({
        agentId: input.agentId,
        agentSessionId: input.agentSessionId ?? null,
        createdAt: now,
        error: null,
        id: `tlo_${randomUUID()}`,
        input: input.input,
        kind: input.kind,
        status: "pending",
        threadId: input.threadId,
        updatedAt: now,
      })
      .returning()
    if (!record) throw new Error("Thread lifecycle operation was not created")
    return record
  },
  complete: async (id) => {
    await requireOperation(db, id)
    await db.delete(threadLifecycleOperations).where(eq(threadLifecycleOperations.id, id))
  },
  fail: async (id, error, now = nowSeconds()) => {
    await requireOperation(db, id)
    const [record] = await db
      .update(threadLifecycleOperations)
      .set({ error, status: "failed", updatedAt: now })
      .where(eq(threadLifecycleOperations.id, id))
      .returning()
    if (!record) throw new Error("Thread lifecycle operation was not marked failed")
    return record
  },
  get: async (id) => {
    const [record] = await db
      .select()
      .from(threadLifecycleOperations)
      .where(eq(threadLifecycleOperations.id, id))
      .limit(1)
    return record
  },
  listRecoverable: () =>
    db
      .select()
      .from(threadLifecycleOperations)
      .where(
        or(
          inArray(threadLifecycleOperations.status, [
            "pending",
            "harness-created",
            "harness-deleted",
          ]),
          and(
            eq(threadLifecycleOperations.kind, "delete"),
            eq(threadLifecycleOperations.status, "failed")
          )
        )
      )
      .orderBy(asc(threadLifecycleOperations.createdAt), asc(threadLifecycleOperations.id)),
  transition: async (id, patch, now = nowSeconds()) => {
    await requireOperation(db, id)
    const [record] = await db
      .update(threadLifecycleOperations)
      .set({
        ...(patch.agentSessionId === undefined ? {} : { agentSessionId: patch.agentSessionId }),
        error: null,
        status: patch.status,
        updatedAt: now,
      })
      .where(eq(threadLifecycleOperations.id, id))
      .returning()
    if (!record) throw new Error("Thread lifecycle operation was not updated")
    return record
  },
})
