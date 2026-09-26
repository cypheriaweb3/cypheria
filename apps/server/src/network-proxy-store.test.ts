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
  const directory = await mkdtemp(join(tmpdir(), "cypheria-network-proxies-"))
  temporaryDirectories.push(directory)
  return NetworkProxyStore.open(directory)
}

describe("NetworkProxyStore", () => {
  it("stores a named list independently with a removable default", async () => {
    const store = await openStore()
    await store.patch({
      defaultProxyId: "office",
      proxies: {
        office: {
          bypass: ["example.test"],
          host: "127.0.0.1",
          id: "office",
          mode: "manual",
          name: "Office",
          password: "secret",
          port: 7890,
          protocol: "http",
          username: "alice",
        },
      },
    })

    expect(store.snapshot()).toMatchObject({
      defaultProxyId: "office",
      proxies: [{ id: "office", passwordConfigured: true }],
      version: 1,
    })
    expect(JSON.stringify(store.snapshot())).not.toContain("secret")
    expect((await stat(store.path)).mode & 0o777).toBe(0o600)

    await store.patch({ defaultProxyId: null })
    expect(store.snapshot().defaultProxyId).toBeNull()
  })

  it("preserves, replaces, and clears passwords without returning them", async () => {
    const store = await openStore()
    const base = {
      bypass: [],
      host: "proxy.test",
      id: "private",
      mode: "manual" as const,
      name: "Private",
      port: 8080,
      protocol: "https" as const,
    }
    await store.patch({ proxies: { private: { ...base, password: "first" } } })
    await store.patch({ proxies: { private: { ...base, password: undefined } } })
    expect(await readFile(store.path, "utf8")).toContain("first")
    await store.patch({ proxies: { private: { ...base, password: "second" } } })
    expect(await readFile(store.path, "utf8")).toContain("second")
    await store.patch({ proxies: { private: { ...base, password: null } } })
    expect(await readFile(store.path, "utf8")).not.toContain('"password"')
    expect(store.snapshot().proxies[0]).toMatchObject({ passwordConfigured: false })
  })

  it("resolves an Agent override before the default and isolates process environments", async () => {
    const store = await openStore()
    await store.patch({
      defaultProxyId: "default",
      proxies: {
        default: { id: "default", mode: "system", name: "System" },
        direct: { id: "direct", mode: "direct", name: "Direct" },
        manual: {
          bypass: ["internal.test"],
          host: "proxy.test",
          id: "manual",
          mode: "manual",
          name: "Manual",
          port: 1080,
          protocol: "socks5",
        },
      },
    })
    const base = { HTTPS_PROXY: "http://inherited", TOKEN: "kept" }
    expect(store.environment("codex", undefined, base)).toMatchObject(base)
    expect(store.environment("codex", { networkProxyId: "direct" }, base)).toEqual({
      TOKEN: "kept",
    })
    expect(store.environment("claude", { networkProxyId: "manual" }, base)).toMatchObject({
      ALL_PROXY: "socks5://proxy.test:1080",
      NO_PROXY: expect.stringContaining("internal.test"),
      TOKEN: "kept",
    })
    expect(base).toEqual({ HTTPS_PROXY: "http://inherited", TOKEN: "kept" })
    expect(() => store.environment("pi", { networkProxyId: "missing" }, base)).toThrow(
      "Unknown network proxy"
    )
  })
})
