import { z } from "zod"
import type { CodexAppSelection, CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"

const connectorId = "connector_76869538009648d5b282a4bb21c3d157"
const repoSegment = /^[A-Za-z0-9_.-]+$/u
const repoResponse = z.object({ repository_full_name: z.string().min(3) }).passthrough()
const createdResponse = z
  .object({ number: z.number().int().positive(), url: z.url() })
  .passthrough()
const searchResponse = z
  .object({
    issues: z.array(
      z
        .object({
          issue_number: z.number().int().positive(),
          title: z.string().optional(),
          url: z.url().optional(),
          updated_at: z.string().nullable().optional(),
        })
        .passthrough()
    ),
    total_count: z.number().int().nonnegative().optional(),
  })
  .passthrough()
const infoResponse = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable().optional(),
    url: z.url().nullable().optional(),
    state: z.enum(["OPEN", "CLOSED", "MERGED", "open", "closed", "merged"]),
    merged: z.boolean(),
    draft: z.boolean(),
    head: z.string(),
    head_sha: z.string().nullish(),
    base: z.string(),
    updated_at: z.string().nullable().optional(),
    user: z.object({ login: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough()

const checkedPrUrl = (repository: string, number: number, value?: string | null): string => {
  const result = value ?? `https://github.com/${repository}/pull/${number}`
  const url = new URL(result)
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !== `/${repository}/pull/${number}`.toLowerCase()
  ) {
    throw new Error("The GitHub app returned a pull request from another repository")
  }
  return result
}

const repositoryFromRemote = (remote: string): string => {
  const value = remote.trim()
  const scp = /^git@github\.com:(.+)$/u.exec(value)
  let path: string
  if (scp) {
    path = scp[1] ?? ""
  } else {
    const url = new URL(value)
    if (
      (url.protocol !== "https:" && url.protocol !== "ssh:") ||
      url.hostname !== "github.com" ||
      url.port ||
      (url.username && !(url.protocol === "ssh:" && url.username === "git")) ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("The repository origin is not a trusted GitHub.com URL")
    }
    path = url.pathname.replace(/^\//u, "")
  }
  path = path.replace(/\.git$/u, "")
  const parts = path.split("/")
  if (
    parts.length !== 2 ||
    parts.some((part) => !repoSegment.test(part) || part === "." || part === "..")
  ) {
    throw new Error("The repository origin has an invalid GitHub repository path")
  }
  return parts.join("/")
}

export type GitHubAppAvailability = {
  available: boolean
  canRead: boolean
  repository: string | null
  error: string | null
}

export class GitHubAppPrService {
  readonly #executor: GitExecutor
  readonly #apps: CodexAppToolClient

  constructor(executor: GitExecutor, apps: CodexAppToolClient) {
    this.#executor = executor
    this.#apps = apps
  }

  async availability(root: string, nativeThreadId: string): Promise<GitHubAppAvailability> {
    const create = await this.#context(root, nativeThreadId, ["create_pull_request"]).then(
      ({ repository }) => ({ repository, error: null }),
      (error) => ({
        repository: null,
        error: error instanceof Error ? error.message : String(error),
      })
    )
    const read = await this.#context(root, nativeThreadId, ["search_prs", "get_pr_info"]).then(
      ({ repository }) => ({ repository, error: null }),
      (error) => ({
        repository: null,
        error: error instanceof Error ? error.message : String(error),
      })
    )
    return {
      available: create.repository !== null,
      canRead: read.repository !== null,
      repository: create.repository ?? read.repository,
      error: create.repository || read.repository ? null : (create.error ?? read.error),
    }
  }

  async list(
    root: string,
    nativeThreadId: string
  ): Promise<{
    items: Array<{ number: number; title: string; url: string; updatedAt: string }>
    truncated: boolean
  }> {
    const { repository, selection } = await this.#context(root, nativeThreadId, ["search_prs"])
    const page = searchResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "search_prs", {
        query: "is:pr archived:false",
        state: "open",
        order: "desc",
        sort: "updated",
        topn: 20,
        repository_full_name: repository,
      })
    )
    if (page.issues.length > 20) throw new Error("The GitHub app returned too many pull requests")
    return {
      items: page.issues.map((issue) => ({
        number: issue.issue_number,
        title: issue.title ?? `Pull request #${issue.issue_number}`,
        url: checkedPrUrl(repository, issue.issue_number, issue.url),
        updatedAt: issue.updated_at ?? "",
      })),
      truncated: (page.total_count ?? page.issues.length) > page.issues.length,
    }
  }

  async read(
    root: string,
    nativeThreadId: string,
    number: number
  ): Promise<{
    number: number
    title: string
    body: string
    url: string
    state: string
    isDraft: boolean
    headRefName: string
    headRefOid: string | null
    baseRefName: string
    updatedAt: string
    author: { login: string } | null
  }> {
    const { repository, selection } = await this.#context(root, nativeThreadId, ["get_pr_info"])
    const info = infoResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
        pr_number: number,
        repository_full_name: repository,
      })
    )
    if (info.number !== number) throw new Error("The selected GitHub pull request changed")
    return {
      number: info.number,
      title: info.title,
      body: info.body ?? "",
      url: checkedPrUrl(repository, number, info.url),
      state: info.merged ? "MERGED" : info.state.toUpperCase(),
      isDraft: info.draft,
      headRefName: info.head,
      headRefOid: info.head_sha ?? null,
      baseRefName: info.base,
      updatedAt: info.updated_at ?? "",
      author: info.user ? { login: info.user.login } : null,
    }
  }

  async create(
    root: string,
    nativeThreadId: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<{ number: number; url: string }> {
    if (!input.title.trim()) throw new Error("GitHub pull request title is required")
    if (!input.base || input.base.startsWith("-") || /[\0\r\n]/u.test(input.base)) {
      throw new Error("Invalid GitHub base branch")
    }
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "create_pull_request",
    ])
    await this.#verifiedPushedBranch(root, input.head)
    const created = createdResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "create_pull_request", {
        repository_full_name: repository,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
        draft: input.draft ?? false,
      })
    )
    return { number: created.number, url: checkedPrUrl(repository, created.number, created.url) }
  }

  async #context(
    root: string,
    nativeThreadId: string,
    actions: readonly string[]
  ): Promise<{ repository: string; selection: CodexAppSelection }> {
    const remote = (
      await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
    ).stdout
    const repository = repositoryFromRemote(remote)
    const selection = await this.#apps.select(connectorId, "github", ["get_repo", ...actions])
    const result = repoResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_repo", {
        repository_full_name: repository,
      })
    )
    if (result.repository_full_name.toLowerCase() !== repository.toLowerCase()) {
      throw new Error("The selected GitHub account cannot access this repository")
    }
    return { repository, selection }
  }

  async #verifiedPushedBranch(root: string, branch: string): Promise<void> {
    if (!branch || branch.startsWith("-") || /[\0\r\n]/u.test(branch)) {
      throw new Error("Invalid GitHub head branch")
    }
    const current = (
      await this.#executor.run(root, ["branch", "--show-current"], { readOnly: true })
    ).stdout.trim()
    if (current !== branch) throw new Error("The selected GitHub branch is not checked out")
    const local = (
      await this.#executor.run(root, ["rev-parse", "--verify", `refs/heads/${branch}`], {
        readOnly: true,
      })
    ).stdout.trim()
    const remote = (
      await this.#executor.run(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
        readOnly: true,
      })
    ).stdout.trim()
    if (remote !== `${local}\trefs/heads/${branch}`) {
      throw new Error("Push the current branch to GitHub before creating a pull request")
    }
  }
}
