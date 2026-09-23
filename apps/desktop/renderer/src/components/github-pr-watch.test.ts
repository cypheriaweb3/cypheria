import { DEFAULT_GIT_SETTINGS, type GitHubPullRequest, type Schedule } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"
import { findGithubPrWatch, githubPrFixPrompt, githubPrWatchName } from "./github-pr-watch.js"

const pr: GitHubPullRequest = {
  number: 42,
  title: "Change",
  body: "",
  url: "https://github.com/org/repo/pull/42",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  updatedAt: "2026-09-23T00:00:00Z",
  author: { login: "author" },
}

describe("GitHub PR watch", () => {
  it("identifies a watch by its thread and exact PR URL", () => {
    const prompt = githubPrFixPrompt(pr, DEFAULT_GIT_SETTINGS, true)
    const schedule = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      target: { type: "thread", threadId: "thread-1", content: [{ type: "text", text: prompt }] },
    } as Schedule
    expect(findGithubPrWatch([schedule], "thread-1", pr)).toBe(schedule)
    expect(findGithubPrWatch([schedule], "thread-2", pr)).toBeNull()
    expect(
      findGithubPrWatch([schedule], "thread-1", {
        ...pr,
        number: 43,
        url: "https://github.com/org/repo/pull/43",
      })
    ).toBeNull()
    expect(
      findGithubPrWatch([schedule], "thread-1", {
        ...pr,
        number: 420,
        url: "https://github.com/org/repo/pull/420",
      })
    ).toBeNull()
    expect(githubPrWatchName("org/repo", 42)).toContain("#42")
  })

  it("uses saved watch merge and instruction preferences", () => {
    const prompt = githubPrFixPrompt(
      pr,
      {
        ...DEFAULT_GIT_SETTINGS,
        prWatchAutoMerge: true,
        pullRequestMergeMethod: "squash",
        prWatchInstructions: "Run the package checks.",
      },
      true
    )
    expect(prompt).toContain("merge using squash")
    expect(prompt).toContain("Run the package checks.")
    expect(githubPrFixPrompt(pr, DEFAULT_GIT_SETTINGS, true)).toContain("Do not merge")
    expect(githubPrFixPrompt(pr, DEFAULT_GIT_SETTINGS, false)).toContain("Fix GitHub pull request")
  })
})
