import { createMemoryKeyValueStorage, writeValidatedValue } from "@cypheria/storage"
import { describe, expect, it } from "vitest"
import { clientSettingDefinitions } from "../../ipc/src/index.js"

import { readAppearance, readClientPreferences, readLocaleBootstrap } from "./client-settings.js"

describe("desktop client settings", () => {
  it("reads startup appearance and locale from version 1 KV envelopes", async () => {
    const storage = createMemoryKeyValueStorage()
    await writeValidatedValue(
      storage,
      clientSettingDefinitions.appearance.key,
      { ...clientSettingDefinitions.appearance.defaultValue, theme: "dark" },
      clientSettingDefinitions.appearance.schema,
      { version: 1 }
    )
    await writeValidatedValue(
      storage,
      clientSettingDefinitions.localeOverride.key,
      "zh-CN",
      clientSettingDefinitions.localeOverride.schema,
      { version: 1 }
    )

    await expect(readAppearance(storage)).resolves.toMatchObject({ theme: "dark" })
    await expect(readLocaleBootstrap(storage, ["en-US"])).resolves.toEqual({
      locale: "zh-CN",
      localeOverride: "zh-CN",
    })
  })

  it("deletes damaged values and falls back to registered defaults", async () => {
    const storage = createMemoryKeyValueStorage()
    await storage.setItem("preventSleepWhileRunning", '{"version":1,"value":"yes"}')
    const settings = await readClientPreferences(storage)
    expect(settings.preventSleepWhileRunning).toBe(false)
    await expect(storage.getItem("preventSleepWhileRunning")).resolves.toBeNull()
  })

  it("maps unsupported future locale overrides to the implemented English catalog", async () => {
    const storage = createMemoryKeyValueStorage()
    await writeValidatedValue(
      storage,
      clientSettingDefinitions.localeOverride.key,
      "ja",
      clientSettingDefinitions.localeOverride.schema,
      { version: 1 }
    )
    await expect(readLocaleBootstrap(storage, ["zh-CN"])).resolves.toEqual({
      locale: "en",
      localeOverride: "ja",
    })
  })
})
