import { realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import type {
  GitBranchContext,
  GitBranchReview,
  GitBranchSearchResult,
  GitClientMessage,
  GitHubAppAvailability,
  GitHubAppPullRequest,
  GitHubAppPullRequestSummary,
  GitHubAvailability,
  GitHubPullRequest,
  GitHubPullRequestActivity,
  GitHubPullRequestChecks,
  GitLabMergeRequest,
  GitLabMergeRequestChecks,
  GitLabMergeRequestNote,
  GitOrigin,
  GitServerMessage,
  GitWorktree,
} from "@cypheria/protocol"
import type { AgentManager } from "../agent/agent-manager.js"
import { CodexAppToolClient } from "../codex-app-tool-client.js"
import type { ThreadManager } from "../thread/thread-manager.js"
import { GitCommandError, GitExecutor } from "./git-executor.js"
import { GitWorktreeService } from "./git-worktree-service.js"
import { GitHubAppPrService } from "./github-app-pr-service.js"
import { GitHubPrService } from "./github-pr-service.js"
import { GitLabMrService, gitLabBrowserFormUrl } from "./gitlab-mr-service.js"

export type GitRepository = {
  readonly commonGitDir: string
  readonly root: string
}

export type GitStatus = {
  readonly branch: string | null
  readonly entries: readonly { readonly code: string; readonly path: string }[]
  readonly head: string | null
  readonly repository: GitRepository
}

const trimmed = (value: string): string => value.trimEnd()
class GitStaleSnapshotError extends Error {}
const validateOperand = (value: string, name: string): string => {
  if (!value || value.startsWith("-") || value.includes("\0") || value.includes("\n")) {
    throw new Error(`Invalid Git ${name}`)
  }
  return value
}

export class GitService {
  readonly #executor: GitExecutor
  readonly #worktrees: GitWorktreeService
  readonly #github = new GitHubPrService()
  readonly #githubApp: GitHubAppPrService | null
  readonly #gitlab: GitLabMrService | null
  readonly #threads: ThreadManager | null

  constructor(
    cacheDir: string,
    cypheriaHome: string,
    connectors?: { agents: AgentManager; threads: ThreadManager }
  ) {
    this.#executor = new GitExecutor(cacheDir)
    this.#worktrees = new GitWorktreeService(this.#executor, cypheriaHome)
    const apps = connectors ? new CodexAppToolClient(connectors.agents) : null
    this.#gitlab = apps ? new GitLabMrService(this.#executor, apps) : null
    this.#githubApp = apps ? new GitHubAppPrService(this.#executor, apps) : null
    this.#threads = connectors?.threads ?? null
  }

  async handle(
    message: GitClientMessage,
    send: (message: GitServerMessage) => void
  ): Promise<boolean> {
    const type = message.type.replace(/\.request$/u, ".response") as GitServerMessage["type"]
    try {
      let value: unknown
      switch (message.type) {
        case "git.discover.request":
          value = await this.discover(message.payload.cwd)
          break
        case "git.origin.request":
          value = await this.origin(message.payload.cwd)
          break
        case "git.status.request":
          value = await this.status(message.payload.cwd)
          break
        case "git.branches.request":
          value = await this.branches(message.payload.cwd)
          break
        case "git.branch-search.request":
          value = await this.searchBranches(
            message.payload.cwd,
            message.payload.query,
            message.payload.limit
          )
          break
        case "git.branch-context.request":
          value = await this.branchContext(message.payload.cwd)
          break
        case "git.init.request":
          value = await this.init(message.payload.cwd)
          break
        case "git.branch-create.request":
          value = {
            name: await this.createBranch(
              message.payload.cwd,
              message.payload.name,
              message.payload.startPoint
            ),
          }
          break
        case "git.checkout.request":
          value = await this.checkout(
            message.payload.cwd,
            message.payload.target,
            message.payload.stashChanges
          )
          break
        case "git.diff.request":
          value = { diff: await this.diff(message.payload.cwd, message.payload) }
          break
        case "git.branch-review.request":
          value = await this.branchReview(message.payload.cwd, message.payload.base)
          break
        case "git.branch-review-diff.request":
          value = { diff: await this.branchReviewDiff(message.payload.cwd, message.payload) }
          break
        case "git.stage.request":
          await this.stage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.unstage.request":
          await this.unstage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.commit.request":
          value = { commit: await this.commit(message.payload.cwd, message.payload.message) }
          break
        case "git.push.request":
          value = { output: await this.push(message.payload.cwd, message.payload) }
          break
        case "git.worktrees.request":
          value = await this.worktrees(message.payload.cwd)
          break
        case "git.worktree-create.request":
          value = await this.createWorktree(message.payload.cwd, message.payload.startPoint)
          break
        case "git.worktree-delete.request":
          await this.deleteWorktree(message.payload.cwd, message.payload.path)
          value = { succeeded: true }
          break
        case "git.worktree-restore.request":
          value = await this.restoreWorktree(message.payload.cwd, message.payload.path)
          break
        case "git.github-availability.request":
          value = await this.githubAvailability(message.payload.cwd)
          break
        case "git.github-app-availability.request":
          value = await this.githubAppAvailability(message.payload.cwd, message.payload.threadId)
          break
        case "git.github-app-pr-create.request":
          value = await this.githubAppPrCreate(
            message.payload.cwd,
            message.payload.threadId,
            message.payload
          )
          break
        case "git.github-app-pr-list.request":
          value = await this.githubAppPrList(message.payload.cwd, message.payload.threadId)
          break
        case "git.github-app-pr-read.request":
          value = await this.githubAppPrRead(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.number
          )
          break
        case "git.github-pr-list.request":
          value = await this.githubPrList(
            message.payload.cwd,
            message.payload.state,
            message.payload.limit
          )
          break
        case "git.github-pr-read.request":
          value = await this.githubPrRead(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-checks.request":
          value = await this.githubPrChecks(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-activity.request":
          value = await this.githubPrActivity(message.payload.cwd, message.payload.number)
          break
        case "git.github-pr-comment.request":
          await this.githubPrComment(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.body
          )
          value = { succeeded: true }
          break
        case "git.github-pr-review.request":
          await this.githubPrReview(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.decision,
            message.payload.body
          )
          value = { succeeded: true }
          break
        case "git.github-pr-set-state.request":
          await this.githubPrSetState(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.action
          )
          value = { succeeded: true }
          break
        case "git.github-pr-create.request":
          value = await this.githubPrCreate(message.payload.cwd, message.payload)
          break
        case "git.github-pr-update.request":
          value = await this.githubPrUpdate(
            message.payload.cwd,
            message.payload.number,
            message.payload
          )
          break
        case "git.github-pr-merge.request":
          value = await this.githubPrMerge(
            message.payload.cwd,
            message.payload.number,
            message.payload.expectedHead,
            message.payload.method
          )
          break
        case "git.gitlab-mr-read.request":
          value = await this.gitlabMrRead(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-checks.request":
          value = await this.gitlabMrChecks(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid
          )
          break
        case "git.gitlab-mr-update-title.request":
          value = await this.gitlabMrUpdateTitle(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid,
            message.payload.title
          )
          break
        case "git.gitlab-mr-post-comment.request":
          value = await this.gitlabMrPostComment(
            message.payload.cwd,
            message.payload.threadId,
            message.payload.iid,
            message.payload.body
          )
          break
        case "git.gitlab-mr-create.request":
          value = await this.gitlabMrCreate(
            message.payload.cwd,
            message.payload.threadId,
            message.payload
          )
          break
        case "git.gitlab-mr-browser-form.request":
          value = { url: await this.gitlabMrBrowserForm(message.payload.cwd, message.payload) }
          break
      }
      send({ type, requestId: message.requestId, payload: { ok: true, value } } as GitServerMessage)
    } catch (error) {
      send({
        type,
        requestId: message.requestId,
        payload: {
          ok: false,
          error: {
            code:
              error instanceof GitStaleSnapshotError
                ? "GIT_STALE_SNAPSHOT"
                : error instanceof GitCommandError
                  ? "GIT_COMMAND_FAILED"
                  : "GIT_INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      } as GitServerMessage)
    }
    return true
  }

  async discover(cwd: string): Promise<GitRepository> {
    const root = trimmed(
      (await this.#executor.run(cwd, ["rev-parse", "--show-toplevel"], { readOnly: true })).stdout
    )
    const commonGitDir = trimmed(
      (
        await this.#executor.run(
          root,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          {
            readOnly: true,
          }
        )
      ).stdout
    )
    return { commonGitDir: await realpath(commonGitDir), root: await realpath(root) }
  }

  async origin(cwd: string): Promise<GitOrigin> {
    const { root } = await this.discover(cwd)
    let remote: string
    try {
      remote = (
        await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
      ).stdout.trim()
    } catch (error) {
      if (error instanceof GitCommandError) return { provider: "none" }
      throw error
    }
    const scp = /^git@([^:]+):/u.exec(remote)
    let hostname = scp?.[1] ?? null
    if (!hostname) {
      try {
        hostname = new URL(remote).hostname
      } catch {
        return { provider: "other" }
      }
    }
    const provider =
      hostname.toLowerCase() === "gitlab.com"
        ? "gitlab"
        : hostname.toLowerCase() === "github.com"
          ? "github"
          : "other"
    return { provider }
  }

  async worktrees(cwd: string): Promise<GitWorktree[]> {
    return this.#worktrees.list(await this.discover(cwd))
  }

  async createWorktree(cwd: string, startPoint?: string): Promise<GitWorktree> {
    return this.#worktrees.create(await this.discover(cwd), startPoint)
  }

  async deleteWorktree(cwd: string, path: string): Promise<void> {
    await this.#worktrees.delete(await this.discover(cwd), path)
  }

  async restoreWorktree(cwd: string, path: string): Promise<GitWorktree> {
    return this.#worktrees.restore(await this.discover(cwd), path)
  }

  async githubAvailability(cwd: string): Promise<GitHubAvailability> {
    return this.#github.availability((await this.discover(cwd)).root)
  }

  async githubAppAvailability(cwd: string, threadId: string): Promise<GitHubAppAvailability> {
    if (!this.#githubApp)
      return {
        available: false,
        canRead: false,
        repository: null,
        error: "GitHub app is unavailable",
      }
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.availability(root, nativeThreadId)
  }

  async githubAppPrCreate(
    cwd: string,
    threadId: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<{ number: number; url: string }> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.create(root, nativeThreadId, input)
  }

  async githubAppPrList(
    cwd: string,
    threadId: string
  ): Promise<{ items: GitHubAppPullRequestSummary[]; truncated: boolean }> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.list(root, nativeThreadId)
  }

  async githubAppPrRead(
    cwd: string,
    threadId: string,
    number: number
  ): Promise<GitHubAppPullRequest> {
    if (!this.#githubApp) throw new Error("GitHub app is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return this.#githubApp.read(root, nativeThreadId, number)
  }

  async githubPrList(
    cwd: string,
    state?: "open" | "closed" | "merged" | "all",
    limit?: number
  ): Promise<GitHubPullRequest[]> {
    return this.#github.list((await this.discover(cwd)).root, state, limit)
  }

  async githubPrRead(cwd: string, number: number): Promise<GitHubPullRequest> {
    return this.#github.read((await this.discover(cwd)).root, number)
  }

  async githubPrChecks(cwd: string, number: number): Promise<GitHubPullRequestChecks> {
    return this.#github.checks((await this.discover(cwd)).root, number)
  }

  async githubPrActivity(cwd: string, number: number): Promise<GitHubPullRequestActivity> {
    return this.#github.activity((await this.discover(cwd)).root, number)
  }

  async githubPrComment(
    cwd: string,
    number: number,
    expectedHead: string,
    body: string
  ): Promise<void> {
    await this.#github.comment((await this.discover(cwd)).root, number, expectedHead, body)
  }

  async githubPrReview(
    cwd: string,
    number: number,
    expectedHead: string,
    decision: "approve" | "comment" | "request_changes",
    body: string
  ): Promise<void> {
    await this.#github.review((await this.discover(cwd)).root, number, expectedHead, decision, body)
  }

  async githubPrSetState(
    cwd: string,
    number: number,
    expectedHead: string,
    action: "close" | "reopen" | "ready" | "draft"
  ): Promise<void> {
    await this.#github.setState((await this.discover(cwd)).root, number, expectedHead, action)
  }

  async githubPrCreate(
    cwd: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<GitHubPullRequest> {
    return this.#github.create((await this.discover(cwd)).root, input)
  }

  async githubPrUpdate(
    cwd: string,
    number: number,
    input: { title?: string; body?: string }
  ): Promise<GitHubPullRequest> {
    return this.#github.update((await this.discover(cwd)).root, number, input)
  }

  async githubPrMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    method: "merge" | "squash"
  ): Promise<GitHubPullRequest> {
    return this.#github.merge((await this.discover(cwd)).root, number, expectedHead, method)
  }

  async gitlabMrRead(cwd: string, threadId: string, iid: number): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.read(root, nativeThreadId, iid)
  }

  async gitlabMrChecks(
    cwd: string,
    threadId: string,
    iid: number
  ): Promise<GitLabMergeRequestChecks> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.checks(root, nativeThreadId, iid)
  }

  async gitlabMrUpdateTitle(
    cwd: string,
    threadId: string,
    iid: number,
    title: string
  ): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.updateTitle(root, nativeThreadId, iid, title)
  }

  async gitlabMrPostComment(
    cwd: string,
    threadId: string,
    iid: number,
    body: string
  ): Promise<GitLabMergeRequestNote> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.postComment(root, nativeThreadId, iid, body)
  }

  async gitlabMrCreate(
    cwd: string,
    threadId: string,
    input: {
      sourceBranch: string
      targetBranch?: string
      title: string
      description: string
      draft?: boolean
    }
  ): Promise<GitLabMergeRequest> {
    const { service, root, nativeThreadId } = await this.#gitlabThread(cwd, threadId)
    return service.create(root, nativeThreadId, input)
  }

  async gitlabMrBrowserForm(
    cwd: string,
    input: { sourceBranch: string; title: string; description: string }
  ): Promise<string> {
    return gitLabBrowserFormUrl(this.#executor, (await this.discover(cwd)).root, input)
  }

  async #gitlabThread(
    cwd: string,
    threadId: string
  ): Promise<{ service: GitLabMrService; root: string; nativeThreadId: string }> {
    if (!this.#gitlab) throw new Error("GitLab connector is unavailable")
    const { root, nativeThreadId } = await this.#codexThreadRepository(cwd, threadId)
    return { service: this.#gitlab, root, nativeThreadId }
  }

  async #codexThreadRepository(
    cwd: string,
    threadId: string
  ): Promise<{ root: string; nativeThreadId: string }> {
    if (!this.#threads) throw new Error("A local Codex thread is required")
    const thread = await this.#threads.get(threadId)
    if (thread.agentId !== "codex" || !thread.agentSessionId || !thread.cwd) {
      throw new Error("A local Codex thread is required for connector pull requests")
    }
    const repository = await this.discover(cwd)
    const threadRepository = await this.discover(thread.cwd)
    if (threadRepository.commonGitDir !== repository.commonGitDir) {
      throw new Error("The Codex thread belongs to another Git repository")
    }
    return { root: repository.root, nativeThreadId: thread.agentSessionId }
  }

  async init(cwd: string): Promise<GitRepository> {
    const existing = await this.discover(cwd).catch(() => null)
    if (existing) throw new Error(`Directory is already in Git repository ${existing.root}`)
    await this.#executor.run(cwd, ["init", "--initial-branch=main"])
    return this.discover(cwd)
  }

  async branchContext(cwd: string): Promise<GitBranchContext> {
    const { root } = await this.discover(cwd)
    const current =
      (
        await this.#executor.run(root, ["branch", "--show-current"], { readOnly: true })
      ).stdout.trim() || null
    const optional = async (args: string[]): Promise<string | null> => {
      try {
        return (await this.#executor.run(root, args, { readOnly: true })).stdout.trim() || null
      } catch (error) {
        if (error instanceof GitCommandError) return null
        throw error
      }
    }
    const upstream = current
      ? await optional(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
      : null
    const upstreamRemote = upstream?.split("/")[0]
    const remote = upstreamRemote || "origin"
    const remoteHead = await optional([
      "symbolic-ref",
      "--quiet",
      "--short",
      `refs/remotes/${remote}/HEAD`,
    ])
    let defaultBranch = remoteHead
    if (!defaultBranch) {
      for (const ref of [`${remote}/main`, `${remote}/master`, "main", "master"]) {
        const fullRef = ref.includes("/") ? `refs/remotes/${ref}` : `refs/heads/${ref}`
        const exists = await this.#executor
          .run(root, ["show-ref", "--verify", "--quiet", fullRef], { readOnly: true })
          .then(
            () => true,
            () => false
          )
        if (exists) {
          defaultBranch = ref
          break
        }
      }
    }
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = (
        await this.#executor.run(
          root,
          ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
          {
            readOnly: true,
          }
        )
      ).stdout.trim()
      const [left, right] = counts.split(/\s+/u).map(Number)
      if (
        left === undefined ||
        right === undefined ||
        !Number.isSafeInteger(left) ||
        !Number.isSafeInteger(right) ||
        left < 0 ||
        right < 0
      ) {
        throw new Error("Git returned invalid ahead/behind counts")
      }
      ahead = left
      behind = right
    }
    return { current, upstream, defaultBranch, ahead, behind }
  }

  async createBranch(cwd: string, name: string, startPoint?: string): Promise<string> {
    const repository = await this.discover(cwd)
    const branch = validateOperand(name, "branch")
    await this.#executor.run(repository.root, ["check-ref-format", "--branch", branch], {
      readOnly: true,
    })
    let start: string | undefined
    if (startPoint) {
      const ref = validateOperand(startPoint, "start point")
      start = (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
          { readOnly: true }
        )
      ).stdout.trim()
    }
    await this.#executor.run(repository.root, ["branch", "--", branch, ...(start ? [start] : [])])
    return branch
  }

  async checkout(cwd: string, target: string, stashChanges = false): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const ref = validateOperand(target, "checkout target")
    const explicitRemote = ref.startsWith("refs/remotes/")
    const shortRemote = explicitRemote ? ref.slice("refs/remotes/".length) : ref
    const previous = await this.status(repository.root)
    if (previous.entries.length > 0 && !stashChanges) {
      throw new Error("Working tree has changes; choose stashChanges to preserve them")
    }
    const stashBefore = stashChanges ? await this.#stashHead(repository.root) : null
    if (stashChanges && previous.entries.length > 0) {
      await this.#executor.run(repository.root, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        "Cypheria branch checkout",
      ])
    }
    const stashAfter = stashChanges ? await this.#stashHead(repository.root) : null
    const createdStash = stashAfter !== null && stashAfter !== stashBefore
    try {
      const local = explicitRemote
        ? false
        : await this.#executor
            .run(repository.root, ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`], {
              readOnly: true,
            })
            .then(
              () => true,
              () => false
            )
      if (local) {
        await this.#executor.run(repository.root, ["switch", "--", ref])
      } else if (!explicitRemote && /^[a-f0-9]{40,64}$/iu.test(ref)) {
        await this.#executor.run(repository.root, ["switch", "--detach", ref])
      } else {
        const remote = await this.#executor
          .run(
            repository.root,
            ["show-ref", "--verify", "--quiet", `refs/remotes/${shortRemote}`],
            {
              readOnly: true,
            }
          )
          .then(
            () => true,
            () => false
          )
        if (remote) {
          await this.#executor.run(repository.root, ["switch", "--track", shortRemote])
        } else if (explicitRemote) {
          throw new Error("Remote branch does not exist")
        } else {
          await this.#executor.run(repository.root, ["switch", "--guess", "--", ref])
        }
      }
    } catch (error) {
      if (createdStash) {
        try {
          await this.#executor.run(repository.root, ["stash", "pop", "--index"])
        } catch (restoreError) {
          throw new Error(
            `Checkout failed and saved changes need recovery from stash ${stashAfter}: ${String(restoreError)}`,
            { cause: error }
          )
        }
      }
      throw error
    }
    if (createdStash) {
      try {
        await this.#executor.run(repository.root, ["stash", "pop", "--index"])
      } catch (error) {
        throw new Error(
          `Branch changed, but saved changes need recovery from stash ${stashAfter}: ${String(error)}`,
          { cause: error }
        )
      }
    }
    return this.status(repository.root)
  }

  async #stashHead(root: string): Promise<string | null> {
    return this.#executor
      .run(root, ["rev-parse", "--verify", "refs/stash"], { readOnly: true })
      .then(
        ({ stdout }) => stdout.trim(),
        () => null
      )
  }

  async status(cwd: string): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const [porcelain, head, branch] = await Promise.all([
      this.#executor.run(
        repository.root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        {
          readOnly: true,
        }
      ),
      this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true }).then(
        ({ stdout }) => stdout.trim(),
        () => null
      ),
      this.#executor
        .run(repository.root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { readOnly: true })
        .then(
          ({ stdout }) => stdout.trim(),
          () => null
        ),
    ])
    const records = porcelain.stdout.split("\0")
    const entries: { code: string; path: string }[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record) continue
      const code = record.slice(0, 2)
      const path = record.slice(3)
      if (!path) continue
      entries.push({ code, path })
      if (code.includes("R") || code.includes("C")) index += 1
    }
    return { branch, entries, head, repository }
  }

  async diff(
    cwd: string,
    input: { staged?: boolean; base?: string; paths?: readonly string[] } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    const args = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ]
    if (input.staged) args.push("--cached")
    if (input.base) args.push(validateOperand(input.base, "base"))
    if (input.paths?.length) args.push("--", ...(await this.#paths(repository.root, input.paths)))
    return (await this.#executor.run(repository.root, args, { readOnly: true })).stdout
  }

  async branchReview(cwd: string, base: string): Promise<GitBranchReview> {
    const repository = await this.discover(cwd)
    const reference = validateOperand(base, "base branch")
    const head = trimmed(
      (
        await this.#executor.run(repository.root, ["rev-parse", "--verify", "HEAD"], {
          readOnly: true,
        })
      ).stdout
    )
    const baseCommit = trimmed(
      (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`],
          { readOnly: true }
        )
      ).stdout
    )
    const mergeBase = trimmed(
      (
        await this.#executor.run(repository.root, ["merge-base", head, baseCommit], {
          readOnly: true,
        })
      ).stdout
    )
    const { stdout } = await this.#executor.run(
      repository.root,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-status",
        "-z",
        mergeBase,
        head,
      ],
      { readOnly: true }
    )
    const records = stdout.split("\0")
    const entries: GitBranchReview["entries"][number][] = []
    for (let index = 0; index < records.length - 1; index += 2) {
      const code = records[index]
      const path = records[index + 1]
      if (!code || !path) continue
      if (code !== "A" && code !== "M" && code !== "D" && code !== "T" && code !== "U") {
        throw new Error(`Unexpected Git branch diff status: ${code}`)
      }
      entries.push({ code, path })
    }
    return { base: mergeBase, head, entries }
  }

  async branchReviewDiff(
    cwd: string,
    input: { base: string; expectedHead: string; path: string }
  ): Promise<string> {
    const repository = await this.discover(cwd)
    if (
      !/^[a-f0-9]{40,64}$/iu.test(input.base) ||
      !/^[a-f0-9]{40,64}$/iu.test(input.expectedHead)
    ) {
      throw new Error("Invalid Git review snapshot")
    }
    const currentHead = trimmed(
      (
        await this.#executor.run(repository.root, ["rev-parse", "--verify", "HEAD"], {
          readOnly: true,
        })
      ).stdout
    )
    if (currentHead !== input.expectedHead) {
      throw new GitStaleSnapshotError("Branch changed; refresh the review")
    }
    const path = this.#historicalPath(repository.root, input.path)
    return (
      await this.#executor.run(
        repository.root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          input.base,
          input.expectedHead,
          "--",
          path,
        ],
        { readOnly: true }
      )
    ).stdout
  }

  async stage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "add",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "restore",
      "--staged",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async commit(cwd: string, message: string): Promise<string> {
    if (!message.trim()) throw new Error("Commit message is required")
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, ["commit", "-m", message])
    return trimmed(
      (await this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true })).stdout
    )
  }

  async push(
    cwd: string,
    input: {
      remote?: string
      branch?: string
      setUpstream?: boolean
      forceWithLease?: boolean
    } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    const args = ["push", "--porcelain"]
    if (input.forceWithLease) args.push("--force-with-lease")
    if (input.setUpstream) args.push("-u")
    if (input.remote) args.push(validateOperand(input.remote, "remote"))
    if (input.branch) args.push(validateOperand(input.branch, "branch"))
    return (await this.#executor.run(repository.root, args, { timeoutMs: 120_000 })).stdout
  }

  async branches(
    cwd: string
  ): Promise<readonly { name: string; current: boolean; commit: string }[]> {
    const repository = await this.discover(cwd)
    const { stdout } = await this.#executor.run(
      repository.root,
      ["for-each-ref", "--format=%(HEAD)%00%(refname:short)%00%(objectname)%00", "refs/heads"],
      { readOnly: true }
    )
    const branches: { name: string; current: boolean; commit: string }[] = []
    for (const line of stdout.split("\n")) {
      const [head, name, commit] = line.split("\0")
      if (!name) continue
      branches.push({ current: head?.trim() === "*", name, commit: commit ?? "" })
    }
    return branches
  }

  async searchBranches(cwd: string, query: string, limit = 20): Promise<GitBranchSearchResult[]> {
    if (query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Invalid Git branch search")
    }
    const repository = await this.discover(cwd)
    const { stdout } = await this.#executor.run(
      repository.root,
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(HEAD)%00%(refname)%00%(objectname)%00",
        "refs/heads",
        "refs/remotes",
      ],
      { readOnly: true }
    )
    const matches: GitBranchSearchResult[] = []
    const needle = query.toLocaleLowerCase()
    for (const line of stdout.split("\n")) {
      const [head, ref, commit] = line.split("\0")
      if (!ref || !commit || ref.endsWith("/HEAD")) continue
      const scope = ref.startsWith("refs/heads/") ? "local" : "remote"
      const name = ref.slice(scope === "local" ? "refs/heads/".length : "refs/remotes/".length)
      if (!name.toLocaleLowerCase().includes(needle)) continue
      matches.push({ name, current: head?.trim() === "*", commit, scope })
      if (matches.length >= limit) break
    }
    return matches
  }

  async #paths(root: string, paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) throw new Error("At least one path is required")
    return await Promise.all(
      paths.map(async (path) => {
        if (!path || path.includes("\0")) throw new Error("Invalid Git path")
        const absolute = resolve(root, path)
        const relativePath = relative(root, absolute)
        if (
          relativePath === ".." ||
          relativePath.startsWith(`..${sep}`) ||
          isAbsolute(relativePath)
        ) {
          throw new Error("Git path is outside the repository")
        }
        const parent = dirname(absolute)
        const parentInfo = await stat(parent).catch(() => null)
        if (!parentInfo?.isDirectory()) throw new Error("Git path parent is unavailable")
        const actualParent = await realpath(parent)
        const actualRelative = relative(root, actualParent)
        if (
          actualRelative === ".." ||
          actualRelative.startsWith(`..${sep}`) ||
          isAbsolute(actualRelative)
        ) {
          throw new Error("Git path resolves outside the repository")
        }
        return relativePath || "."
      })
    )
  }

  #historicalPath(root: string, path: string): string {
    if (!path || path.includes("\0")) throw new Error("Invalid Git path")
    const relativePath = relative(root, resolve(root, path))
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath) ||
      relativePath === ""
    ) {
      throw new Error("Git path is outside the repository")
    }
    return relativePath
  }
}
