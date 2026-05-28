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

export const schema = {
  auditLogs,
  runtimeMetadata,
  settings,
  workspaces,
}
