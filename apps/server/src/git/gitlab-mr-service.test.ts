import { describe, expect, it, vi } from "vitest"
import type { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"
import { GitLabMrService } from "./gitlab-mr-service.js"

const project = {
  data: {
    id: 42,
    default_branch: "main",
    path_with_namespace: "group/project",
    web_url: "https://gitlab.com/group/project",
  },
}
const mr = {
  data: {
    iid: 7,
    project_id: 42,
    source_branch: "feature",
    target_branch: "main",
    title: "Add feature",
    description: "Details",
    state: "opened",
    draft: true,
    web_url: "https://gitlab.com/group/project/-/merge_requests/7",
  },
}

const fixture = (
  remote: string,
  projectResult: unknown = project,
  mrResult: unknown = mr,
  responses: Record<string, unknown> = {}
) => {
  const run = vi.fn(async (_root: string, args: string[]) => {
    const stdout =
      args[0] === "branch"
        ? "feature\n"
        : args[0] === "rev-parse"
          ? `${"a".repeat(40)}\n`
          : args[0] === "ls-remote"
            ? `${"a".repeat(40)}\trefs/heads/feature\n`
            : `${remote}\n`
    return { stdout, stderr: "" }
  })
  const select = vi.fn(async () => ({
    connectorId: "connector_0c9786b2f41f41558056126bdb46c9bd",
    accountLinkId: "link-1",
    server: "codex_apps" as const,
  }))
  const call = vi.fn(async (_selection, _threadId, _namespace, action: string) =>
    Object.hasOwn(responses, action)
      ? responses[action]
      : action === "get_project"
        ? projectResult
        : mrResult
  )
  const service = new GitLabMrService(
    { run } as unknown as GitExecutor,
    { select, call } as unknown as CodexAppToolClient
  )
  return { service, run, select, call }
}

describe("GitLabMrService", () => {
  it("reads an MR only after matching the local GitLab origin and project", async () => {
    const { service, select, call } = fixture("git@gitlab.com:group/project.git")
    expect(await service.read("/repo", "native-thread", 7)).toEqual({
      iid: 7,
      projectPath: "group/project",
      title: "Add feature",
      description: "Details",
      state: "opened",
      draft: true,
      sourceBranch: "feature",
      targetBranch: "main",
      webUrl: "https://gitlab.com/group/project/-/merge_requests/7",
    })
    expect(select).toHaveBeenCalledWith("connector_0c9786b2f41f41558056126bdb46c9bd", "gitlab", [
      "get_project",
      "get_merge_request",
    ])
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "gitlab",
      "get_merge_request",
      { project_id: 42, merge_request_iid: 7 }
    )
  })

  it("rejects another origin, project, or MR URL", async () => {
    await expect(
      fixture("git@gitlab.example:group/project.git").service.read("/repo", "thread", 7)
    ).rejects.toThrow()
    await expect(
      fixture("https://gitlab.com/group/project.git", {
        data: { ...project.data, path_with_namespace: "other/project" },
      }).service.read("/repo", "thread", 7)
    ).rejects.toThrow("does not match")
    await expect(
      fixture("https://gitlab.com/group/project.git", project, {
        data: { ...mr.data, web_url: "https://gitlab.com/group/other/-/merge_requests/7" },
      }).service.read("/repo", "thread", 7)
    ).rejects.toThrow("changed")
  })

  it("updates only the selected MR title and verifies the write response", async () => {
    const updated = { data: { ...mr.data, title: "New title" } }
    const { service, select, call } = fixture("git@gitlab.com:group/project.git", project, mr, {
      update_merge_request: updated,
    })
    expect(await service.updateTitle("/repo", "native-thread", 7, "New title")).toMatchObject({
      iid: 7,
      title: "New title",
    })
    expect(select).toHaveBeenCalledWith("connector_0c9786b2f41f41558056126bdb46c9bd", "gitlab", [
      "get_project",
      "get_merge_request",
      "update_merge_request",
    ])
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "gitlab",
      "update_merge_request",
      { project_id: 42, merge_request_iid: 7, title: "New title" },
      { recheckAfter: false }
    )
    await expect(
      fixture("git@gitlab.com:group/project.git", project, mr, {
        update_merge_request: mr,
      }).service.updateTitle("/repo", "native-thread", 7, "New title")
    ).rejects.toThrow("did not confirm")
  })

  it("posts an ordinary MR comment and verifies the write response", async () => {
    const { service, call } = fixture("git@gitlab.com:group/project.git", project, mr, {
      create_merge_request_note: { data: { id: 15, body: "Looks good" } },
    })
    expect(await service.postComment("/repo", "native-thread", 7, "Looks good")).toEqual({
      id: 15,
      body: "Looks good",
    })
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "gitlab",
      "create_merge_request_note",
      { project_id: "42", merge_request_iid: 7, body: "Looks good" },
      { recheckAfter: false }
    )
    await expect(service.postComment("/repo", "native-thread", 7, " ")).rejects.toThrow(
      "comment is required"
    )
  })

  it("creates an MR only for the pushed current branch and confirms the result", async () => {
    const created = { data: { ...mr.data, title: "Draft: Add feature" } }
    const { service, call, run } = fixture("git@gitlab.com:group/project.git", project, mr, {
      create_merge_request: created,
    })
    expect(
      await service.create("/repo", "native-thread", {
        sourceBranch: "feature",
        title: "Add feature",
        description: "Details",
        draft: true,
      })
    ).toMatchObject({ iid: 7, title: "Draft: Add feature", draft: true })
    expect(run).toHaveBeenCalledWith(
      "/repo",
      ["ls-remote", "--heads", "origin", "refs/heads/feature"],
      { readOnly: true }
    )
    expect(call).toHaveBeenCalledWith(
      expect.any(Object),
      "native-thread",
      "gitlab",
      "create_merge_request",
      {
        project_id: 42,
        source_branch: "feature",
        target_branch: "main",
        title: "Draft: Add feature",
        description: "Details",
      },
      { recheckAfter: false }
    )
  })

  it("creates the browser form URL after push without a connector call", async () => {
    const { service, call } = fixture("git@gitlab.com:group/project.git")
    const url = new URL(
      await service.browserFormUrl("/repo", {
        sourceBranch: "feature",
        title: "Add feature",
        description: "Details",
      })
    )
    expect(url.origin + url.pathname).toBe("https://gitlab.com/group/project/-/merge_requests/new")
    expect(url.searchParams.get("merge_request[source_branch]")).toBe("feature")
    expect(url.searchParams.get("merge_request[title]")).toBe("Add feature")
    expect(call).not.toHaveBeenCalled()
  })

  it("rejects an unpushed branch before attempting MR creation", async () => {
    const { service, run, call } = fixture("git@gitlab.com:group/project.git")
    run.mockImplementation(async (_root, args) => ({
      stdout:
        args[0] === "branch"
          ? "feature\n"
          : args[0] === "rev-parse"
            ? `${"a".repeat(40)}\n`
            : args[0] === "ls-remote"
              ? ""
              : "git@gitlab.com:group/project.git\n",
      stderr: "",
    }))
    await expect(
      service.create("/repo", "native-thread", {
        sourceBranch: "feature",
        title: "Add feature",
        description: "Details",
      })
    ).rejects.toThrow("Push the current branch")
    expect(call).not.toHaveBeenCalled()
  })
})
