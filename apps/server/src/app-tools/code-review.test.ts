import { describe, expect, it, vi } from "vitest"

import { CODE_REVIEW_TOOLS, CodeReviewTools } from "./code-review.js"

const pullRequest = { hostname: "github.com", number: 7, owner: "acme", repository: "app" }

describe("CodeReviewTools", () => {
  it("offers the model one read-only tool, as the official plugin does", () => {
    expect(CODE_REVIEW_TOOLS.map((tool) => tool.name)).toEqual(["pull_requests.checks"])
    expect(CODE_REVIEW_TOOLS[0]?.annotations?.readOnlyHint).toBe(true)
  })

  it("reads the checks of the named pull request from the caller's directory", async () => {
    const checks = vi.fn(async () => [])
    const tools = new CodeReviewTools({ checks, fallbackCwd: "/home" })
    const result = await tools.call("pull_requests.checks", { pullRequest }, { cwd: "/repo" })
    expect(result.isError).toBe(false)
    expect(checks).toHaveBeenCalledWith({
      cwd: "/repo",
      number: 7,
      repository: "github.com/acme/app",
    })
    await tools.call("pull_requests.checks", { pullRequest }, {})
    expect(checks).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: "/home" }))
  })

  it("rejects names that are not a plain host, owner, and repository", async () => {
    const checks = vi.fn(async () => [])
    const tools = new CodeReviewTools({ checks, fallbackCwd: "/home" })
    for (const bad of [{ owner: "--repo" }, { repository: "a/b" }, { hostname: "Example.com" }]) {
      const result = await tools.call(
        "pull_requests.checks",
        { pullRequest: { ...pullRequest, ...bad } },
        {}
      )
      expect(result.isError).toBe(true)
    }
    expect(checks).not.toHaveBeenCalled()
  })
})
