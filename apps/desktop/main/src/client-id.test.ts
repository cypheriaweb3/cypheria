import { createMemoryKeyValueStorage } from "@cypheria/storage"
import { describe, expect, it } from "vitest"

import { readDesktopClientId } from "./client-settings.js"

describe("desktop client ID", () => {
  it("creates the ID once and keeps it for later launches", async () => {
    const storage = createMemoryKeyValueStorage()
    const first = await readDesktopClientId(storage, () => "cid_first-launch")
    const again = await readDesktopClientId(storage, () => "cid_second-launch")
    expect(first).toBe("cid_first-launch")
    expect(again).toBe("cid_first-launch")
  })

  it("replaces a stored value that is not a client ID", async () => {
    const storage = createMemoryKeyValueStorage({ "cypheria.desktop.client-id": "not an id" })
    await expect(readDesktopClientId(storage, () => "cid_replacement")).resolves.toBe(
      "cid_replacement"
    )
  })
})
