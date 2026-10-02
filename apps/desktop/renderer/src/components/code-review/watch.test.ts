import { DEFAULT_GIT_SETTINGS, type Schedule } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../cypheria-client.js", () => ({ ensureCypheriaClient: vi.fn() }))

const { findPullRequestWatch, pullRequestWatchPrompt } = await import("./watch.js")

const target = {
  open: true,
  provider: "github" as const,
  title: "Change",
  url: "https://github.com/org/repo/pull/42",
}

const scheduleFor = (text: string, threadId = "thread-1") =>
  ({
    id: "123e4567-e89b-12d3-a456-426614174000",
    status: "active",
    target: { content: [{ text, type: "text" }], threadId, type: "thread" },
  }) as unknown as Schedule

describe("pull request watch", () => {
  it("identifies a watch by its thread and exact pull request URL", () => {
    const schedule = scheduleFor(pullRequestWatchPrompt(target, DEFAULT_GIT_SETTINGS))
    expect(findPullRequestWatch([schedule], "thread-1", target.url)).toBe(schedule)
    expect(findPullRequestWatch([schedule], "thread-1", `${target.url}?tab=files`)).toBe(schedule)
    expect(findPullRequestWatch([schedule], "thread-2", target.url)).toBeNull()
    expect(
      findPullRequestWatch([schedule], "thread-1", "https://github.com/org/repo/pull/420")
    ).toBeNull()
    expect(findPullRequestWatch([schedule], "thread-1", "https://github.com/org/repo")).toBeNull()
  })

  it("names GitLab merge requests and follows the watch preferences", () => {
    const gitlab = {
      ...target,
      provider: "gitlab" as const,
      url: "https://gitlab.com/group/sub/project/-/merge_requests/7",
    }
    const manual = pullRequestWatchPrompt(gitlab, DEFAULT_GIT_SETTINGS)
    expect(manual).toContain("Do not merge the merge request automatically.")
    const automatic = pullRequestWatchPrompt(gitlab, {
      ...DEFAULT_GIT_SETTINGS,
      prWatchAutoMerge: true,
      prWatchInstructions: "Keep commits small.",
    })
    expect(automatic).toContain(`merge using ${DEFAULT_GIT_SETTINGS.pullRequestMergeMethod}`)
    expect(automatic).toContain("Additional watch instructions:\nKeep commits small.")
  })

  it("rejects URLs that are not pull requests", () => {
    expect(() =>
      pullRequestWatchPrompt(
        { ...target, url: "http://github.com/org/repo/pull/1" },
        DEFAULT_GIT_SETTINGS
      )
    ).toThrow()
  })
})
