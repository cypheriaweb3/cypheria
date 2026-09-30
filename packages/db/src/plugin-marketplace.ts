import { asc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { pluginMarketplaces } from "./schema/index.js"

export type PluginMarketplaceRecord = typeof pluginMarketplaces.$inferSelect
export type PluginMarketplaceSource = {
  name: string
  refName?: string | null
  source: string
  sparsePaths?: readonly string[] | null
}

export type PluginMarketplacePersistenceService = {
  get(name: string): Promise<PluginMarketplaceRecord | undefined>
  list(): Promise<PluginMarketplaceRecord[]>
  remove(name: string): Promise<boolean>
  upsert(source: PluginMarketplaceSource, now?: string): Promise<PluginMarketplaceRecord>
}

const timestamp = (): string => new Date().toISOString()

export const createPluginMarketplacePersistenceService = (
  db: CypheriaDatabase
): PluginMarketplacePersistenceService => ({
  get: async (name) => {
    const [record] = await db
      .select()
      .from(pluginMarketplaces)
      .where(eq(pluginMarketplaces.name, name))
      .limit(1)
    return record
  },
  list: () => db.select().from(pluginMarketplaces).orderBy(asc(pluginMarketplaces.name)),
  remove: async (name) => {
    const removed = await db
      .delete(pluginMarketplaces)
      .where(eq(pluginMarketplaces.name, name))
      .returning({ name: pluginMarketplaces.name })
    return removed.length > 0
  },
  upsert: async (source, now = timestamp()) => {
    const values = {
      refName: source.refName ?? null,
      source: source.source,
      sparsePaths: source.sparsePaths ? [...source.sparsePaths] : null,
      updatedAt: now,
    }
    const [record] = await db
      .insert(pluginMarketplaces)
      .values({ ...values, createdAt: now, name: source.name })
      .onConflictDoUpdate({ set: values, target: pluginMarketplaces.name })
      .returning()
    if (!record) throw new Error(`Failed to save plugin marketplace: ${source.name}`)
    return record
  },
})
