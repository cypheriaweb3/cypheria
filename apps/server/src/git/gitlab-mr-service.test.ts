import { describe, expect, it, vi } from "vitest"
import type { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"
import { GitLabMrService } from "./gitlab-mr-service.js"

const project = {
  data: {
    id: 42,
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

const fixture = (remote: string, projectResult: unknown = project, mrResult: unknown = mr) => {
  const run = vi.fn(async () => ({ stdout: `${remote}\n`, stderr: "" }))
  const select = vi.fn(async () => ({
    connectorId: "connector_0c9786b2f41f41558056126bdb46c9bd",
    accountLinkId: "link-1",
    server: "codex_apps" as const,
  }))
  const call = vi.fn(async (_selection, _threadId, _namespace, action: string) =>
    action === "get_project" ? projectResult : mrResult
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
})
