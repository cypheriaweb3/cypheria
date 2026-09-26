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

export const threadAttachments = sqliteTable(
  "thread_attachments",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    attachmentType: text("attachment_type", { enum: ["pull_request", "worktree"] }).notNull(),
    identityKey: text("identity_key").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.attachmentType, table.identityKey] }),
    index("thread_attachments_identity_idx").on(table.attachmentType, table.identityKey),
    uniqueIndex("thread_attachments_worktree_identity_unique")
      .on(table.attachmentType, table.identityKey)
      .where(sql`${table.attachmentType} = 'worktree'`),
    check(
      "thread_attachments_type_check",
      sql`${table.attachmentType} IN ('pull_request', 'worktree')`
    ),
    check("thread_attachments_identity_key_check", sql`length(${table.identityKey}) > 0`),
    check("thread_attachments_created_at_check", sql`${table.createdAt} >= 0`),
    check("thread_attachments_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
)
