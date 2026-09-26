import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createThreadAttachmentPersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import type { ServerMessage } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import {
  type ThreadAttachmentClientMessage,
  ThreadAttachmentService,
} from "./thread-attachment-service.js"

describe("ThreadAttachmentService", () => {
  it("canonicalizes PR identities, lists owners, and publishes changes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cypheria-thread-attachment-service-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: directory })
    try {
      await applyDatabaseMigrations(database.client)
      await createAgentRegistryPersistenceService(database.db).reconcile([
        { id: "codex", native: true },
        { id: "claude", native: true },
      ])
      const projects = createProjectThreadPersistenceService(database.db)
      const codex = await projects.createThread({ agentId: "codex" }, 1)
      const claude = await projects.createThread({ agentId: "claude" }, 2)
      const published: ServerMessage[] = []
      const service = new ThreadAttachmentService({
        persistence: createThreadAttachmentPersistenceService(database.db),
        projects,
        publish: (message) => published.push(message),
      })
      const dispatch = async (message: ThreadAttachmentClientMessage): Promise<ServerMessage> => {
        const sent: ServerMessage[] = []
        await service.handle(message, (response) => sent.push(response))
        expect(sent).toHaveLength(1)
        return sent[0] as ServerMessage
      }

      const first = await service.attachPullRequest(
        codex.id,
        "https://github.com/Cypheria/Cypheria/pull/42/"
      )
      await service.attachPullRequest(claude.id, "https://github.com/cypheria/cypheria/pull/42")
      expect(first).toMatchObject({
        attachmentType: "pull_request",
        identityKey: "github:github.com:cypheria/cypheria#42",
        payload: { number: 42, provider: "github" },
      })
      expect(published).toHaveLength(2)

      const worktreeId = "c4a760a8-19be-4db1-aa1b-f42159a20542"
      await service.attachWorktree(codex.id, worktreeId)
      await expect(service.attachWorktree(claude.id, worktreeId)).rejects.toMatchObject({
        name: "THREAD_ATTACHMENT_CONFLICT",
      })

      expect(
        (
          await dispatch({
            payload: {
              attachmentType: "pull_request",
              identityKey: first.identityKey,
            },
            requestId: "owners",
            type: "thread.attachment.owners.list.request",
          })
        ).payload
      ).toMatchObject({ ok: true, value: { data: [{}, {}] } })

      await service.deleteForThread(codex.id)
      expect(
        (
          await dispatch({
            payload: { threadId: codex.id },
            requestId: "deleted-thread-list",
            type: "thread.attachment.list.request",
          })
        ).payload
      ).toMatchObject({ ok: true, value: { data: [] } })
      expect(published.at(-1)).toMatchObject({
        payload: { threadId: codex.id },
        type: "thread.attachment.deleted.notification",
      })

      expect(
        (
          await dispatch({
            payload: { attachmentType: "pull_request", limit: 200 },
            requestId: "list",
            type: "thread.attachment.list.request",
          })
        ).payload
      ).toMatchObject({
        ok: true,
        value: { data: [{ threadId: claude.id }] },
      })
    } finally {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it("rejects unsupported or credential-bearing URLs", async () => {
    const service = new ThreadAttachmentService({
      persistence: {} as never,
      projects: { getThread: async () => ({ id: "thread" }) } as never,
    })
    await expect(
      service.attachPullRequest("thread", "https://token@example.com/a/b/pull/1")
    ).rejects.toMatchObject({ name: "THREAD_ATTACHMENT_URL_INVALID" })
  })
})
