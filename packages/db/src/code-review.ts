import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { type codeReviewStatuses, codeReviews } from "./schema/index.js"

export type CodeReviewStatus = (typeof codeReviewStatuses)[number]
export type CodeReviewRecord = typeof codeReviews.$inferSelect

/** The part of a stored review the repository reads; the Server validates the rest. */
export type StoredCodeReview = {
  readonly runId: string
  readonly status: Exclude<CodeReviewStatus, "preparing">
  readonly [key: string]: unknown
}

export type CodeReviewKeys = { readonly accountKey: string; readonly pullRequestKey: string }
export type CodeReviewChatBinding = { readonly threadId: string; readonly turnId: string }

/** How many background runs may wait or run, and how many may run at once. */
export const CODE_REVIEW_QUEUE_LIMIT = 20
export const CODE_REVIEW_RUNNING_LIMIT = 2

const active = ["queued", "running"] as const

export interface CodeReviewPersistenceService {
  /** The latest stored review of a pull request for an account. */
  latest(keys: CodeReviewKeys): Promise<CodeReviewRecord | undefined>
  /** Completed reviews, newest first. */
  completed(keys: CodeReviewKeys): Promise<CodeReviewRecord[]>
  /**
   * Inserts a queued background review unless an active one exists or `keep` accepts the latest
   * one. Returns the row that now represents the pull request.
   */
  claim(
    keys: CodeReviewKeys,
    review: StoredCodeReview,
    input: { now: number; leaseMs: number; keep: (latest: CodeReviewRecord) => boolean }
  ): Promise<CodeReviewRecord>
  /** Writes a background review while it is still active; false when it is no longer active. */
  update(
    keys: CodeReviewKeys,
    review: StoredCodeReview,
    input: { now: number; leaseMs: number }
  ): Promise<boolean>
  /** Moves a queued review to running when fewer than the limit are running. */
  start(
    keys: CodeReviewKeys,
    review: StoredCodeReview,
    input: { now: number; leaseMs: number }
  ): Promise<boolean>
  /** Extends an active background review's lease. */
  renew(
    keys: CodeReviewKeys,
    runId: string,
    input: { now: number; leaseMs: number }
  ): Promise<boolean>
  /** Marks an active review whose lease expired as interrupted. */
  interrupt(keys: CodeReviewKeys, record: CodeReviewRecord, review: StoredCodeReview): Promise<void>
  /** Records a chat review for a Thread turn, or returns the one already recorded for it. */
  claimChat(
    keys: CodeReviewKeys,
    input: { binding: CodeReviewChatBinding; chatTarget: unknown; runId: string; now: number }
  ): Promise<CodeReviewRecord | undefined>
  chatByBinding(
    binding: CodeReviewChatBinding,
    runId?: string
  ): Promise<CodeReviewRecord | undefined>
  latestActiveChat(keys: CodeReviewKeys): Promise<CodeReviewRecord | undefined>
  /** Moves a preparing chat review to running with its review, diff lines, and prepared PR. */
  prepareChat(
    binding: CodeReviewChatBinding,
    runId: string,
    input: { review: StoredCodeReview; diffLines: unknown; prepared: unknown }
  ): Promise<CodeReviewRecord | undefined>
  /** Ends a preparing or running chat review. */
  finishChat(
    binding: CodeReviewChatBinding,
    runId: string,
    input: {
      status: "completed" | "failed" | "cancelled"
      review: StoredCodeReview | null
      unanchoredFindings: unknown
    }
  ): Promise<CodeReviewRecord | undefined>
  /** Replaces a completed review, such as after resolving one of its findings. */
  replaceCompleted(
    keys: CodeReviewKeys,
    runId: string,
    review: StoredCodeReview
  ): Promise<CodeReviewRecord | undefined>
}

export const createCodeReviewPersistenceService = (
  db: CypheriaDatabase
): CodeReviewPersistenceService => {
  const forKeys = (keys: CodeReviewKeys) =>
    and(
      eq(codeReviews.accountKey, keys.accountKey),
      eq(codeReviews.pullRequestKey, keys.pullRequestKey)
    )
  const forRun = (keys: CodeReviewKeys, runId: string) =>
    and(forKeys(keys), eq(codeReviews.runId, runId))
  const forBinding = (binding: CodeReviewChatBinding, runId?: string) =>
    and(
      eq(codeReviews.threadId, binding.threadId),
      eq(codeReviews.turnId, binding.turnId),
      ...(runId == null ? [] : [eq(codeReviews.runId, runId)])
    )
  const background = isNull(codeReviews.threadId)

  const latest = async (keys: CodeReviewKeys) =>
    (
      await db
        .select()
        .from(codeReviews)
        .where(and(forKeys(keys), isNotNull(codeReviews.review)))
        .orderBy(desc(codeReviews.sequence))
        .limit(1)
    )[0]

  const chatByBinding = async (binding: CodeReviewChatBinding, runId?: string) =>
    (await db.select().from(codeReviews).where(forBinding(binding, runId)).limit(1))[0]

  return {
    chatByBinding,
    async claim(keys, review, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx
            .select()
            .from(codeReviews)
            .where(and(forKeys(keys), isNotNull(codeReviews.review)))
            .orderBy(desc(codeReviews.sequence))
            .limit(1)
        )[0]
        if (
          current &&
          (((active as readonly string[]).includes(current.status) &&
            (current.threadId != null || current.leaseUntil >= input.now)) ||
            input.keep(current))
        ) {
          return current
        }
        const queued = await tx
          .select({ value: count() })
          .from(codeReviews)
          .where(
            and(
              inArray(codeReviews.status, [...active]),
              background,
              gte(codeReviews.leaseUntil, input.now)
            )
          )
        if ((queued[0]?.value ?? 0) >= CODE_REVIEW_QUEUE_LIMIT) {
          throw new Error("The review queue is full. Wait for a review to finish, then try again.")
        }
        const [row] = await tx
          .insert(codeReviews)
          .values({
            ...keys,
            leaseUntil: input.now + input.leaseMs,
            review,
            runId: review.runId,
            status: review.status,
          })
          .returning()
        return row as CodeReviewRecord
      })
    },
    async claimChat(keys, input) {
      await db
        .insert(codeReviews)
        .values({
          ...keys,
          chatTarget: input.chatTarget,
          runId: input.runId,
          startedAt: input.now,
          status: "preparing",
          threadId: input.binding.threadId,
          turnId: input.binding.turnId,
        })
        .onConflictDoNothing()
      const current = await chatByBinding(input.binding)
      return current &&
        current.accountKey === keys.accountKey &&
        current.pullRequestKey === keys.pullRequestKey
        ? current
        : undefined
    },
    async completed(keys) {
      return db
        .select()
        .from(codeReviews)
        .where(
          and(forKeys(keys), eq(codeReviews.status, "completed"), isNotNull(codeReviews.review))
        )
        .orderBy(desc(codeReviews.sequence))
    },
    async finishChat(binding, runId, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx.select().from(codeReviews).where(forBinding(binding, runId)).limit(1)
        )[0]
        if (!current || (current.status !== "preparing" && current.status !== "running")) {
          return current
        }
        await tx
          .update(codeReviews)
          .set({
            diffLines: null,
            prepared: sql`json_remove(${codeReviews.prepared}, '$.diff')`,
            review: input.review,
            status: input.status,
            unanchoredFindings: input.status === "completed" ? input.unanchoredFindings : null,
          })
          .where(eq(codeReviews.sequence, current.sequence))
        return (
          await tx.select().from(codeReviews).where(eq(codeReviews.sequence, current.sequence))
        )[0]
      })
    },
    async interrupt(keys, record, review) {
      await db
        .update(codeReviews)
        .set({ review, status: "failed" })
        .where(
          and(forRun(keys, record.runId), eq(codeReviews.leaseUntil, record.leaseUntil), background)
        )
    },
    latest,
    async latestActiveChat(keys) {
      return (
        await db
          .select()
          .from(codeReviews)
          .where(
            and(
              forKeys(keys),
              isNotNull(codeReviews.threadId),
              inArray(codeReviews.status, ["preparing", "running"])
            )
          )
          .orderBy(desc(codeReviews.sequence))
          .limit(1)
      )[0]
    },
    async prepareChat(binding, runId, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx.select().from(codeReviews).where(forBinding(binding, runId)).limit(1)
        )[0]
        if (current?.status !== "preparing") return current
        await tx
          .update(codeReviews)
          .set({
            diffLines: input.diffLines,
            prepared: input.prepared,
            review: input.review,
            status: "running",
          })
          .where(eq(codeReviews.sequence, current.sequence))
        return (
          await tx.select().from(codeReviews).where(eq(codeReviews.sequence, current.sequence))
        )[0]
      })
    },
    async renew(keys, runId, input) {
      const rows = await db
        .update(codeReviews)
        .set({ leaseUntil: input.now + input.leaseMs })
        .where(and(forRun(keys, runId), inArray(codeReviews.status, [...active]), background))
        .returning({ sequence: codeReviews.sequence })
      return rows.length > 0
    },
    async replaceCompleted(keys, runId, review) {
      const rows = await db
        .update(codeReviews)
        .set({ review })
        .where(and(forRun(keys, runId), eq(codeReviews.status, "completed")))
        .returning()
      return rows[0]
    },
    async start(keys, review, input) {
      return db.transaction(async (tx) => {
        const running = await tx
          .select({ value: count() })
          .from(codeReviews)
          .where(
            and(
              eq(codeReviews.status, "running"),
              background,
              gte(codeReviews.leaseUntil, input.now)
            )
          )
        if ((running[0]?.value ?? 0) >= CODE_REVIEW_RUNNING_LIMIT) return false
        const rows = await tx
          .update(codeReviews)
          .set({
            leaseUntil: input.now + input.leaseMs,
            review: { ...review, status: "running" },
            status: "running",
          })
          .where(
            and(forRun(keys, review.runId), inArray(codeReviews.status, [...active]), background)
          )
          .returning({ sequence: codeReviews.sequence })
        return rows.length > 0
      })
    },
    async update(keys, review, input) {
      const rows = await db
        .update(codeReviews)
        .set({ leaseUntil: input.now + input.leaseMs, review, status: review.status })
        .where(
          and(forRun(keys, review.runId), inArray(codeReviews.status, [...active]), background)
        )
        .returning({ sequence: codeReviews.sequence })
      return rows.length > 0
    },
  }
}
