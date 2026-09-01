import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const automationTasks = sqliteTable(
  "automation_tasks",
  {
    auditCorrelationId: text("audit_correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
    definition: text("definition").notNull().default('{"handler":"noop"}'),
    description: text("description"),
    id: text("id").primaryKey(),
    legacyRunHistory: text("run_history").notNull().default("[]"),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull(),
    title: text("title").notNull(),
    trigger: text("trigger").notNull(),
    updatedAt: text("updated_at").notNull(),
    walletPolicyScope: text("wallet_policy_scope").notNull(),
    workspace: text("workspace").notNull(),
  },
  (table) => [
    index("automation_tasks_audit_correlation_id_idx").on(table.auditCorrelationId),
    index("automation_tasks_status_idx").on(table.status),
    index("automation_tasks_workspace_idx").on(table.workspace),
    check(
      "automation_tasks_status_check",
      sql`${table.status} IN ('archived', 'draft', 'enabled', 'paused')`
    ),
    check("automation_tasks_revision_check", sql`${table.revision} > 0`),
  ]
)

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    auditCorrelationId: text("audit_correlation_id").notNull(),
    completedAt: text("completed_at"),
    error: text("error"),
    id: text("id").primaryKey(),
    logs: text("logs").notNull(),
    queuedAt: text("queued_at").notNull().default("1970-01-01T00:00:00.000Z"),
    revision: integer("revision").notNull().default(1),
    startedAt: text("started_at"),
    status: text("status").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => automationTasks.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("automation_runs_audit_correlation_id_idx").on(table.auditCorrelationId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_task_id_idx").on(table.taskId),
    uniqueIndex("automation_runs_active_task_unique")
      .on(table.taskId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    check(
      "automation_runs_status_check",
      sql`${table.status} IN ('cancelled', 'failed', 'queued', 'running', 'succeeded')`
    ),
    check("automation_runs_revision_check", sql`${table.revision} > 0`),
  ]
)
