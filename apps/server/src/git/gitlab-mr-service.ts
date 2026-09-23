import { z } from "zod"
import type { CodexAppSelection, CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"

const connectorId = "connector_0c9786b2f41f41558056126bdb46c9bd"
const gitLabOrigin = "https://gitlab.com"
const segment = /^[A-Za-z0-9_.-]+$/u

const projectResponse = z
  .object({
    data: z
      .object({
        id: z.number().int().positive(),
        default_branch: z.string().min(1).nullish(),
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

const noteResponse = z
  .object({ data: z.object({ id: z.number().int().positive(), body: z.string() }).passthrough() })
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
const remotePath = async (executor: GitExecutor, root: string): Promise<string> => {
  const remote = (await executor.run(root, ["remote", "get-url", "origin"], { readOnly: true }))
    .stdout
  return pathFromRemote(remote)
}
const validateBranch = (branch: string): void => {
  if (!branch || branch.startsWith("-") || branch.includes("\0") || branch.includes("\n"))
    throw new Error("Invalid GitLab branch")
}
const verifiedPushedBranch = async (
  executor: GitExecutor,
  root: string,
  branch: string
): Promise<void> => {
  validateBranch(branch)
  await remotePath(executor, root)
  const current = (
    await executor.run(root, ["branch", "--show-current"], { readOnly: true })
  ).stdout.trim()
  if (current !== branch) throw new Error("The selected GitLab branch is not checked out")
  const local = (
    await executor.run(root, ["rev-parse", "--verify", `refs/heads/${branch}`], {
      readOnly: true,
    })
  ).stdout.trim()
  const remote = (
    await executor.run(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
      readOnly: true,
    })
  ).stdout.trim()
  if (remote !== `${local}\trefs/heads/${branch}`)
    throw new Error("Push the current branch to GitLab before creating a merge request")
}

export const gitLabBrowserFormUrl = async (
  executor: GitExecutor,
  root: string,
  input: { sourceBranch: string; title: string; description: string }
): Promise<string> => {
  if (!input.title.trim()) throw new Error("GitLab merge request title is required")
  await verifiedPushedBranch(executor, root, input.sourceBranch)
  const path = await remotePath(executor, root)
  const url = new URL(`${expectedProjectUrl(path)}/-/merge_requests/new`)
  url.searchParams.set("merge_request[source_branch]", input.sourceBranch)
  url.searchParams.set("merge_request[title]", input.title)
  url.searchParams.set("merge_request[description]", input.description)
  return url.href
}

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

export type GitLabMergeRequestNote = { id: number; body: string }

type MergeRequestData = z.infer<typeof mrResponse>["data"]
type Context = {
  projectPath: string
  projectId: number
  mr: MergeRequestData
  selection: CodexAppSelection
}
type Project = { projectPath: string; projectId: number; defaultBranch: string | null }

/** Read GitLab.com MRs only for the local origin and the selected Codex account. */
export class GitLabMrService {
  readonly #executor: GitExecutor
  readonly #apps: CodexAppToolClient

  constructor(executor: GitExecutor, apps: CodexAppToolClient) {
    this.#executor = executor
    this.#apps = apps
  }

  async read(root: string, nativeThreadId: string, iid: number): Promise<GitLabMergeRequest> {
    const context = await this.#context(root, nativeThreadId, iid)
    return this.#view(context)
  }

  async updateTitle(
    root: string,
    nativeThreadId: string,
    iid: number,
    title: string
  ): Promise<GitLabMergeRequest> {
    if (!title.trim()) throw new Error("GitLab merge request title is required")
    const context = await this.#context(root, nativeThreadId, iid, ["update_merge_request"])
    const updated = mrResponse.parse(
      await this.#apps.call(
        context.selection,
        nativeThreadId,
        "gitlab",
        "update_merge_request",
        { project_id: context.projectId, merge_request_iid: iid, title },
        { recheckAfter: false }
      )
    ).data
    this.#validateMr(context.projectPath, context.projectId, iid, updated)
    if (updated.title !== title) throw new Error("GitLab did not confirm the updated title")
    return this.#view({ ...context, mr: updated })
  }

  async postComment(
    root: string,
    nativeThreadId: string,
    iid: number,
    body: string
  ): Promise<GitLabMergeRequestNote> {
    if (!body.trim()) throw new Error("GitLab merge request comment is required")
    const context = await this.#context(root, nativeThreadId, iid, ["create_merge_request_note"])
    const note = noteResponse.parse(
      await this.#apps.call(
        context.selection,
        nativeThreadId,
        "gitlab",
        "create_merge_request_note",
        { project_id: String(context.projectId), merge_request_iid: iid, body },
        { recheckAfter: false }
      )
    ).data
    if (note.body !== body) throw new Error("GitLab did not confirm the posted comment")
    return { id: note.id, body: note.body }
  }

  async create(
    root: string,
    nativeThreadId: string,
    input: {
      sourceBranch: string
      targetBranch?: string
      title: string
      description: string
      draft?: boolean
    }
  ): Promise<GitLabMergeRequest> {
    if (!input.title.trim()) throw new Error("GitLab merge request title is required")
    await verifiedPushedBranch(this.#executor, root, input.sourceBranch)
    const selection = await this.#apps.select(connectorId, "gitlab", [
      "get_project",
      "create_merge_request",
    ])
    const project = await this.#project(root, nativeThreadId, selection)
    const targetBranch = input.targetBranch ?? project.defaultBranch
    if (!targetBranch) throw new Error("The GitLab project has no default target branch")
    validateBranch(targetBranch)
    if (targetBranch === input.sourceBranch)
      throw new Error("GitLab source and target branches must differ")
    const title =
      input.draft && !/^(draft:|wip:)/iu.test(input.title) ? `Draft: ${input.title}` : input.title
    let response: unknown
    try {
      response = await this.#apps.call(
        selection,
        nativeThreadId,
        "gitlab",
        "create_merge_request",
        {
          project_id: project.projectId,
          source_branch: input.sourceBranch,
          target_branch: targetBranch,
          title,
          description: input.description,
        },
        { recheckAfter: false }
      )
    } catch {
      throw new Error("Could not confirm the merge request. Check GitLab before trying again")
    }
    try {
      const mr = mrResponse.parse(response).data
      this.#validateMr(project.projectPath, project.projectId, mr.iid, mr)
      if (
        mr.source_branch !== input.sourceBranch ||
        mr.target_branch !== targetBranch ||
        mr.title !== title
      )
        throw new Error("GitLab returned another merge request")
      return this.#view({ ...project, mr, selection })
    } catch {
      throw new Error("Could not confirm the merge request. Check GitLab before trying again")
    }
  }

  async browserFormUrl(
    root: string,
    input: { sourceBranch: string; title: string; description: string }
  ): Promise<string> {
    return gitLabBrowserFormUrl(this.#executor, root, input)
  }

  async #context(
    root: string,
    nativeThreadId: string,
    iid: number,
    additionalActions: readonly string[] = []
  ): Promise<Context> {
    const selection = await this.#apps.select(connectorId, "gitlab", [
      "get_project",
      "get_merge_request",
      ...additionalActions,
    ])
    const project = await this.#project(root, nativeThreadId, selection)
    const mr = mrResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "gitlab", "get_merge_request", {
        project_id: project.projectId,
        merge_request_iid: iid,
      })
    ).data
    this.#validateMr(project.projectPath, project.projectId, iid, mr)
    return { ...project, mr, selection }
  }

  async #project(
    root: string,
    nativeThreadId: string,
    selection: CodexAppSelection
  ): Promise<Project> {
    const projectPath = await remotePath(this.#executor, root)
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
    return { projectPath, projectId: project.id, defaultBranch: project.default_branch ?? null }
  }

  #validateMr(projectPath: string, projectId: number, iid: number, mr: MergeRequestData): void {
    if (
      mr.iid !== iid ||
      mr.project_id !== projectId ||
      mr.web_url !== `${expectedProjectUrl(projectPath)}/-/merge_requests/${iid}`
    )
      throw new Error("The selected GitLab merge request changed")
  }

  #view({ projectPath, mr }: Context): GitLabMergeRequest {
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
