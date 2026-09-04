import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id"),
    actor: text("actor").notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    payloadHash: text("payload_hash"),
    payloadSummary: text("payload_summary"),
    createdAt: text("created_at").notNull(),
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
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastOpenedAt: text("last_opened_at"),
  },
  (table) => [index("workspaces_path_idx").on(table.path)]
)
