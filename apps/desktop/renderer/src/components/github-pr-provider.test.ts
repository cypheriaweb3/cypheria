import { describe, expect, it } from "vitest"
import { githubPrProvider } from "./github-pr-provider.js"

describe("GitHub PR provider selection", () => {
  const cli = {
    installed: true,
    authenticated: true,
    account: "me",
    repository: "me/repo",
    error: null,
  }
  const app = {
    available: true,
    canList: true,
    canRead: false,
    canSearchByAccount: false,
    canDiff: false,
    canActivity: false,
    canChecks: false,
    canThreads: false,
    canMedia: false,
    repository: "me/repo",
    error: null,
  }

  it("selects each operation by available account and tool scope", () => {
    expect(githubPrProvider("read", cli, app, true)).toBe("cli")
    expect(githubPrProvider("list", { ...cli, authenticated: false }, app, true)).toBe("app")
    expect(githubPrProvider("read", { ...cli, authenticated: false }, app, true)).toBeNull()
    expect(githubPrProvider("write", { ...cli, authenticated: false }, app, true)).toBeNull()
    expect(githubPrProvider("create", { ...cli, authenticated: false }, app, true)).toBe("app")
    expect(githubPrProvider("create", { ...cli, authenticated: false }, app, false)).toBeNull()
    expect(
      githubPrProvider("create", { ...cli, authenticated: false }, app, true, false)
    ).toBeNull()
  })
})
