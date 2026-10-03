import { eq } from "drizzle-orm"

import type { CypheriaDatabase } from "./client.js"
import { workspaceThreads } from "./schema/index.js"

export type WorkspaceThreadRecord = typeof workspaceThreads.$inferSelect

export interface WorkspaceThreadPersistenceService {
  get(workspaceKey: string): Promise<WorkspaceThreadRecord | undefined>
  /** Records the workspace's chat; null forgets it, so the workspace starts a new one. */
  set(workspaceKey: string, threadId: string | null): Promise<WorkspaceThreadRecord | null>
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

export const createWorkspaceThreadPersistenceService = (
  db: CypheriaDatabase
): WorkspaceThreadPersistenceService => ({
  async get(workspaceKey) {
    return (
      await db
        .select()
        .from(workspaceThreads)
        .where(eq(workspaceThreads.workspaceKey, workspaceKey))
        .limit(1)
    )[0]
  },
  async set(workspaceKey, threadId, now = nowSeconds()) {
    if (threadId === null) {
      await db.delete(workspaceThreads).where(eq(workspaceThreads.workspaceKey, workspaceKey))
      return null
    }
    const [record] = await db
      .insert(workspaceThreads)
      .values({ threadId, updatedAt: now, workspaceKey })
      .onConflictDoUpdate({
        set: { threadId, updatedAt: now },
        target: workspaceThreads.workspaceKey,
      })
      .returning()
    if (!record) throw new Error("Workspace chat could not be persisted")
    return record
  },
})
