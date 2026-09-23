import type {
  GitBranch,
  GitBranchContext,
  GitBranchReview,
  GitBranchSearchResult,
  GitHubAppAvailability,
  GitHubAppCreatedPullRequest,
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
  origin(cwd: string, options?: RequestOptions): Promise<GitOrigin>
  status(cwd: string, options?: RequestOptions): Promise<GitStatus>
  branches(cwd: string, options?: RequestOptions): Promise<GitBranch[]>
  searchBranches(
    cwd: string,
    query: string,
    limit?: number,
    options?: RequestOptions
  ): Promise<GitBranchSearchResult[]>
  branchContext(cwd: string, options?: RequestOptions): Promise<GitBranchContext>
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
  branchReview(cwd: string, base: string, options?: RequestOptions): Promise<GitBranchReview>
  branchReviewDiff(
    cwd: string,
    input: { base: string; expectedHead: string; path: string },
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
  githubAppAvailability(
    cwd: string,
    threadId: string,
    options?: RequestOptions
  ): Promise<GitHubAppAvailability>
  githubAppPrCreate(
    cwd: string,
    threadId: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean },
    options?: RequestOptions
  ): Promise<GitHubAppCreatedPullRequest>
  githubAppPrList(
    cwd: string,
    threadId: string,
    options?: RequestOptions
  ): Promise<{ items: GitHubAppPullRequestSummary[]; truncated: boolean }>
  githubAppPrRead(
    cwd: string,
    threadId: string,
    number: number,
    options?: RequestOptions
  ): Promise<GitHubAppPullRequest>
  githubPrList(
    cwd: string,
    input?: { state?: "open" | "closed" | "merged" | "all"; limit?: number },
    options?: RequestOptions
  ): Promise<GitHubPullRequest[]>
  githubPrRead(cwd: string, number: number, options?: RequestOptions): Promise<GitHubPullRequest>
  githubPrChecks(
    cwd: string,
    number: number,
    options?: RequestOptions
  ): Promise<GitHubPullRequestChecks>
  githubPrActivity(
    cwd: string,
    number: number,
    options?: RequestOptions
  ): Promise<GitHubPullRequestActivity>
  githubPrComment(
    cwd: string,
    number: number,
    expectedHead: string,
    body: string,
    options?: RequestOptions
  ): Promise<void>
  githubPrReview(
    cwd: string,
    number: number,
    expectedHead: string,
    decision: "approve" | "comment" | "request_changes",
    body: string,
    options?: RequestOptions
  ): Promise<void>
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
  gitlabMrRead(
    cwd: string,
    threadId: string,
    iid: number,
    options?: RequestOptions
  ): Promise<GitLabMergeRequest>
  gitlabMrChecks(
    cwd: string,
    threadId: string,
    iid: number,
    options?: RequestOptions
  ): Promise<GitLabMergeRequestChecks>
  gitlabMrUpdateTitle(
    cwd: string,
    threadId: string,
    iid: number,
    title: string,
    options?: RequestOptions
  ): Promise<GitLabMergeRequest>
  gitlabMrPostComment(
    cwd: string,
    threadId: string,
    iid: number,
    body: string,
    options?: RequestOptions
  ): Promise<GitLabMergeRequestNote>
  gitlabMrCreate(
    cwd: string,
    threadId: string,
    input: {
      sourceBranch: string
      targetBranch?: string
      title: string
      description: string
      draft?: boolean
    },
    options?: RequestOptions
  ): Promise<GitLabMergeRequest>
  gitlabMrBrowserForm(
    cwd: string,
    input: { sourceBranch: string; title: string; description: string },
    options?: RequestOptions
  ): Promise<string>
}

export const createGitActions = (client: ServerClient): GitActions => ({
  discover: async (cwd, options) =>
    unwrap(await client.requestGit("git.discover.request", { cwd }, options)),
  origin: async (cwd, options) =>
    unwrap(await client.requestGit("git.origin.request", { cwd }, options)),
  status: async (cwd, options) =>
    unwrap(await client.requestGit("git.status.request", { cwd }, options)),
  branches: async (cwd, options) =>
    unwrap(await client.requestGit("git.branches.request", { cwd }, options)),
  searchBranches: async (cwd, query, limit = 20, options) =>
    unwrap(await client.requestGit("git.branch-search.request", { cwd, query, limit }, options)),
  branchContext: async (cwd, options) =>
    unwrap(await client.requestGit("git.branch-context.request", { cwd }, options)),
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
  branchReview: async (cwd, base, options) =>
    unwrap(await client.requestGit("git.branch-review.request", { cwd, base }, options)),
  branchReviewDiff: async (cwd, input, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.branch-review-diff.request", { cwd, ...input }, options)
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
  githubAppAvailability: async (cwd, threadId, options) =>
    unwrap(
      await client.requestGit("git.github-app-availability.request", { cwd, threadId }, options)
    ),
  githubAppPrCreate: async (cwd, threadId, input, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-create.request",
        { cwd, threadId, ...input },
        options
      )
    ),
  githubAppPrList: async (cwd, threadId, options) =>
    unwrap(await client.requestGit("git.github-app-pr-list.request", { cwd, threadId }, options)),
  githubAppPrRead: async (cwd, threadId, number, options) =>
    unwrap(
      await client.requestGit("git.github-app-pr-read.request", { cwd, threadId, number }, options)
    ),
  githubPrList: async (cwd, input = {}, options) =>
    unwrap(await client.requestGit("git.github-pr-list.request", { cwd, ...input }, options)),
  githubPrRead: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-read.request", { cwd, number }, options)),
  githubPrChecks: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-checks.request", { cwd, number }, options)),
  githubPrActivity: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-activity.request", { cwd, number }, options)),
  githubPrComment: async (cwd, number, expectedHead, body, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-comment.request",
        { cwd, number, expectedHead, body },
        options
      )
    )
  },
  githubPrReview: async (cwd, number, expectedHead, decision, body, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-review.request",
        { cwd, number, expectedHead, decision, body },
        options
      )
    )
  },
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
  gitlabMrRead: async (cwd, threadId, iid, options) =>
    unwrap(await client.requestGit("git.gitlab-mr-read.request", { cwd, threadId, iid }, options)),
  gitlabMrChecks: async (cwd, threadId, iid, options) =>
    unwrap(
      await client.requestGit("git.gitlab-mr-checks.request", { cwd, threadId, iid }, options)
    ),
  gitlabMrUpdateTitle: async (cwd, threadId, iid, title, options) =>
    unwrap(
      await client.requestGit(
        "git.gitlab-mr-update-title.request",
        { cwd, threadId, iid, title },
        options
      )
    ),
  gitlabMrPostComment: async (cwd, threadId, iid, body, options) =>
    unwrap(
      await client.requestGit(
        "git.gitlab-mr-post-comment.request",
        { cwd, threadId, iid, body },
        options
      )
    ),
  gitlabMrCreate: async (cwd, threadId, input, options) =>
    unwrap(
      await client.requestGit("git.gitlab-mr-create.request", { cwd, threadId, ...input }, options)
    ),
  gitlabMrBrowserForm: async (cwd, input, options) =>
    unwrap<{ url: string }>(
      await client.requestGit("git.gitlab-mr-browser-form.request", { cwd, ...input }, options)
    ).url,
})
