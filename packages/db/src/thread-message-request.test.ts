import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { openCypheriaDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createProjectThreadPersistenceService } from "./project-thread.js"
import { createThreadMessageRequestPersistenceService } from "./thread-message-request.js"

const databases: Array<{ close: () => void; home: string }> = []

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
    rmSync(database.home, { force: true, recursive: true })
  }
})

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), "cypheria-thread-message-request-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: home })
  databases.push({ close: database.close, home })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  const thread = await createProjectThreadPersistenceService(database.db).createThread({
    agentId: "codex",
  })
  return {
    request: createThreadMessageRequestPersistenceService(database.db),
    threadId: thread.id,
  }
}

describe("Thread message request persistence", () => {
  it("persists pending and completed idempotency receipts", async () => {
    const { request, threadId } = await setup()
    const input = {
      clientMessageId: "client-1",
      request: { content: [{ text: "hello", type: "text" }], operation: "start" },
      threadId,
    }

    await expect(request.inspect(input)).resolves.toEqual({ status: "new" })
    await expect(request.claim(input, 100)).resolves.toEqual({ status: "new" })
    await expect(request.inspect(input)).resolves.toEqual({ status: "pending" })
    await request.complete(threadId, input.clientMessageId, "turn-1", 101)
    await expect(request.inspect(input)).resolves.toEqual({ status: "completed", turnId: "turn-1" })
  })

  it("detects a request-key conflict from a stable content fingerprint", async () => {
    const { request, threadId } = await setup()
    await request.claim({
      clientMessageId: "client-1",
      request: { content: [{ text: "hello", type: "text" }], operation: "start" },
      threadId,
    })

    await expect(
      request.inspect({
        clientMessageId: "client-1",
        request: { content: [{ text: "different", type: "text" }], operation: "start" },
        threadId,
      })
    ).resolves.toEqual({ status: "conflict" })
  })
})
