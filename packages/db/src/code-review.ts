import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import {
  codeReviewPrs,
  type codeReviewPullRequestLists,
  codeReviewRuns,
  type codeReviewStatuses,
} from "./schema/index.js"

export type CodeReviewStatus = (typeof codeReviewStatuses)[number]
export type CodeReviewRecord = typeof codeReviewRuns.$inferSelect

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
      eq(codeReviewRuns.accountKey, keys.accountKey),
      eq(codeReviewRuns.pullRequestKey, keys.pullRequestKey)
    )
  const forRun = (keys: CodeReviewKeys, runId: string) =>
    and(forKeys(keys), eq(codeReviewRuns.runId, runId))
  const forBinding = (binding: CodeReviewChatBinding, runId?: string) =>
    and(
      eq(codeReviewRuns.threadId, binding.threadId),
      eq(codeReviewRuns.turnId, binding.turnId),
      ...(runId == null ? [] : [eq(codeReviewRuns.runId, runId)])
    )
  const background = isNull(codeReviewRuns.threadId)

  const latest = async (keys: CodeReviewKeys) =>
    (
      await db
        .select()
        .from(codeReviewRuns)
        .where(and(forKeys(keys), isNotNull(codeReviewRuns.review)))
        .orderBy(desc(codeReviewRuns.sequence))
        .limit(1)
    )[0]

  const chatByBinding = async (binding: CodeReviewChatBinding, runId?: string) =>
    (await db.select().from(codeReviewRuns).where(forBinding(binding, runId)).limit(1))[0]

  return {
    chatByBinding,
    async claim(keys, review, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx
            .select()
            .from(codeReviewRuns)
            .where(and(forKeys(keys), isNotNull(codeReviewRuns.review)))
            .orderBy(desc(codeReviewRuns.sequence))
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
          .from(codeReviewRuns)
          .where(
            and(
              inArray(codeReviewRuns.status, [...active]),
              background,
              gte(codeReviewRuns.leaseUntil, input.now)
            )
          )
        if ((queued[0]?.value ?? 0) >= CODE_REVIEW_QUEUE_LIMIT) {
          throw new Error("The review queue is full. Wait for a review to finish, then try again.")
        }
        const [row] = await tx
          .insert(codeReviewRuns)
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
        .insert(codeReviewRuns)
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
        .from(codeReviewRuns)
        .where(
          and(
            forKeys(keys),
            eq(codeReviewRuns.status, "completed"),
            isNotNull(codeReviewRuns.review)
          )
        )
        .orderBy(desc(codeReviewRuns.sequence))
    },
    async finishChat(binding, runId, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx.select().from(codeReviewRuns).where(forBinding(binding, runId)).limit(1)
        )[0]
        if (!current || (current.status !== "preparing" && current.status !== "running")) {
          return current
        }
        await tx
          .update(codeReviewRuns)
          .set({
            diffLines: null,
            prepared: sql`json_remove(${codeReviewRuns.prepared}, '$.diff')`,
            review: input.review,
            status: input.status,
            unanchoredFindings: input.status === "completed" ? input.unanchoredFindings : null,
          })
          .where(eq(codeReviewRuns.sequence, current.sequence))
        return (
          await tx
            .select()
            .from(codeReviewRuns)
            .where(eq(codeReviewRuns.sequence, current.sequence))
        )[0]
      })
    },
    async interrupt(keys, record, review) {
      await db
        .update(codeReviewRuns)
        .set({ review, status: "failed" })
        .where(
          and(
            forRun(keys, record.runId),
            eq(codeReviewRuns.leaseUntil, record.leaseUntil),
            background
          )
        )
    },
    latest,
    async latestActiveChat(keys) {
      return (
        await db
          .select()
          .from(codeReviewRuns)
          .where(
            and(
              forKeys(keys),
              isNotNull(codeReviewRuns.threadId),
              inArray(codeReviewRuns.status, ["preparing", "running"])
            )
          )
          .orderBy(desc(codeReviewRuns.sequence))
          .limit(1)
      )[0]
    },
    async prepareChat(binding, runId, input) {
      return db.transaction(async (tx) => {
        const current = (
          await tx.select().from(codeReviewRuns).where(forBinding(binding, runId)).limit(1)
        )[0]
        if (current?.status !== "preparing") return current
        await tx
          .update(codeReviewRuns)
          .set({
            diffLines: input.diffLines,
            prepared: input.prepared,
            review: input.review,
            status: "running",
          })
          .where(eq(codeReviewRuns.sequence, current.sequence))
        return (
          await tx
            .select()
            .from(codeReviewRuns)
            .where(eq(codeReviewRuns.sequence, current.sequence))
        )[0]
      })
    },
    async renew(keys, runId, input) {
      const rows = await db
        .update(codeReviewRuns)
        .set({ leaseUntil: input.now + input.leaseMs })
        .where(and(forRun(keys, runId), inArray(codeReviewRuns.status, [...active]), background))
        .returning({ sequence: codeReviewRuns.sequence })
      return rows.length > 0
    },
    async replaceCompleted(keys, runId, review) {
      const rows = await db
        .update(codeReviewRuns)
        .set({ review })
        .where(and(forRun(keys, runId), eq(codeReviewRuns.status, "completed")))
        .returning()
      return rows[0]
    },
    async start(keys, review, input) {
      return db.transaction(async (tx) => {
        const running = await tx
          .select({ value: count() })
          .from(codeReviewRuns)
          .where(
            and(
              eq(codeReviewRuns.status, "running"),
              background,
              gte(codeReviewRuns.leaseUntil, input.now)
            )
          )
        if ((running[0]?.value ?? 0) >= CODE_REVIEW_RUNNING_LIMIT) return false
        const rows = await tx
          .update(codeReviewRuns)
          .set({
            leaseUntil: input.now + input.leaseMs,
            review: { ...review, status: "running" },
            status: "running",
          })
          .where(
            and(forRun(keys, review.runId), inArray(codeReviewRuns.status, [...active]), background)
          )
          .returning({ sequence: codeReviewRuns.sequence })
        return rows.length > 0
      })
    },
    async update(keys, review, input) {
      const rows = await db
        .update(codeReviewRuns)
        .set({ leaseUntil: input.now + input.leaseMs, review, status: review.status })
        .where(
          and(forRun(keys, review.runId), inArray(codeReviewRuns.status, [...active]), background)
        )
        .returning({ sequence: codeReviewRuns.sequence })
      return rows.length > 0
    },
  }
}

export type CodeReviewPullRequestList = (typeof codeReviewPullRequestLists)[number]
export type CodeReviewPrRecord = typeof codeReviewPrs.$inferSelect

/** How many pull requests each list keeps per account; saving another drops the oldest. */
export const CODE_REVIEW_PR_LIMITS: Record<CodeReviewPullRequestList, number> = {
  pinned: 1200,
  recent: 100,
}

export interface CodeReviewPrPersistenceService {
  /** A list's pull requests for an account, most recently saved first. */
  list(list: CodeReviewPullRequestList, accountKey: string): Promise<CodeReviewPrRecord[]>
  /**
   * Saves a pull request at the top of a list. `updateOnly` refreshes the stored item of one that
   * is already there without moving it, and saves nothing new.
   */
  save(
    list: CodeReviewPullRequestList,
    accountKey: string,
    urlKey: string,
    item: unknown,
    options?: { updateOnly?: boolean; now?: number }
  ): Promise<CodeReviewPrRecord | undefined>
  remove(list: CodeReviewPullRequestList, accountKey: string, urlKey: string): Promise<boolean>
}

export const createCodeReviewPrPersistenceService = (
  db: CypheriaDatabase
): CodeReviewPrPersistenceService => {
  const forList = (list: CodeReviewPullRequestList, accountKey: string) =>
    and(eq(codeReviewPrs.list, list), eq(codeReviewPrs.accountKey, accountKey))
  const forEntry = (list: CodeReviewPullRequestList, accountKey: string, urlKey: string) =>
    and(forList(list, accountKey), eq(codeReviewPrs.urlKey, urlKey))
  return {
    async list(list, accountKey) {
      return db
        .select()
        .from(codeReviewPrs)
        .where(forList(list, accountKey))
        .orderBy(desc(codeReviewPrs.savedAt), desc(codeReviewPrs.urlKey))
        .limit(CODE_REVIEW_PR_LIMITS[list])
    },
    async save(list, accountKey, urlKey, item, options = {}) {
      return db.transaction(async (tx) => {
        if (options.updateOnly) {
          const [updated] = await tx
            .update(codeReviewPrs)
            .set({ item })
            .where(forEntry(list, accountKey, urlKey))
            .returning()
          return updated
        }
        const now = options.now ?? Date.now()
        // Saved times only increase, so a list keeps its order under a coarse or stepped clock.
        const newest = (
          await tx
            .select({ savedAt: codeReviewPrs.savedAt })
            .from(codeReviewPrs)
            .where(forList(list, accountKey))
            .orderBy(desc(codeReviewPrs.savedAt))
            .limit(1)
        )[0]?.savedAt
        const savedAt = newest !== undefined && newest >= now ? newest + 1 : now
        const [saved] = await tx
          .insert(codeReviewPrs)
          .values({ accountKey, item, list, savedAt, urlKey })
          .onConflictDoUpdate({
            set: { item, savedAt },
            target: [codeReviewPrs.list, codeReviewPrs.accountKey, codeReviewPrs.urlKey],
          })
          .returning()
        const overflow = (
          await tx
            .select({ urlKey: codeReviewPrs.urlKey })
            .from(codeReviewPrs)
            .where(forList(list, accountKey))
            .orderBy(desc(codeReviewPrs.savedAt))
        ).slice(CODE_REVIEW_PR_LIMITS[list])
        if (overflow.length > 0) {
          await tx.delete(codeReviewPrs).where(
            and(
              forList(list, accountKey),
              inArray(
                codeReviewPrs.urlKey,
                overflow.map((entry) => entry.urlKey)
              )
            )
          )
        }
        return saved
      })
    },
    async remove(list, accountKey, urlKey) {
      const removed = await db
        .delete(codeReviewPrs)
        .where(forEntry(list, accountKey, urlKey))
        .returning({ urlKey: codeReviewPrs.urlKey })
      return removed.length > 0
    },
  }
}
