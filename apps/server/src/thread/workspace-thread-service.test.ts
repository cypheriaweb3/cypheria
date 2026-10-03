import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createWorkspaceThreadPersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { ServerMessage } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { WorkspaceThreadService } from "./workspace-thread-service.js"

describe("WorkspaceThreadService", () => {
  it("keeps one chat per workspace, publishes changes, and rejects unknown Threads", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cypheria-workspace-thread-service-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: directory })
    try {
      await applyDatabaseMigrations(database.client)
      await createAgentRegistryPersistenceService(database.db).reconcile([
        { id: "codex", native: true },
      ])
      const projects = createProjectThreadPersistenceService(database.db)
      const thread = await projects.createThread({ agentId: "codex", roots: ["/repo"] }, 1)
      const published: ServerMessage[] = []
      const service = new WorkspaceThreadService({
        persistence: createWorkspaceThreadPersistenceService(database.db),
        projects,
        publish: (message) => published.push(message),
      })
      const key = "mcp-app:demo@market:open"

      expect(await service.get(key)).toEqual({ threadId: null, workspaceKey: key })
      await service.set(key, thread.id)
      await service.set(key, thread.id)
      expect(await service.get(key)).toEqual({ threadId: thread.id, workspaceKey: key })
      expect(published).toEqual([
        {
          payload: { threadId: thread.id, workspaceKey: key },
          type: "thread.workspace-thread.updated.notification",
        },
      ])

      const sent: ServerMessage[] = []
      await service.handle(
        {
          payload: { threadId: null, workspaceKey: key },
          requestId: "clear",
          type: "thread.workspace-thread.set.request",
        },
        (message) => sent.push(message)
      )
      expect(sent[0]).toMatchObject({
        payload: { ok: true, value: { threadId: null } },
        type: "thread.workspace-thread.set.response",
      })
      expect(published).toHaveLength(2)

      await service.handle(
        {
          payload: { threadId: "0198d8b1-2b9b-7b39-9c6f-1a2b3c4d5e6f", workspaceKey: key },
          requestId: "missing",
          type: "thread.workspace-thread.set.request",
        },
        (message) => sent.push(message)
      )
      expect(sent[1]).toMatchObject({
        payload: { error: { code: "THREAD_NOT_FOUND" }, ok: false },
      })
    } finally {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
