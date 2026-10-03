import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { threads } from "./project-thread.js"

export const codeReviewStatuses = [
  "preparing",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const

/**
 * Private Code Review runs. A background run stores its review and holds a lease while it runs; a
 * run in a chat is bound to one Thread turn and stores the diff lines its findings must land on.
 */
export const codeReviewRuns = sqliteTable(
  "code_review_runs",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    accountKey: text("account_key").notNull(),
    pullRequestKey: text("pr_key").notNull(),
    runId: text("run_id").notNull(),
    status: text("status", { enum: codeReviewStatuses }).notNull(),
    leaseUntil: integer("lease_until").notNull().default(0),
    review: text("review", { mode: "json" }).$type<unknown>(),
    chatTarget: text("chat_target", { mode: "json" }).$type<unknown>(),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    startedAt: integer("started_at"),
    diffLines: text("diff_lines", { mode: "json" }).$type<unknown>(),
    prepared: text("prepared", { mode: "json" }).$type<unknown>(),
    unanchoredFindings: text("unanchored_findings", { mode: "json" }).$type<unknown>(),
  },
  (table) => [
    uniqueIndex("code_review_runs_run_unique").on(
      table.accountKey,
      table.pullRequestKey,
      table.runId
    ),
    index("code_review_runs_pr_idx").on(table.accountKey, table.pullRequestKey, table.sequence),
    index("code_review_runs_status_lease_idx").on(table.status, table.leaseUntil),
    uniqueIndex("code_review_runs_chat_turn_unique")
      .on(table.threadId, table.turnId)
      .where(sql`${table.threadId} IS NOT NULL`),
    check(
      "code_review_runs_status_check",
      sql`${table.status} IN ('preparing', 'queued', 'running', 'completed', 'failed', 'cancelled')`
    ),
    check(
      "code_review_runs_target_check",
      sql`${table.review} IS NOT NULL OR ${table.chatTarget} IS NOT NULL`
    ),
    check(
      "code_review_runs_chat_turn_check",
      sql`(${table.threadId} IS NULL) = (${table.turnId} IS NULL)`
    ),
    check("code_review_runs_lease_check", sql`${table.leaseUntil} >= 0`),
  ]
)

export const codeReviewPullRequestLists = ["pinned", "recent"] as const

/**
 * Pull requests the Code Review sidebar keeps per provider account: the ones the user pinned, and
 * the ones they opened most recently. `item` holds what the sidebar shows without a provider read.
 */
export const codeReviewPrs = sqliteTable(
  "code_review_prs",
  {
    list: text("list", { enum: codeReviewPullRequestLists }).notNull(),
    accountKey: text("account_key").notNull(),
    urlKey: text("url_key").notNull(),
    item: text("item", { mode: "json" }).$type<unknown>().notNull(),
    savedAt: integer("saved_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.list, table.accountKey, table.urlKey] }),
    index("code_review_prs_order_idx").on(table.list, table.accountKey, table.savedAt),
    check("code_review_prs_list_check", sql`${table.list} IN ('pinned', 'recent')`),
    check("code_review_prs_account_check", sql`length(${table.accountKey}) > 0`),
    check("code_review_prs_url_check", sql`length(${table.urlKey}) > 0`),
  ]
)
