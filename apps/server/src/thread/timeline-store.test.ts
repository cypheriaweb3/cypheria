import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createThreadTimelinePersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import { describe, expect, it } from "vitest"

import { ThreadTimelineStore } from "./timeline-store.js"

const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf399"
const migrationsFolder = [
  resolve(process.cwd(), "packages/db/drizzle"),
  resolve(process.cwd(), "../../packages/db/drizzle"),
].find(existsSync)

if (!migrationsFolder) throw new Error("Database migrations folder was not found")

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), "cypheria-timeline-store-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: home })
  await applyDatabaseMigrations(database.client, {
    migrationsFolder,
  })
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  await createProjectThreadPersistenceService(database.db).createThread({
    agentId: "codex",
    id: threadId,
  })
  return {
    close: () => {
      database.close()
      rmSync(home, { force: true, recursive: true })
    },
    persistence: createThreadTimelinePersistenceService(database.db),
  }
}

describe("ThreadTimelineStore", () => {
  it("sequences durable canonical rows and folds projected deltas", async () => {
    const { close, persistence } = await setup()
    const store = new ThreadTimelineStore(persistence)
    await store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "hel", type: "message" },
    })
    await store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "lo", type: "message" },
    })

    const canonical = await store.page(threadId, {
      direction: "tail",
      limit: 100,
      projection: "canonical",
    })
    expect(canonical.canonicalRows.map((row) => row.seq)).toEqual([1, 2])
    const restartedStore = new ThreadTimelineStore(persistence)
    const projected = await restartedStore.page(threadId, {
      direction: "tail",
      limit: 100,
      projection: "projected",
    })
    expect(projected.projectedItems).toHaveLength(1)
    expect(projected.projectedItems[0]?.item).toMatchObject({ text: "hello" })
    close()
  })

  it("changes epoch on hydration and marks stale cursors for reset", async () => {
    const { close, persistence } = await setup()
    const store = new ThreadTimelineStore(persistence)
    const previous = await store.head(threadId)
    const next = await store.replace(threadId, [])
    expect(next.epoch).not.toBe(previous.epoch)
    expect(
      (
        await store.page(threadId, {
          cursor: { epoch: previous.epoch, seq: 0 },
          direction: "after",
          limit: 100,
          projection: "canonical",
        })
      ).reset
    ).toBe(true)
    close()
  })

  it("keeps Agent message identity internal while reconciling user echoes", async () => {
    const { close, persistence } = await setup()
    const store = new ThreadTimelineStore(persistence)
    await store.append(threadId, {
      agentMessageId: "agent-message-provisional",
      item: {
        clientMessageId: "client-message-1",
        itemId: "user:client-message-1",
        operation: "replace",
        role: "user",
        text: "hello",
        type: "message",
      },
    })

    await expect(
      store.reconcileUserMessage(threadId, "client-message-1", "agent-message-confirmed")
    ).resolves.toBe(true)
    const internal = await persistence.get(threadId)
    expect(internal.rows).toMatchObject([{ agentMessageId: "agent-message-confirmed" }])
    const publicPage = await store.page(threadId, {
      direction: "tail",
      limit: 100,
      projection: "canonical",
    })
    expect(publicPage.canonicalRows).toHaveLength(1)
    expect(publicPage.canonicalRows[0]).not.toHaveProperty("agentMessageId")
    close()
  })

  it("pages complete projected items without cutting through canonical deltas", async () => {
    const { close, persistence } = await setup()
    const store = new ThreadTimelineStore(persistence)
    await store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "hel", type: "message" },
    })
    await store.append(threadId, {
      item: { itemId: "b", operation: "replace", role: "user", text: "next", type: "message" },
    })
    await store.append(threadId, {
      item: { itemId: "a", operation: "append", role: "assistant", text: "lo", type: "message" },
    })

    const page = await store.page(threadId, {
      direction: "tail",
      limit: 1,
      projection: "projected",
    })
    expect(page.projectedItems).toHaveLength(2)
    expect(page.projectedItems[0]?.item).toMatchObject({ itemId: "a", text: "hello" })
    expect(page.projectedItems[1]?.item).toMatchObject({ itemId: "b", text: "next" })

    const after = await store.page(threadId, {
      cursor: { epoch: page.epoch, seq: 2 },
      direction: "after",
      limit: 1,
      projection: "projected",
    })
    expect(after.projectedItems[0]?.item).toMatchObject({
      itemId: "a",
      operation: "append",
      text: "lo",
    })
    expect(after.projectedItems[0]?.sourceSeqRanges).toEqual([{ end: 3, start: 3 }])
    close()
  })
})
