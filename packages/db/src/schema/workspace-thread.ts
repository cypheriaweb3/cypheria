import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { threads } from "./project-thread.js"

/**
 * The chat a workspace page shows beside its App, such as a plugin's global page or a pull request
 * in Code Review. Every client of the Server reopens the same chat there.
 */
export const workspaceThreads = sqliteTable(
  "workspace_threads",
  {
    workspaceKey: text("workspace_key").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("workspace_threads_thread_idx").on(table.threadId),
    check("workspace_threads_key_check", sql`length(${table.workspaceKey}) > 0`),
    check("workspace_threads_updated_at_check", sql`${table.updatedAt} >= 0`),
  ]
)
