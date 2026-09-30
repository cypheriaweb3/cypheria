import { sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Marketplaces added through Cypheria, with the source it was given. Server
 * replays the source for an Agent that gains support after an update.
 */
export const pluginMarketplaces = sqliteTable("plugin_marketplaces", {
  name: text("name").primaryKey(),
  source: text("source").notNull(),
  refName: text("ref_name"),
  sparsePaths: text("sparse_paths", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})
