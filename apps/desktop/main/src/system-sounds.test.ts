import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

import { findSystemNotificationSoundFile, listSystemNotificationSounds } from "./system-sounds.js"

it("discovers available macOS sound names from files instead of a fixed list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-sounds-test-"))
  try {
    await Promise.all(
      ["Novel.aiff", "Glass.aiff", "Novel.wav", "readme.txt"].map((name) =>
        writeFile(join(directory, name), "")
      )
    )
    await expect(listSystemNotificationSounds(directory, "darwin")).resolves.toEqual([
      "Glass",
      "Novel",
    ])
    await expect(findSystemNotificationSoundFile("Glass", directory, "darwin")).resolves.toBe(
      join(directory, "Glass.aiff")
    )
    await expect(
      findSystemNotificationSoundFile("Missing", directory, "darwin")
    ).resolves.toBeNull()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
