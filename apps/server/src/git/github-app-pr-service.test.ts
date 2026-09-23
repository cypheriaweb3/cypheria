import { describe, expect, it, vi } from "vitest"
import type { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"
import { GitHubAppPrService } from "./github-app-pr-service.js"

const fixture = (
  remote = "git@github.com:org/repo.git",
  repoResult: unknown = { repository_full_name: "org/repo" },
  createResult: unknown = { number: 42, url: "https://github.com/org/repo/pull/42" },
  responses: Record<string, unknown> = {}
) => {
  const run = vi.fn(async (_root: string, args: string[]) => {
    const stdout =
      args[0] === "remote"
        ? `${remote}\n`
        : args[0] === "branch"
          ? "feature\n"
          : args[0] === "rev-parse"
            ? `${"a".repeat(40)}\n`
            : `${"a".repeat(40)}\trefs/heads/feature\n`
    return { stdout, stderr: "" }
  })
  const select = vi.fn(async () => ({
    connectorId: "connector_76869538009648d5b282a4bb21c3d157",
    accountLinkId: "link-1",
    server: "codex_apps" as const,
  }))
  const call = vi.fn(async (_selection, _threadId, _namespace, action: string) =>
    Object.hasOwn(responses, action)
      ? responses[action]
      : action === "get_repo"
        ? repoResult
        : createResult
  )
  const service = new GitHubAppPrService(
    { run } as unknown as GitExecutor,
    { select, call } as unknown as CodexAppToolClient
  )
  return { service, run, select, call }
}

describe("GitHubAppPrService", () => {
  it("selects one account link, verifies repository access and pushed head, then creates", async () => {
    const { service, select, call } = fixture()
    expect(await service.availability("/repo", "native-thread")).toEqual({
      available: true,
      canRead: true,
      repository: "org/repo",
      error: null,
    })
    expect(
      await service.create("/repo", "native-thread", {
        head: "feature",
        base: "main",
        title: "Review change",
        body: "Details",
        draft: true,
      })
    ).toEqual({ number: 42, url: "https://github.com/org/repo/pull/42" })
    expect(select).toHaveBeenCalledWith("connector_76869538009648d5b282a4bb21c3d157", "github", [
      "get_repo",
      "create_pull_request",
    ])
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "github",
      "create_pull_request",
      {
        repository_full_name: "org/repo",
        head: "feature",
        base: "main",
        title: "Review change",
        body: "Details",
        draft: true,
      }
    )
  })

  it("lists and reads only PRs in the selected GitHub repository", async () => {
    const { service, call } = fixture(undefined, undefined, undefined, {
      search_prs: {
        issues: [
          {
            issue_number: 42,
            title: "Review change",
            url: "https://github.com/org/repo/pull/42",
            updated_at: "2026-09-23T00:00:00Z",
          },
        ],
        total_count: 2,
      },
      get_pr_info: {
        number: 42,
        title: "Review change",
        body: "Details",
        url: "https://github.com/org/repo/pull/42",
        state: "OPEN",
        merged: false,
        draft: true,
        head: "feature",
        head_sha: "a".repeat(40),
        base: "main",
        updated_at: "2026-09-23T00:00:00Z",
        user: { login: "tester" },
      },
    })
    expect(await service.list("/repo", "native-thread")).toEqual({
      items: [
        {
          number: 42,
          title: "Review change",
          url: "https://github.com/org/repo/pull/42",
          updatedAt: "2026-09-23T00:00:00Z",
        },
      ],
      truncated: true,
    })
    expect(await service.read("/repo", "native-thread", 42)).toMatchObject({
      number: 42,
      title: "Review change",
      headRefName: "feature",
      headRefOid: "a".repeat(40),
    })
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "github",
      "get_pr_info",
      { pr_number: 42, repository_full_name: "org/repo" }
    )
  })

  it("rejects untrusted origins, another repository, stale push, and another PR URL", async () => {
    expect(
      (
        await fixture("https://token@github.com/org/repo.git").service.availability(
          "/repo",
          "thread"
        )
      ).available
    ).toBe(false)
    expect(
      (await fixture("git@github.example:org/repo.git").service.availability("/repo", "thread"))
        .available
    ).toBe(false)
    await expect(
      fixture("git@github.com:org/repo.git", { repository_full_name: "other/repo" }).service.create(
        "/repo",
        "thread",
        { head: "feature", base: "main", title: "Title", body: "" }
      )
    ).rejects.toThrow("cannot access")
    const stale = fixture()
    stale.run.mockImplementation(async (_root, args) => ({
      stdout:
        args[0] === "remote"
          ? "git@github.com:org/repo.git\n"
          : args[0] === "branch"
            ? "feature\n"
            : "",
      stderr: "",
    }))
    await expect(
      stale.service.create("/repo", "thread", {
        head: "feature",
        base: "main",
        title: "Title",
        body: "",
      })
    ).rejects.toThrow("Push the current branch")
    await expect(
      fixture(
        "git@github.com:org/repo.git",
        { repository_full_name: "org/repo" },
        {
          number: 42,
          url: "https://github.com/other/repo/pull/42",
        }
      ).service.create("/repo", "thread", {
        head: "feature",
        base: "main",
        title: "Title",
        body: "",
      })
    ).rejects.toThrow("another repository")
    await expect(
      fixture(undefined, undefined, undefined, {
        search_prs: {
          issues: [{ issue_number: 42, url: "https://github.com/other/repo/pull/42" }],
        },
      }).service.list("/repo", "thread")
    ).rejects.toThrow("another repository")
    await expect(
      fixture(undefined, undefined, undefined, {
        get_pr_info: {
          number: 99,
          title: "Wrong PR",
          state: "OPEN",
          merged: false,
          draft: false,
          head: "feature",
          base: "main",
        },
      }).service.read("/repo", "thread", 42)
    ).rejects.toThrow("changed")
  })
})
