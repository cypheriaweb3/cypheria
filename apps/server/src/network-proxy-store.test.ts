import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { NetworkProxyStore } from "./network-proxy-store.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

const openStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "cypheria-network-proxy-"))
  temporaryDirectories.push(directory)
  return NetworkProxyStore.open(directory)
}

describe("NetworkProxyStore", () => {
  it("stores one proxy independently and redacts its password", async () => {
    const store = await openStore()
    expect(store.snapshot()).toEqual({ mode: "system" })

    await store.set({
      bypass: ["example.test"],
      host: "127.0.0.1",
      mode: "manual",
      password: "secret",
      port: 7890,
      protocol: "http",
      username: "alice",
    })

    expect(store.snapshot()).toMatchObject({ mode: "manual", passwordConfigured: true })
    expect(JSON.stringify(store.snapshot())).not.toContain("secret")
    expect((await stat(store.path)).mode & 0o777).toBe(0o600)
  })

  it("preserves, replaces, and clears passwords without returning them", async () => {
    const store = await openStore()
    const base = {
      bypass: [],
      host: "proxy.test",
      mode: "manual" as const,
      port: 8080,
      protocol: "https" as const,
    }
    await store.set({ ...base, password: "first" })
    await store.set({ ...base, password: undefined })
    expect(await readFile(store.path, "utf8")).toContain("first")
    await store.set({ ...base, password: "second" })
    expect(await readFile(store.path, "utf8")).toContain("second")
    await store.set({ ...base, password: null })
    expect(await readFile(store.path, "utf8")).not.toContain('"password"')
    expect(store.snapshot()).toMatchObject({ passwordConfigured: false })
  })

  it("applies the same proxy to isolated Agent environments", async () => {
    const store = await openStore()
    await store.set({
      bypass: ["internal.test"],
      host: "proxy.test",
      mode: "manual",
      port: 1080,
      protocol: "socks5",
    })
    const base = { HTTPS_PROXY: "http://inherited", TOKEN: "kept" }
    expect(store.environment(base)).toMatchObject({
      ALL_PROXY: "socks5://proxy.test:1080",
      NO_PROXY: expect.stringContaining("internal.test"),
      TOKEN: "kept",
    })
    expect(store.environment(base)).toEqual(store.environment(base))
    expect(base).toEqual({ HTTPS_PROXY: "http://inherited", TOKEN: "kept" })

    expect(store.environmentForSettings({ mode: "direct" }, base)).toEqual({ TOKEN: "kept" })
    expect(store.environmentForSettings({ mode: "system" }, base)).toEqual(base)
  })
})
