import { z } from "zod"
import type { CodexAppSelection, CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"

const connectorId = "connector_76869538009648d5b282a4bb21c3d157"
const repoSegment = /^[A-Za-z0-9_.-]+$/u
const repoResponse = z.object({ repository_full_name: z.string().min(3) }).passthrough()
const createdResponse = z
  .object({ number: z.number().int().positive(), url: z.url() })
  .passthrough()

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
    try {
      const { repository } = await this.#context(root, nativeThreadId)
      return { available: true, repository, error: null }
    } catch (error) {
      return {
        available: false,
        repository: null,
        error: error instanceof Error ? error.message : String(error),
      }
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
    const { repository, selection } = await this.#context(root, nativeThreadId)
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
    const url = new URL(created.url)
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.toLowerCase() !== `/${repository}/pull/${created.number}`.toLowerCase()
    ) {
      throw new Error("The GitHub app returned a pull request from another repository")
    }
    return { number: created.number, url: created.url }
  }

  async #context(
    root: string,
    nativeThreadId: string
  ): Promise<{ repository: string; selection: CodexAppSelection }> {
    const remote = (
      await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
    ).stdout
    const repository = repositoryFromRemote(remote)
    const selection = await this.#apps.select(connectorId, "github", [
      "get_repo",
      "create_pull_request",
    ])
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
