import { asc, eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { agentRegistry } from "./schema/index.js"

export type AgentRegistryRecord = typeof agentRegistry.$inferSelect
export type AgentVersionMetadata = Pick<
  AgentRegistryRecord,
  "description" | "icon" | "name" | "repository" | "version" | "website"
> & { version: string }

export type AgentRegistryPersistenceService = {
  get(id: string): Promise<AgentRegistryRecord | undefined>
  list(): Promise<AgentRegistryRecord[]>
  reconcile(entries: readonly { id: string; native: boolean }[], now?: string): Promise<void>
  setEnabled(id: string, enabled: boolean, now?: string): Promise<AgentRegistryRecord | undefined>
  setInstalled(
    id: string,
    installed: boolean,
    now?: string
  ): Promise<AgentRegistryRecord | undefined>
  setVersion(
    id: string,
    metadata: AgentVersionMetadata,
    now?: string
  ): Promise<AgentRegistryRecord | undefined>
}

const timestamp = (): string => new Date().toISOString()

export const createAgentRegistryPersistenceService = (
  db: CypheriaDatabase
): AgentRegistryPersistenceService => ({
  get: async (id) => {
    const [record] = await db.select().from(agentRegistry).where(eq(agentRegistry.id, id)).limit(1)
    return record
  },
  list: () => db.select().from(agentRegistry).orderBy(asc(agentRegistry.id)),
  reconcile: async (entries, now = timestamp()) => {
    if (entries.length === 0) return
    await db
      .insert(agentRegistry)
      .values(
        entries.map(({ id, native }) => ({
          enabled: false,
          id,
          installed: false,
          native,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing({ target: agentRegistry.id })
  },
  setEnabled: async (id, enabled, now = timestamp()) => {
    const [record] = await db
      .update(agentRegistry)
      .set({ enabled, updatedAt: now })
      .where(eq(agentRegistry.id, id))
      .returning()
    return record
  },
  setInstalled: async (id, installed, now = timestamp()) => {
    const [record] = await db
      .update(agentRegistry)
      .set(
        installed ? { installed, updatedAt: now } : { enabled: false, installed, updatedAt: now }
      )
      .where(eq(agentRegistry.id, id))
      .returning()
    return record
  },
  setVersion: async (id, metadata, now = timestamp()) => {
    const [record] = await db
      .update(agentRegistry)
      .set({ ...metadata, installed: true, updatedAt: now })
      .where(eq(agentRegistry.id, id))
      .returning()
    return record
  },
})
