import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const agentRegistry = sqliteTable("agent_registry", {
  id: text("id").primaryKey(),
  name: text("name"),
  version: text("version"),
  description: text("description"),
  repository: text("repository"),
  website: text("website"),
  icon: text("icon"),
  native: integer("native", { mode: "boolean" }).notNull(),
  installed: integer("installed", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  removedAt: text("removed_at"),
  updatedAt: text("updated_at").notNull(),
})
