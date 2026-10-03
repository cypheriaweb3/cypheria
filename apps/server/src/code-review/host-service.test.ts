import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createCodeReviewPrPersistenceService,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  type CodeReviewServerMessage,
  DEFAULT_CODE_REVIEW_SETTINGS,
  type ServerMessage,
} from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { CodeReviewHostService } from "./host-service.js"

describe("CodeReviewHostService saved pull requests", () => {
  it("keeps pins and recents per account and tells every client when a list changes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cypheria-code-review-host-test-"))
    const database = openCypheriaDatabase({ cypheriaHome: directory })
    try {
      await applyDatabaseMigrations(database.client)
      const published: ServerMessage[] = []
      const service = new CodeReviewHostService({
        backend: {} as never,
        codexAccount: async () => ({ email: null, type: null }),
        installedPlugins: async () => new Set(),
        publish: (message) => published.push(message),
        savedPullRequests: createCodeReviewPrPersistenceService(database.db),
        settings: () => DEFAULT_CODE_REVIEW_SETTINGS,
      })
      const item = { title: "Fix it", url: "https://github.com/o/r/pull/1" }
      const send = async (payload: Record<string, unknown>, type: string) => {
        const sent: CodeReviewServerMessage[] = []
        await service.handle({ payload, requestId: type, type } as never, (message) =>
          sent.push(message)
        )
        return sent[0]?.payload
      }

      expect(
        await send(
          { accountKey: "a", item, list: "pinned" },
          "codeReview.pullRequests.save.request"
        )
      ).toMatchObject({ ok: true, value: { item: { ...item, savedAt: expect.any(Number) } } })
      await service.savePullRequest("recent", "a", { ...item, title: "Fix it again" }, true)
      expect(await service.listPullRequests("recent", "a")).toEqual([])
      expect(published).toEqual([
        {
          payload: { accountKey: "a", list: "pinned" },
          type: "codeReview.pullRequests.changed.notification",
        },
      ])
      expect(
        await send({ accountKey: "a", list: "pinned" }, "codeReview.pullRequests.list.request")
      ).toMatchObject({ ok: true, value: { items: [{ title: "Fix it" }] } })
      expect(await service.listPullRequests("pinned", "b")).toEqual([])
      expect(
        await send(
          { accountKey: "a", list: "pinned", url: "https://GITHUB.com/o/r/pull/1" },
          "codeReview.pullRequests.remove.request"
        )
      ).toMatchObject({ ok: true, value: { removed: true } })
      expect(
        await send(
          { accountKey: "a", item: { ...item, url: "http://example.com/a" }, list: "pinned" },
          "codeReview.pullRequests.save.request"
        )
      ).toMatchObject({ ok: false })
    } finally {
      database.close()
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
