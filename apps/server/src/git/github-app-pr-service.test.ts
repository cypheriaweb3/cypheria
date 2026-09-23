import { describe, expect, it, vi } from "vitest"
import type { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"
import { GitHubAppPrService } from "./github-app-pr-service.js"

const fixture = (
  remote = "git@github.com:org/repo.git",
  repoResult: unknown = { repository_full_name: "org/repo" },
  createResult: unknown = { number: 42, url: "https://github.com/org/repo/pull/42" }
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
    action === "get_repo" ? repoResult : createResult
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
  })
})
