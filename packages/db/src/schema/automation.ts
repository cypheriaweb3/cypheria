import {
  type AutomationAuditCorrelationId,
  type AutomationRunError,
  type AutomationRunId,
  type AutomationRunLogEntry,
  type AutomationTaskDefinition,
  type AutomationTaskId,
  type AutomationTaskRun,
  type AutomationTrigger,
  type AutomationWalletPolicyScope,
  type AutomationWorkspaceRef,
  automationRunStatuses,
  automationTaskStatuses,
} from "@cypheria/automation-core"
import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const automationTasks = sqliteTable(
  "automation_tasks",
  {
    id: text("id").$type<AutomationTaskId>().primaryKey(),
    workspace: text("workspace", { mode: "json" }).$type<AutomationWorkspaceRef>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    trigger: text("trigger", { mode: "json" }).$type<AutomationTrigger>().notNull(),
    definition: text("definition", { mode: "json" })
      .$type<AutomationTaskDefinition>()
      .notNull()
      .default({ handler: "noop" }),
    walletPolicyScope: text("wallet_policy_scope", { mode: "json" })
      .$type<AutomationWalletPolicyScope>()
      .notNull(),
    legacyRunHistory: text("run_history", { mode: "json" })
      .$type<AutomationTaskRun[]>()
      .notNull()
      .default([]),
    status: text("status", { enum: automationTaskStatuses }).notNull(),
    revision: integer("revision").notNull().default(1),
    auditCorrelationId: text("audit_correlation_id")
      .$type<AutomationAuditCorrelationId>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
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
    id: text("id").$type<AutomationRunId>().primaryKey(),
    taskId: text("task_id")
      .$type<AutomationTaskId>()
      .notNull()
      .references(() => automationTasks.id, { onDelete: "cascade" }),
    logs: text("logs", { mode: "json" }).$type<AutomationRunLogEntry[]>().notNull(),
    error: text("error", { mode: "json" }).$type<AutomationRunError>(),
    status: text("status", { enum: automationRunStatuses }).notNull(),
    revision: integer("revision").notNull().default(1),
    auditCorrelationId: text("audit_correlation_id")
      .$type<AutomationAuditCorrelationId>()
      .notNull(),
    queuedAt: text("queued_at").notNull().default("1970-01-01T00:00:00.000Z"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
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
