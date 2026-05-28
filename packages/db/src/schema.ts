import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  value: text("value").notNull(),
})

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  value: text("value").notNull(),
})

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    actor: text("actor").notNull(),
    correlationId: text("correlation_id"),
    createdAt: text("created_at").notNull(),
    eventType: text("event_type").notNull(),
    id: text("id").primaryKey(),
    payloadHash: text("payload_hash"),
    payloadSummary: text("payload_summary"),
    source: text("source").notNull(),
  },
  (table) => [
    index("audit_logs_correlation_id_idx").on(table.correlationId),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_event_type_idx").on(table.eventType),
  ]
)

export const workspaces = sqliteTable(
  "workspaces",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    lastOpenedAt: text("last_opened_at"),
    name: text("name").notNull(),
    path: text("path").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("workspaces_path_idx").on(table.path)]
)

export const automationTasks = sqliteTable(
  "automation_tasks",
  {
    auditCorrelationId: text("audit_correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
    description: text("description"),
    id: text("id").primaryKey(),
    runHistory: text("run_history").notNull(),
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
    startedAt: text("started_at"),
    status: text("status").notNull(),
    taskId: text("task_id").notNull(),
  },
  (table) => [
    index("automation_runs_audit_correlation_id_idx").on(table.auditCorrelationId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_task_id_idx").on(table.taskId),
  ]
)

export const schema = {
  auditLogs,
  automationRuns,
  automationTasks,
  runtimeMetadata,
  settings,
  workspaces,
}
