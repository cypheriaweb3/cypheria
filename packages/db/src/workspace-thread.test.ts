import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createAgentRegistryPersistenceService } from "./agent.js"
import { openCypheriaDatabase } from "./client.js"
import { CODE_REVIEW_PR_LIMITS, createCodeReviewPrPersistenceService } from "./code-review.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createProjectThreadPersistenceService } from "./project-thread.js"
import { createWorkspaceThreadPersistenceService } from "./workspace-thread.js"

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-workspace-thread-test-"))
  const database = openCypheriaDatabase({ cypheriaHome: directory })
  await applyDatabaseMigrations(database.client)
  await createAgentRegistryPersistenceService(database.db).reconcile([
    { id: "codex", native: true },
  ])
  const projects = createProjectThreadPersistenceService(database.db)
  return {
    chats: createWorkspaceThreadPersistenceService(database.db),
    client: database.client,
    close: () => {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    },
    projects,
    saved: createCodeReviewPrPersistenceService(database.db),
  }
}

describe("workspace chat persistence", () => {
  it("records, replaces, and forgets a workspace's chat", async () => {
    const { chats, close, projects } = await setup()
    try {
      const first = await projects.createThread({ agentId: "codex", roots: ["/first"] }, 1)
      const second = await projects.createThread({ agentId: "codex", roots: ["/second"] }, 2)
      expect(await chats.get("mcp-app:demo")).toBeUndefined()
      await chats.set("mcp-app:demo", first.id)
      expect((await chats.get("mcp-app:demo"))?.threadId).toBe(first.id)
      await chats.set("mcp-app:demo", second.id)
      expect((await chats.get("mcp-app:demo"))?.threadId).toBe(second.id)
      expect(await chats.set("mcp-app:demo", null)).toBeNull()
      expect(await chats.get("mcp-app:demo")).toBeUndefined()
    } finally {
      close()
    }
  })

  it("forgets a workspace's chat when its Thread is deleted", async () => {
    const { chats, client, close, projects } = await setup()
    try {
      const thread = await projects.createThread({ agentId: "codex", roots: ["/first"] }, 1)
      await chats.set("code-review:github:github.com:o/r#1", thread.id)
      await client.execute({ args: [thread.id], sql: "DELETE FROM threads WHERE id = ?" })
      expect(await chats.get("code-review:github:github.com:o/r#1")).toBeUndefined()
    } finally {
      close()
    }
  })
})

describe("Code Review saved pull request persistence", () => {
  it("keeps each list per account, newest first, and moves a saved pull request to the top", async () => {
    const { close, saved } = await setup()
    try {
      await saved.save("pinned", "a", "u1", { title: "one" }, { now: 10 })
      await saved.save("pinned", "a", "u2", { title: "two" }, { now: 10 })
      await saved.save("pinned", "b", "u3", { title: "three" }, { now: 10 })
      await saved.save("recent", "a", "u1", { title: "one" }, { now: 10 })
      expect((await saved.list("pinned", "a")).map((entry) => entry.urlKey)).toEqual(["u2", "u1"])
      await saved.save("pinned", "a", "u1", { title: "one again" }, { now: 5 })
      const pinned = await saved.list("pinned", "a")
      expect(pinned.map((entry) => entry.urlKey)).toEqual(["u1", "u2"])
      expect(pinned[0]?.item).toEqual({ title: "one again" })
      expect((await saved.list("pinned", "b")).map((entry) => entry.urlKey)).toEqual(["u3"])
      expect((await saved.list("recent", "a")).map((entry) => entry.urlKey)).toEqual(["u1"])
      expect(await saved.remove("pinned", "a", "u1")).toBe(true)
      expect(await saved.remove("pinned", "a", "u1")).toBe(false)
      expect((await saved.list("pinned", "a")).map((entry) => entry.urlKey)).toEqual(["u2"])
    } finally {
      close()
    }
  })

  it("refreshes an entry in place when asked to update only, and saves nothing new", async () => {
    const { close, saved } = await setup()
    try {
      await saved.save("recent", "a", "u1", { title: "old" }, { now: 1 })
      await saved.save("recent", "a", "u2", { title: "two" }, { now: 2 })
      await saved.save("recent", "a", "u1", { title: "new" }, { updateOnly: true })
      await saved.save("recent", "a", "u3", { title: "three" }, { updateOnly: true })
      const recent = await saved.list("recent", "a")
      expect(recent.map((entry) => [entry.urlKey, entry.item])).toEqual([
        ["u2", { title: "two" }],
        ["u1", { title: "new" }],
      ])
    } finally {
      close()
    }
  })

  it("drops the oldest pull requests beyond a list's limit", async () => {
    const { close, saved } = await setup()
    try {
      const limit = CODE_REVIEW_PR_LIMITS.recent
      for (let index = 0; index <= limit; index += 1) {
        await saved.save("recent", "a", `u${index}`, { index }, { now: index })
      }
      const recent = await saved.list("recent", "a")
      expect(recent).toHaveLength(limit)
      expect(recent[0]?.urlKey).toBe(`u${limit}`)
      expect(recent.some((entry) => entry.urlKey === "u0")).toBe(false)
    } finally {
      close()
    }
  })
})
