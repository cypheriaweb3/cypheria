import type {
  GitBlameLine,
  GitBranch,
  GitBranchComparison,
  GitBranchContext,
  GitBranchReview,
  GitBranchSearchResult,
  GitCommitSummary,
  GitHubAppAvailability,
  GitHubAppCreatedPullRequest,
  GitHubAppPrChecks,
  GitHubAppPrMedia,
  GitHubAppPullRequest,
  GitHubAppPullRequestSummary,
  GitHubAvailability,
  GitHubPrAttributesFile,
  GitHubPrMetadata,
  GitHubPrReviewStatus,
  GitHubPrRevisionFile,
  GitHubPrRevisionSnapshot,
  GitHubPrStackEntry,
  GitHubPullRequest,
  GitHubPullRequestActivity,
  GitHubPullRequestChecks,
  GitHubPullRequestThreads,
  GitHubUserCandidate,
  GitIndexEntry,
  GitLabMergeRequest,
  GitLabMergeRequestChecks,
  GitLabMergeRequestDiscussion,
  GitLabMergeRequestNote,
  GitLabReviewer,
  GitLabReviewerCandidate,
  GitOrigin,
  GitRepository,
  GitReviewFile,
  GitReviewLineCount,
  GitReviewUndoEntry,
  GitServerMessage,
  GitStatus,
  GitTextBlob,
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
  branchComparison(
    cwd: string,
    base: string,
    head?: string,
    options?: RequestOptions
  ): Promise<GitBranchComparison>
  indexEntries(cwd: string, path: string, options?: RequestOptions): Promise<GitIndexEntry[]>
  submodulePaths(cwd: string, options?: RequestOptions): Promise<string[]>
  textBlob(
    cwd: string,
    revision: string,
    path: string,
    options?: RequestOptions
  ): Promise<GitTextBlob>
  blameFile(cwd: string, path: string, options?: RequestOptions): Promise<GitBlameLine[]>
  indexInfo(cwd: string, options?: RequestOptions): Promise<{ lastModified: number }>
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
    input?: { staged?: boolean; base?: string; paths?: string[]; ignoreWhitespace?: boolean },
    options?: RequestOptions
  ): Promise<string>
  branchReview(cwd: string, base: string, options?: RequestOptions): Promise<GitBranchReview>
  branchReviewDiff(
    cwd: string,
    input: { base: string; expectedHead: string; path: string; ignoreWhitespace?: boolean },
    options?: RequestOptions
  ): Promise<string>
  commitList(cwd: string, limit?: number, options?: RequestOptions): Promise<GitCommitSummary[]>
  commitReview(cwd: string, commit: string, options?: RequestOptions): Promise<GitBranchReview>
  commitReviewDiff(
    cwd: string,
    input: { base: string; commit: string; path: string; ignoreWhitespace?: boolean },
    options?: RequestOptions
  ): Promise<string>
  lastTurnReview(
    cwd: string,
    threadId: string,
    options?: RequestOptions
  ): Promise<GitBranchReview | null>
  lastTurnReviewDiff(
    cwd: string,
    input: {
      threadId: string
      base: string
      head: string
      path: string
      ignoreWhitespace?: boolean
    },
    options?: RequestOptions
  ): Promise<string>
  reviewLineCounts(
    cwd: string,
    input: {
      source: "unstaged" | "staged" | "uncommitted" | "branch" | "commit" | "last-turn"
      base?: string
      head?: string
      ignoreWhitespace?: boolean
    },
    options?: RequestOptions
  ): Promise<GitReviewLineCount[]>
  reviewFile(
    cwd: string,
    source: "staged" | "unstaged",
    path: string,
    ignoreWhitespace?: boolean,
    options?: RequestOptions
  ): Promise<GitReviewFile>
  applyReviewSection(
    cwd: string,
    input: {
      source: "staged" | "unstaged"
      path: string
      revision: string
      action: "stage" | "unstage" | "revert"
      hunkIndex?: number
    },
    options?: RequestOptions
  ): Promise<string | null>
  undoReviewRevert(cwd: string, undoId: string, options?: RequestOptions): Promise<void>
  reviewUndoList(cwd: string, options?: RequestOptions): Promise<GitReviewUndoEntry[]>
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
  setWorktreeOwner(
    cwd: string,
    path: string,
    threadId: string | null,
    options?: RequestOptions
  ): Promise<GitWorktree>
  moveThreadToWorktree(
    cwd: string,
    path: string,
    threadId: string,
    options?: RequestOptions
  ): Promise<void>
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
    input?: {
      state?: "open" | "closed" | "merged" | "all"
      scope?: "all" | "authored" | "reviewing"
      query?: string
      limit?: number
    },
    options?: RequestOptions
  ): Promise<{ items: GitHubAppPullRequestSummary[]; truncated: boolean }>
  githubAppPrRead(
    cwd: string,
    threadId: string,
    number: number,
    options?: RequestOptions
  ): Promise<GitHubAppPullRequest>
  githubAppPrDiff(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<string>
  githubAppPrActivity(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPullRequestActivity>
  githubAppPrChecks(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubAppPrChecks>
  githubAppPrThreads(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPullRequestThreads>
  githubAppPrMedia(
    cwd: string,
    threadId: string,
    number: number,
    expectedHead: string,
    url: string,
    options?: RequestOptions
  ): Promise<GitHubAppPrMedia>
  githubPrList(
    cwd: string,
    input?: { state?: "open" | "closed" | "merged" | "all"; limit?: number; query?: string },
    options?: RequestOptions
  ): Promise<GitHubPullRequest[]>
  githubPrRead(cwd: string, number: number, options?: RequestOptions): Promise<GitHubPullRequest>
  githubPrForBranch(
    cwd: string,
    branch: string,
    options?: RequestOptions
  ): Promise<GitHubPullRequest | null>
  githubPrDiff(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<string>
  githubPrRevisionSnapshot(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPrRevisionSnapshot>
  githubPrRevisionDiff(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string,
    options?: RequestOptions
  ): Promise<string>
  githubPrRevisionFile(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string,
    basePath: string | null,
    headPath: string | null,
    options?: RequestOptions
  ): Promise<GitHubPrRevisionFile>
  githubPrMetadata(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPrMetadata>
  githubPrReviewStatus(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPrReviewStatus>
  githubPrUserSearch(
    cwd: string,
    number: number,
    expectedHead: string,
    query: string,
    scope: "collaborators" | "mentions",
    options?: RequestOptions
  ): Promise<GitHubUserCandidate[]>
  githubPrStack(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPrStackEntry[]>
  githubPrAttributes(
    cwd: string,
    number: number,
    expectedHead: string,
    paths: string[],
    options?: RequestOptions
  ): Promise<GitHubPrAttributesFile[]>
  githubPrAutoMergeStatus(cwd: string, number: number, options?: RequestOptions): Promise<boolean>
  githubPrToggleAutoMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    enabled: boolean,
    method: "merge" | "squash",
    options?: RequestOptions
  ): Promise<void>
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
  githubPrThreads(
    cwd: string,
    number: number,
    expectedHead: string,
    options?: RequestOptions
  ): Promise<GitHubPullRequestThreads>
  githubPrThreadAction(
    cwd: string,
    input: {
      number: number
      expectedHead: string
      action: "reply" | "resolve" | "unresolve" | "inline"
      threadId?: string
      body?: string
      path?: string
      line?: number
      side?: "LEFT" | "RIGHT"
    },
    options?: RequestOptions
  ): Promise<void>
  githubPrComment(
    cwd: string,
    number: number,
    expectedHead: string,
    body: string,
    options?: RequestOptions
  ): Promise<void>
  githubPrCommentAction(
    cwd: string,
    input: {
      number: number
      expectedHead: string
      nodeId: string
      commentType: "comment" | "review" | "review_comment"
      action: "update" | "delete"
      body?: string
    },
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
  githubPrSetState(
    cwd: string,
    number: number,
    expectedHead: string,
    action: "close" | "reopen" | "ready" | "draft",
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
    input: { expectedHead: string; title?: string; body?: string },
    options?: RequestOptions
  ): Promise<GitHubPullRequest>
  githubPrReviewer(
    cwd: string,
    number: number,
    expectedHead: string,
    reviewer: string,
    action: "add" | "remove",
    options?: RequestOptions
  ): Promise<void>
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
  gitlabMrForBranch(
    cwd: string,
    threadId: string,
    branch: string,
    options?: RequestOptions
  ): Promise<GitLabMergeRequest | null>
  gitlabMrChecks(
    cwd: string,
    threadId: string,
    iid: number,
    options?: RequestOptions
  ): Promise<GitLabMergeRequestChecks>
  gitlabMrDiscussions(
    cwd: string,
    threadId: string,
    iid: number,
    options?: RequestOptions
  ): Promise<GitLabMergeRequestDiscussion[]>
  gitlabMrReviewers(
    cwd: string,
    threadId: string,
    iid: number,
    options?: RequestOptions
  ): Promise<GitLabReviewer[]>
  gitlabMrReviewerSearch(
    cwd: string,
    threadId: string,
    query: string,
    options?: RequestOptions
  ): Promise<GitLabReviewerCandidate[]>
  gitlabMrReviewerAction(
    cwd: string,
    threadId: string,
    iid: number,
    userId: number,
    action: "add" | "remove",
    options?: RequestOptions
  ): Promise<GitLabReviewer[]>
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
  branchComparison: async (cwd, base, head, options) =>
    unwrap(await client.requestGit("git.branch-comparison.request", { cwd, base, head }, options)),
  indexEntries: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.index-entries.request", { cwd, path }, options)),
  submodulePaths: async (cwd, options) =>
    unwrap(await client.requestGit("git.submodule-paths.request", { cwd }, options)),
  textBlob: async (cwd, revision, path, options) =>
    unwrap(await client.requestGit("git.text-blob.request", { cwd, revision, path }, options)),
  blameFile: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.blame-file.request", { cwd, path }, options)),
  indexInfo: async (cwd, options) =>
    unwrap(await client.requestGit("git.index-info.request", { cwd }, options)),
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
  commitList: async (cwd, limit = 30, options) =>
    unwrap(await client.requestGit("git.commit-list.request", { cwd, limit }, options)),
  commitReview: async (cwd, commit, options) =>
    unwrap(await client.requestGit("git.commit-review.request", { cwd, commit }, options)),
  commitReviewDiff: async (cwd, input, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.commit-review-diff.request", { cwd, ...input }, options)
    ).diff,
  lastTurnReview: async (cwd, threadId, options) =>
    unwrap(await client.requestGit("git.last-turn-review.request", { cwd, threadId }, options)),
  lastTurnReviewDiff: async (cwd, input, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.last-turn-review-diff.request", { cwd, ...input }, options)
    ).diff,
  reviewLineCounts: async (cwd, input, options) =>
    unwrap(await client.requestGit("git.review-line-counts.request", { cwd, ...input }, options)),
  reviewFile: async (cwd, source, path, ignoreWhitespace, options) =>
    unwrap(
      await client.requestGit(
        "git.review-file.request",
        { cwd, source, path, ignoreWhitespace },
        options
      )
    ),
  applyReviewSection: async (cwd, input, options) =>
    unwrap<{ undoId: string | null }>(
      await client.requestGit("git.apply-review-section.request", { cwd, ...input }, options)
    ).undoId,
  undoReviewRevert: async (cwd, undoId, options) => {
    unwrap(await client.requestGit("git.undo-review-revert.request", { cwd, undoId }, options))
  },
  reviewUndoList: async (cwd, options) =>
    unwrap(await client.requestGit("git.review-undo-list.request", { cwd }, options)),
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
  setWorktreeOwner: async (cwd, path, threadId, options) =>
    unwrap(await client.requestGit("git.worktree-owner.request", { cwd, path, threadId }, options)),
  moveThreadToWorktree: async (cwd, path, threadId, options) => {
    unwrap(
      await client.requestGit("git.worktree-move-thread.request", { cwd, path, threadId }, options)
    )
  },
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
  githubAppPrList: async (cwd, threadId, input = {}, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-list.request",
        { cwd, threadId, ...input },
        options
      )
    ),
  githubAppPrRead: async (cwd, threadId, number, options) =>
    unwrap(
      await client.requestGit("git.github-app-pr-read.request", { cwd, threadId, number }, options)
    ),
  githubAppPrDiff: async (cwd, threadId, number, expectedHead, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit(
        "git.github-app-pr-diff.request",
        { cwd, threadId, number, expectedHead },
        options
      )
    ).diff,
  githubAppPrActivity: async (cwd, threadId, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-activity.request",
        { cwd, threadId, number, expectedHead },
        options
      )
    ),
  githubAppPrChecks: async (cwd, threadId, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-checks.request",
        { cwd, threadId, number, expectedHead },
        options
      )
    ),
  githubAppPrThreads: async (cwd, threadId, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-threads.request",
        { cwd, threadId, number, expectedHead },
        options
      )
    ),
  githubAppPrMedia: async (cwd, threadId, number, expectedHead, url, options) =>
    unwrap(
      await client.requestGit(
        "git.github-app-pr-media.request",
        { cwd, threadId, number, expectedHead, url },
        options
      )
    ),
  githubPrList: async (cwd, input = {}, options) =>
    unwrap(await client.requestGit("git.github-pr-list.request", { cwd, ...input }, options)),
  githubPrRead: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-read.request", { cwd, number }, options)),
  githubPrForBranch: async (cwd, branch, options) =>
    unwrap(await client.requestGit("git.github-pr-for-branch.request", { cwd, branch }, options)),
  githubPrDiff: async (cwd, number, expectedHead, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit("git.github-pr-diff.request", { cwd, number, expectedHead }, options)
    ).diff,
  githubPrRevisionSnapshot: async (cwd, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-revision-snapshot.request",
        { cwd, number, expectedHead },
        options
      )
    ),
  githubPrRevisionDiff: async (cwd, number, expectedHead, baseRevision, headRevision, options) =>
    unwrap<{ diff: string }>(
      await client.requestGit(
        "git.github-pr-revision-diff.request",
        { cwd, number, expectedHead, baseRevision, headRevision },
        options
      )
    ).diff,
  githubPrRevisionFile: async (
    cwd,
    number,
    expectedHead,
    baseRevision,
    headRevision,
    basePath,
    headPath,
    options
  ) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-revision-file.request",
        { cwd, number, expectedHead, baseRevision, headRevision, basePath, headPath },
        options
      )
    ),
  githubPrMetadata: async (cwd, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-metadata.request",
        { cwd, number, expectedHead },
        options
      )
    ),
  githubPrReviewStatus: async (cwd, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-review-status.request",
        { cwd, number, expectedHead },
        options
      )
    ),
  githubPrUserSearch: async (cwd, number, expectedHead, query, scope, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-user-search.request",
        { cwd, number, expectedHead, query, scope },
        options
      )
    ),
  githubPrStack: async (cwd, number, expectedHead, options) =>
    unwrap(
      await client.requestGit("git.github-pr-stack.request", { cwd, number, expectedHead }, options)
    ),
  githubPrAttributes: async (cwd, number, expectedHead, paths, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-attributes.request",
        { cwd, number, expectedHead, paths },
        options
      )
    ),
  githubPrAutoMergeStatus: async (cwd, number, options) =>
    unwrap<{ enabled: boolean }>(
      await client.requestGit("git.github-pr-auto-merge-status.request", { cwd, number }, options)
    ).enabled,
  githubPrToggleAutoMerge: async (cwd, number, expectedHead, enabled, method, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-toggle-auto-merge.request",
        { cwd, number, expectedHead, enabled, method },
        options
      )
    )
  },
  githubPrChecks: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-checks.request", { cwd, number }, options)),
  githubPrActivity: async (cwd, number, options) =>
    unwrap(await client.requestGit("git.github-pr-activity.request", { cwd, number }, options)),
  githubPrThreads: async (cwd, number, expectedHead, options) =>
    unwrap(
      await client.requestGit(
        "git.github-pr-threads.request",
        { cwd, number, expectedHead },
        options
      )
    ),
  githubPrThreadAction: async (cwd, input, options) => {
    unwrap(
      await client.requestGit("git.github-pr-thread-action.request", { cwd, ...input }, options)
    )
  },
  githubPrComment: async (cwd, number, expectedHead, body, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-comment.request",
        { cwd, number, expectedHead, body },
        options
      )
    )
  },
  githubPrCommentAction: async (cwd, input, options) => {
    unwrap(
      await client.requestGit("git.github-pr-comment-action.request", { cwd, ...input }, options)
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
  githubPrSetState: async (cwd, number, expectedHead, action, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-set-state.request",
        { cwd, number, expectedHead, action },
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
  githubPrReviewer: async (cwd, number, expectedHead, reviewer, action, options) => {
    unwrap(
      await client.requestGit(
        "git.github-pr-reviewer.request",
        { cwd, number, expectedHead, reviewer, action },
        options
      )
    )
  },
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
  gitlabMrForBranch: async (cwd, threadId, branch, options) =>
    unwrap(
      await client.requestGit(
        "git.gitlab-mr-for-branch.request",
        { cwd, threadId, branch },
        options
      )
    ),
  gitlabMrChecks: async (cwd, threadId, iid, options) =>
    unwrap(
      await client.requestGit("git.gitlab-mr-checks.request", { cwd, threadId, iid }, options)
    ),
  gitlabMrDiscussions: async (cwd, threadId, iid, options) =>
    unwrap(
      await client.requestGit("git.gitlab-mr-discussions.request", { cwd, threadId, iid }, options)
    ),
  gitlabMrReviewers: async (cwd, threadId, iid, options) =>
    unwrap(
      await client.requestGit("git.gitlab-mr-reviewers.request", { cwd, threadId, iid }, options)
    ),
  gitlabMrReviewerSearch: async (cwd, threadId, query, options) =>
    unwrap(
      await client.requestGit(
        "git.gitlab-mr-reviewer-search.request",
        { cwd, threadId, query },
        options
      )
    ),
  gitlabMrReviewerAction: async (cwd, threadId, iid, userId, action, options) =>
    unwrap(
      await client.requestGit(
        "git.gitlab-mr-reviewer-action.request",
        { cwd, threadId, iid, userId, action },
        options
      )
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
