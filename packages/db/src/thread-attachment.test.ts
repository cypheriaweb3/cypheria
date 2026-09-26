import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { openCypheriaDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createProjectThreadPersistenceService } from "./project-thread.js"
import { createThreadAttachmentPersistenceService } from "./thread-attachment.js"

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-thread-attachment-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: directory })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
    { id: "claude", native: true },
  ])
  const projects = createProjectThreadPersistenceService(database.db)
  const first = await projects.createThread({ agentId: "codex" }, 1)
  const second = await projects.createThread({ agentId: "claude" }, 2)
  return {
    attachments: createThreadAttachmentPersistenceService(database.db),
    close: () => {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    },
    first,
    projects,
    second,
  }
}

describe("thread attachment persistence", () => {
  it("pages by Thread and reverse-looks up every owner", async () => {
    const { attachments, close, first, second } = await setup()
    try {
      const payload = {
        host: "github.com",
        number: 42,
        owner: "cypheria",
        provider: "github",
        repository: "cypheria",
        url: "https://github.com/cypheria/cypheria/pull/42",
      }
      const identityKey = "github:github.com:cypheria/cypheria#42"
      await attachments.upsert(
        { attachmentType: "pull_request", identityKey, payload, threadId: first.id },
        10
      )
      await attachments.upsert(
        { attachmentType: "pull_request", identityKey, payload, threadId: second.id },
        11
      )

      const firstPage = await attachments.list({ attachmentType: "pull_request", limit: 1 })
      expect(firstPage.data).toHaveLength(1)
      expect(firstPage.nextCursor).not.toBeNull()
      const secondPage = await attachments.list({
        attachmentType: "pull_request",
        cursor: firstPage.nextCursor,
        limit: 1,
      })
      expect(
        [...firstPage.data, ...secondPage.data].map(({ threadId }) => threadId).sort()
      ).toEqual([first.id, second.id].sort())
      expect(
        (await attachments.listForIdentity({ attachmentType: "pull_request", identityKey })).data
      ).toHaveLength(2)
    } finally {
      close()
    }
  })

  it("enforces exclusive worktree ownership and cascades Thread deletion", async () => {
    const { attachments, close, first, projects, second } = await setup()
    try {
      const worktreeId = "c4a760a8-19be-4db1-aa1b-f42159a20542"
      await attachments.upsert({
        attachmentType: "worktree",
        identityKey: worktreeId,
        payload: { worktreeId },
        threadId: first.id,
      })
      await expect(
        attachments.upsert({
          attachmentType: "worktree",
          identityKey: worktreeId,
          payload: { worktreeId },
          threadId: second.id,
        })
      ).rejects.toThrow()

      await projects.markThreadDeleting(first.id, 20)
      await projects.purgeThread(first.id)
      expect((await attachments.list({ threadId: first.id })).data).toEqual([])
    } finally {
      close()
    }
  })
})
