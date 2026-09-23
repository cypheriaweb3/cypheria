import { z } from "zod"
import type { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"

const connectorId = "connector_0c9786b2f41f41558056126bdb46c9bd"
const gitLabOrigin = "https://gitlab.com"
const segment = /^[A-Za-z0-9_.-]+$/u

const projectResponse = z
  .object({
    data: z
      .object({
        id: z.number().int().positive(),
        path_with_namespace: z.string().min(1),
        web_url: z.url(),
      })
      .passthrough(),
  })
  .passthrough()

const mrResponse = z
  .object({
    data: z
      .object({
        iid: z.number().int().positive(),
        project_id: z.number().int().positive(),
        source_branch: z.string(),
        target_branch: z.string(),
        title: z.string(),
        description: z.string().nullish(),
        state: z.enum(["opened", "closed", "merged", "locked"]),
        draft: z.boolean(),
        web_url: z.url(),
      })
      .passthrough(),
  })
  .passthrough()

const pathFromRemote = (remote: string): string => {
  const value = remote.trim()
  const scp = /^git@gitlab\.com:(.+)$/u.exec(value)
  let path: string
  if (scp) {
    path = scp[1] ?? ""
  } else {
    const url = new URL(value)
    if (
      (url.protocol !== "https:" && url.protocol !== "ssh:") ||
      url.hostname !== "gitlab.com" ||
      url.port ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "https:" && url.username) ||
      (url.protocol === "ssh:" && url.username !== "git")
    )
      throw new Error("The repository origin is not a trusted GitLab.com URL")
    path = url.pathname.replace(/^\//u, "")
  }
  path = path.replace(/\.git$/u, "")
  const parts = path.split("/")
  if (
    parts.length < 2 ||
    parts.some((part) => !segment.test(part) || part === "." || part === "..")
  ) {
    throw new Error("The repository origin has an invalid GitLab project path")
  }
  return parts.join("/")
}

const expectedProjectUrl = (path: string) => `${gitLabOrigin}/${path}`

export type GitLabMergeRequest = {
  iid: number
  projectPath: string
  title: string
  description: string
  state: "opened" | "closed" | "merged" | "locked"
  draft: boolean
  sourceBranch: string
  targetBranch: string
  webUrl: string
}

/** Read GitLab.com MRs only for the local origin and the selected Codex account. */
export class GitLabMrService {
  readonly #executor: GitExecutor
  readonly #apps: CodexAppToolClient

  constructor(executor: GitExecutor, apps: CodexAppToolClient) {
    this.#executor = executor
    this.#apps = apps
  }

  async read(root: string, nativeThreadId: string, iid: number): Promise<GitLabMergeRequest> {
    const remote = (
      await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
    ).stdout
    const projectPath = pathFromRemote(remote)
    const selection = await this.#apps.select(connectorId, "gitlab", [
      "get_project",
      "get_merge_request",
    ])
    const project = projectResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "gitlab", "get_project", {
        project_id: encodeURIComponent(projectPath),
      })
    ).data
    if (
      project.path_with_namespace !== projectPath ||
      project.web_url.replace(/\/$/u, "") !== expectedProjectUrl(projectPath)
    )
      throw new Error("The selected GitLab project does not match the local origin")
    const mr = mrResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "gitlab", "get_merge_request", {
        project_id: project.id,
        merge_request_iid: iid,
      })
    ).data
    if (
      mr.iid !== iid ||
      mr.project_id !== project.id ||
      mr.web_url !== `${expectedProjectUrl(projectPath)}/-/merge_requests/${iid}`
    )
      throw new Error("The selected GitLab merge request changed")
    return {
      iid: mr.iid,
      projectPath,
      title: mr.title,
      description: mr.description ?? "",
      state: mr.state,
      draft: mr.draft,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      webUrl: mr.web_url,
    }
  }
}
