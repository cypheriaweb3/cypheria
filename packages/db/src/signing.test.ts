import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "./client.js"
import { applyDatabaseMigrations } from "./migrations.js"
import { createSigningIntentReplayStore } from "./signing.js"

describe("signing intent replay store", () => {
  it("atomically claims an intent only once", async () => {
    const database = createInMemoryDatabase()
    await applyDatabaseMigrations(database.client)
    const store = createSigningIntentReplayStore(database.db, () => "2026-09-01T03:00:00.000Z")
    const hash = `sha256:${"1".repeat(64)}`

    await expect(
      Promise.all([
        store.claim("signing_intent_one", hash),
        store.claim("signing_intent_one", hash),
      ])
    ).resolves.toEqual(expect.arrayContaining([true, false]))
    await expect(store.claim("signing_intent_one", `sha256:${"2".repeat(64)}`)).resolves.toBe(false)
    database.close()
  })
})
