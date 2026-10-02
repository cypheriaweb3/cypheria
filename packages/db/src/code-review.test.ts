import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { type OpenDatabaseResult, openCypheriaDatabase } from "./client.js"
import { CODE_REVIEW_QUEUE_LIMIT, createCodeReviewPersistenceService } from "./code-review.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createProjectThreadPersistenceService } from "./project-thread.js"

const opened: Array<{ database: OpenDatabaseResult; directory: string }> = []

afterEach(() => {
  for (const { database, directory } of opened.splice(0)) {
    database.close()
    rmSync(directory, { force: true, recursive: true })
  }
})

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-code-review-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: directory })
  opened.push({ database, directory })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  return {
    reviews: createCodeReviewPersistenceService(database.db),
    threads: createProjectThreadPersistenceService(database.db),
  }
}

const keys = { accountKey: "github.com/octo", pullRequestKey: "github.com/o/r/1" }
const review = (runId: string, status: "queued" | "running" | "completed" = "queued") => ({
  baseBranch: "main",
  headRevision: "a".repeat(40),
  runId,
  status,
})
const lease = { leaseMs: 60_000, now: 1_000 }

describe("code review persistence", () => {
  it("keeps one active background review per pull request", async () => {
    const { reviews } = await setup()
    const first = await reviews.claim(keys, review("run-1"), { ...lease, keep: () => false })
    expect(first.runId).toBe("run-1")
    const second = await reviews.claim(keys, review("run-2"), { ...lease, keep: () => false })
    expect(second.runId).toBe("run-1")
    expect(await reviews.start(keys, review("run-1"), lease)).toBe(true)
    expect(await reviews.update(keys, review("run-1", "completed"), lease)).toBe(true)
    expect(await reviews.update(keys, review("run-1", "completed"), lease)).toBe(false)
    expect((await reviews.completed(keys)).map((record) => record.runId)).toEqual(["run-1"])
    const third = await reviews.claim(keys, review("run-3"), {
      ...lease,
      keep: (latest) => latest.status === "completed",
    })
    expect(third.runId).toBe("run-1")
  })

  it("limits queued background reviews", async () => {
    const { reviews } = await setup()
    for (let index = 0; index < CODE_REVIEW_QUEUE_LIMIT; index += 1) {
      await reviews.claim(
        { ...keys, pullRequestKey: `github.com/o/r/${index}` },
        review(`run-${index}`),
        { ...lease, keep: () => false }
      )
    }
    await expect(
      reviews.claim({ ...keys, pullRequestKey: "github.com/o/r/x" }, review("run-x"), {
        ...lease,
        keep: () => false,
      })
    ).rejects.toThrow("The review queue is full")
  })

  it("binds a chat review to one Thread turn and finishes it once", async () => {
    const { reviews, threads } = await setup()
    const thread = await threads.createThread({ agentId: "codex", roots: ["/repo"] }, 1)
    const binding = { threadId: thread.id, turnId: "turn-1" }
    const claimed = await reviews.claimChat(keys, {
      binding,
      chatTarget: { pullRequest: 1 },
      now: 1,
      runId: "chat-1",
    })
    expect(claimed?.status).toBe("preparing")
    expect(
      await reviews.claimChat(
        { ...keys, accountKey: "other" },
        {
          binding,
          chatTarget: {},
          now: 1,
          runId: "chat-2",
        }
      )
    ).toBeUndefined()
    expect((await reviews.latestActiveChat(keys))?.runId).toBe("chat-1")
    const running = await reviews.prepareChat(binding, "chat-1", {
      diffLines: { "right/a.ts": [[1, 2]] },
      prepared: { diff: "x", title: "T" },
      review: review("chat-1", "running"),
    })
    expect(running?.status).toBe("running")
    const done = await reviews.finishChat(binding, "chat-1", {
      review: review("chat-1", "completed"),
      status: "completed",
      unanchoredFindings: [],
    })
    expect(done).toMatchObject({ diffLines: null, prepared: { title: "T" }, status: "completed" })
    expect(await reviews.latestActiveChat(keys)).toBeUndefined()
  })
})
