import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.resetModules()
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("GitHub PR associations", () => {
  it("persists validated links and rejects a mismatched PR URL", async () => {
    const { githubPrAssociations } = await import("./git-pr-associations.js")
    const entry = { number: 42, title: "Review", url: "https://github.com/org/repo/pull/42" }
    githubPrAssociations.add("thread-one", entry)
    expect(githubPrAssociations.getSnapshot()["thread-one"]).toEqual([entry])
    expect(() =>
      githubPrAssociations.add("thread-one", {
        ...entry,
        url: "https://github.com/org/repo/pull/43",
      })
    ).toThrow("Invalid GitHub PR association")
    vi.resetModules()
    const restored = await import("./git-pr-associations.js")
    expect(restored.githubPrAssociations.getSnapshot()["thread-one"]).toEqual([entry])
    restored.githubPrAssociations.remove("thread-one", entry.url)
    expect(restored.githubPrAssociations.getSnapshot()["thread-one"]).toEqual([])
  })
})
