import type {
  GitBranch,
  GitHubAvailability,
  GitHubPullRequest,
  GitRepository,
  GitServerMessage,
  GitStatus,
  GitWorktree,
} from "@cypheria/protocol"
import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

const unwrap = <T>(message: GitServerMessage): T => {
  if (message.payload.ok) return message.payload.value as T
  const error = new Error(message.payload.error.message)
  error.name = message.payload.error.code
  throw error
}

export interface GitActions {
  discover(cwd: string, options?: RequestOptions): Promise<GitRepository>
  status(cwd: string, options?: RequestOptions): Promise<GitStatus>
  branches(cwd: string, options?: RequestOptions): Promise<GitBranch[]>
  init(cwd: string, options?: RequestOptions): Promise<GitRepository>
  createBranch(
    cwd: string,
    name: string,
    startPoint?: string,
    options?: RequestOptions
  ): Promise<string>
  checkout(
    cwd: string,
    target: string,
    stashChanges?: boolean,
    options?: RequestOptions
  ): Promise<GitStatus>
  diff(
    cwd: string,
    input?: { staged?: boolean; base?: string; paths?: string[] },
    options?: RequestOptions
  ): Promise<string>
  stage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  unstage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  commit(cwd: string, message: string, options?: RequestOptions): Promise<string>
  push(
    cwd: string,
    input?: { remote?: string; branch?: string; setUpstream?: boolean; forceWithLease?: boolean },
    options?: RequestOptions
  ): Promise<string>
  worktrees(cwd: string, options?: RequestOptions): Promise<GitWorktree[]>
  createWorktree(cwd: string, startPoint?: string, options?: RequestOptions): Promise<GitWorktree>
  deleteWorktree(cwd: string, path: string, options?: RequestOptions): Promise<void>
  restoreWorktree(cwd: string, path: string, options?: RequestOptions): Promise<GitWorktree>
  githubAvailability(cwd: string, options?: RequestOptions): Promise<GitHubAvailability>
  githubPrList(
    cwd: string,
    input?: { state?: "open" | "closed" | "merged" | "all"; limit?: number },
    options?: RequestOptions
  ): Promise<GitHubPullRequest[]>
  githubPrRead(cwd: string, number: number, options?: RequestOptions): Promise<GitHubPullRequest>
  githubPrCreate(
    cwd: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean },
    options?: RequestOptions
  ): Promise<GitHubPullRequest>
  githubPrUpdate(
    cwd: string,
    number: number,
    input: { title?: string; body?: string },
    options?: RequestOptions
  ): Promise<GitHubPullRequest>
  githubPrMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    method: "merge" | "squash",
    options?: RequestOptions
  ): Promise<GitHubPullRequest>
}

export const createGitActions = (client: ServerClient): GitActions => ({
  discover: async (cwd, options) =>
    unwrap(await client.requestGit("git.discover.request", { cwd }, options)),
  status: async (cwd, options) =>
    unwrap(await client.requestGit("git.status.request", { cwd }, options)),
  branches: async (cwd, options) =>
    unwrap(await client.requestGit("git.branches.request", { cwd }, options)),
  init: async (cwd, options) =>
    unwrap(await client.requestGit("git.init.request", { cwd }, options)),
  createBranch: async (cwd, name, startPoint, options) =>
    unwrap<{ name: string }>(
      await client.requestGit("git.branch-create.request", { cwd, name, startPoint }, options)
    ).name,
  checkout: async (cwd, target, stashChanges, options) =>
    unwrap(await client.requestGit("git.checkout.request", { cwd, target, stashChanges }, options)),
  diff: async (cwd, input = {}, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.diff.request", { cwd, ...input }, options)
    ).diff,
  stage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.stage.request", { cwd, paths }, options))
  },
  unstage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.unstage.request", { cwd, paths }, options))
  },
  commit: async (cwd, message, options) =>
    unwrap<{ commit: string }>(
      await client.requestGit("git.commit.request", { cwd, message }, options)
    ).commit,
  push: async (cwd, input = {}, options) =>
    unwrap<{ output: string }>(
      await client.requestGit("git.push.request", { cwd, ...input }, options)
    ).output,
  worktrees: async (cwd, options) =>
    unwrap(await client.requestGit("git.worktrees.request", { cwd }, options)),
  createWorktree: async (cwd, startPoint, options) =>
    unwrap(await client.requestGit("git.worktree-create.request", { cwd, startPoint }, options)),
  deleteWorktree: async (cwd, path, options) => {
    unwrap(await client.requestGit("git.worktree-delete.request", { cwd, path }, options))
  },
  restoreWorktree: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.worktree-restore.request", { cwd, path }, options)),
  githubAvailability: async (cwd, options) =>
    unwrap(await client.requestGit("git.github-availability.request", { cwd }, options)),
  githubPrList: async (cwd, input = {}, options) =>
    unwrap(await client.requestGit("git.github-pr-list.request", { cwd, ...input }, options)),
  githubPrRead: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-read.request", { cwd, number }, options)),
  githubPrCreate: async (cwd, input, options) =>
    unwrap(await client.requestGit("git.github-pr-create.request", { cwd, ...input }, options)),
  githubPrUpdate: async (cwd, number, input, options) =>
    unwrap(
      await client.requestGit("git.github-pr-update.request", { cwd, number, ...input }, options)
    ),
  githubPrMerge: async (cwd, number, expectedHead, method, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-merge.request",
        { cwd, number, expectedHead, method },
        options
      )
    ),
})
