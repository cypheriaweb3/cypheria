import { and, asc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { installedPlugins, pluginAgentBindings, pluginMarketplaces } from "./schema/index.js"

export type PluginMarketplaceRecord = typeof pluginMarketplaces.$inferSelect
export type InstalledPluginRecord = typeof installedPlugins.$inferSelect
export type PluginAgentBindingRecord = typeof pluginAgentBindings.$inferSelect

type Timestamps = "createdAt" | "updatedAt"
export type PluginMarketplaceInput = Omit<PluginMarketplaceRecord, Timestamps>
export type InstalledPluginInput = Omit<InstalledPluginRecord, Timestamps>
export type PluginAgentBindingInput = Omit<PluginAgentBindingRecord, "updatedAt">

export type PluginPersistenceService = {
  marketplaces: {
    get(id: string): Promise<PluginMarketplaceRecord | undefined>
    list(): Promise<PluginMarketplaceRecord[]>
    remove(id: string): Promise<boolean>
    upsert(input: PluginMarketplaceInput, now?: string): Promise<PluginMarketplaceRecord>
  }
  plugins: {
    get(id: string): Promise<InstalledPluginRecord | undefined>
    list(marketplaceId?: string): Promise<InstalledPluginRecord[]>
    remove(id: string): Promise<boolean>
    upsert(input: InstalledPluginInput, now?: string): Promise<InstalledPluginRecord>
  }
  bindings: {
    get(pluginId: string, agentId: string): Promise<PluginAgentBindingRecord | undefined>
    list(filter?: { agentId?: string; pluginId?: string }): Promise<PluginAgentBindingRecord[]>
    remove(pluginId: string, agentId: string): Promise<boolean>
    upsert(input: PluginAgentBindingInput, now?: string): Promise<PluginAgentBindingRecord>
  }
}

const timestamp = (): string => new Date().toISOString()

const required = <T>(record: T | undefined, what: string): T => {
  if (!record) throw new Error(`Failed to save ${what}`)
  return record
}

export const createPluginPersistenceService = (db: CypheriaDatabase): PluginPersistenceService => ({
  marketplaces: {
    get: async (id) => {
      const [record] = await db
        .select()
        .from(pluginMarketplaces)
        .where(eq(pluginMarketplaces.id, id))
        .limit(1)
      return record
    },
    list: () => db.select().from(pluginMarketplaces).orderBy(asc(pluginMarketplaces.id)),
    remove: async (id) =>
      (
        await db
          .delete(pluginMarketplaces)
          .where(eq(pluginMarketplaces.id, id))
          .returning({ id: pluginMarketplaces.id })
      ).length > 0,
    upsert: async (input, now = timestamp()) => {
      const { id, ...values } = input
      const set = { ...values, updatedAt: now }
      const [record] = await db
        .insert(pluginMarketplaces)
        .values({ ...set, createdAt: now, id })
        .onConflictDoUpdate({ set, target: pluginMarketplaces.id })
        .returning()
      return required(record, `plugin marketplace ${id}`)
    },
  },
  plugins: {
    get: async (id) => {
      const [record] = await db
        .select()
        .from(installedPlugins)
        .where(eq(installedPlugins.id, id))
        .limit(1)
      return record
    },
    list: (marketplaceId) =>
      db
        .select()
        .from(installedPlugins)
        .where(marketplaceId ? eq(installedPlugins.marketplaceId, marketplaceId) : undefined)
        .orderBy(asc(installedPlugins.id)),
    remove: async (id) =>
      (
        await db
          .delete(installedPlugins)
          .where(eq(installedPlugins.id, id))
          .returning({ id: installedPlugins.id })
      ).length > 0,
    upsert: async (input, now = timestamp()) => {
      const { id, ...values } = input
      const set = { ...values, updatedAt: now }
      const [record] = await db
        .insert(installedPlugins)
        .values({ ...set, createdAt: now, id })
        .onConflictDoUpdate({ set, target: installedPlugins.id })
        .returning()
      return required(record, `installed plugin ${id}`)
    },
  },
  bindings: {
    get: async (pluginId, agentId) => {
      const [record] = await db
        .select()
        .from(pluginAgentBindings)
        .where(
          and(eq(pluginAgentBindings.pluginId, pluginId), eq(pluginAgentBindings.agentId, agentId))
        )
        .limit(1)
      return record
    },
    list: (filter = {}) =>
      db
        .select()
        .from(pluginAgentBindings)
        .where(
          and(
            filter.pluginId ? eq(pluginAgentBindings.pluginId, filter.pluginId) : undefined,
            filter.agentId ? eq(pluginAgentBindings.agentId, filter.agentId) : undefined
          )
        )
        .orderBy(asc(pluginAgentBindings.pluginId), asc(pluginAgentBindings.agentId)),
    remove: async (pluginId, agentId) =>
      (
        await db
          .delete(pluginAgentBindings)
          .where(
            and(
              eq(pluginAgentBindings.pluginId, pluginId),
              eq(pluginAgentBindings.agentId, agentId)
            )
          )
          .returning({ pluginId: pluginAgentBindings.pluginId })
      ).length > 0,
    upsert: async (input, now = timestamp()) => {
      const { agentId, pluginId, ...values } = input
      const set = { ...values, updatedAt: now }
      const [record] = await db
        .insert(pluginAgentBindings)
        .values({ ...set, agentId, pluginId })
        .onConflictDoUpdate({
          set,
          target: [pluginAgentBindings.pluginId, pluginAgentBindings.agentId],
        })
        .returning()
      return required(record, `plugin binding ${pluginId} for ${agentId}`)
    },
  },
})
