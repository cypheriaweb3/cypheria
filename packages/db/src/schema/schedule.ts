import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { threads } from "./project-thread.js"

export const schedules = sqliteTable(
  "schedules",
  {
    cadence: text("cadence", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at").notNull(),
    id: text("id").primaryKey(),
    lastRunAt: integer("last_run_at"),
    lockExpiresAt: integer("lock_expires_at"),
    lockedBy: text("locked_by"),
    name: text("name"),
    nextRunAt: integer("next_run_at"),
    revision: integer("revision").notNull(),
    status: text("status", { enum: ["active", "paused", "completed"] }).notNull(),
    target: text("target", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("schedules_due_idx").on(table.status, table.nextRunAt),
    index("schedules_lock_expires_at_idx").on(table.lockExpiresAt),
    check("schedules_revision_check", sql`${table.revision} >= 0`),
    check("schedules_status_check", sql`${table.status} IN ('active', 'paused', 'completed')`),
    check("schedules_created_at_check", sql`${table.createdAt} >= 0`),
    check("schedules_updated_at_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "schedules_lock_check",
      sql`(${table.lockedBy} IS NULL AND ${table.lockExpiresAt} IS NULL) OR (${table.lockedBy} IS NOT NULL AND ${table.lockExpiresAt} IS NOT NULL)`
    ),
  ]
)

export const scheduleRuns = sqliteTable(
  "schedule_runs",
  {
    createdThreadId: text("created_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    finishedAt: integer("finished_at"),
    id: text("id").primaryKey(),
    result: text("result", { mode: "json" }).$type<unknown>(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    scheduledFor: integer("scheduled_for").notNull(),
    startedAt: integer("started_at").notNull(),
    status: text("status", {
      enum: ["running", "succeeded", "failed", "interrupted"],
    }).notNull(),
    targetType: text("target_type", {
      enum: ["new-thread", "thread", "web3"],
    }).notNull(),
  },
  (table) => [
    index("schedule_runs_schedule_started_idx").on(table.scheduleId, table.startedAt),
    index("schedule_runs_status_idx").on(table.status),
    check(
      "schedule_runs_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'interrupted')`
    ),
    check(
      "schedule_runs_target_type_check",
      sql`${table.targetType} IN ('new-thread', 'thread', 'web3')`
    ),
    check("schedule_runs_scheduled_for_check", sql`${table.scheduledFor} >= 0`),
    check("schedule_runs_started_at_check", sql`${table.startedAt} >= 0`),
    check(
      "schedule_runs_finished_at_check",
      sql`${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`
    ),
  ]
)
