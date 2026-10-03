import type {
  GitAvailability,
  GitBlameLine,
  GitBranch,
  GitBranchComparison,
  GitBranchContext,
  GitBranchReview,
  GitBranchSearchResult,
  GitClientMessage,
  GitCloneState,
  GitCommitSummary,
  GitIndexEntry,
  GitOrigin,
  GitPatchResult,
  GitPullRequestSource,
  GitPullRequestTarget,
  GitRemoteIdentity,
  GitRepository,
  GitReviewFile,
  GitReviewFileContents,
  GitReviewLineCount,
  GitReviewUndoEntry,
  GitServerMessage,
  GitStatus,
  GitSyncedBranchState,
  GitTextBlob,
  GitWorktree,
  GitWorktreeJob,
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
  availability(cwd: string, options?: RequestOptions): Promise<GitAvailability>
  remotes(cwd: string, options?: RequestOptions): Promise<GitRemoteIdentity[]>
  branchExists(
    cwd: string,
    name: string,
    scope?: "local" | "remote" | "any",
    options?: RequestOptions
  ): Promise<boolean>
  branchCommits(
    cwd: string,
    ref: string,
    limit?: number,
    options?: RequestOptions
  ): Promise<GitCommitSummary[]>
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
  cloneState(cwd: string, options?: RequestOptions): Promise<GitCloneState>
  worktreeStartingRef(
    cwd: string,
    startPoint: string,
    options?: RequestOptions
  ): Promise<{ ref: string; commit: string }>
  configValue(
    cwd: string,
    key: "codex.localEnvironmentConfigPath",
    options?: RequestOptions
  ): Promise<string | null>
  setConfigValue(
    cwd: string,
    key: "codex.localEnvironmentConfigPath",
    value: string | null,
    options?: RequestOptions
  ): Promise<void>
  indexEntries(cwd: string, path: string, options?: RequestOptions): Promise<GitIndexEntry[]>
  submodulePaths(cwd: string, options?: RequestOptions): Promise<string[]>
  textBlob(
    cwd: string,
    revision: string,
    path: string,
    options?: RequestOptions
  ): Promise<GitTextBlob>
  reviewFileContents(
    cwd: string,
    input: {
      source: "unstaged" | "staged" | "uncommitted" | "branch" | "commit" | "last-turn"
      path: string
      oldPath?: string
      base?: string
      head?: string
    },
    options?: RequestOptions
  ): Promise<GitReviewFileContents>
  generatedPaths(cwd: string, paths: string[], options?: RequestOptions): Promise<string[]>
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
  applyReviewSections(
    cwd: string,
    sections: Array<{
      source: "staged" | "unstaged"
      path: string
      revision: string
      action: "stage" | "unstage" | "revert"
      hunkIndex?: number
    }>,
    options?: RequestOptions
  ): Promise<
    Array<{
      path: string
      status: "applied" | "stale" | "conflict" | "failed"
      undoId: string | null
      error: string | null
    }>
  >
  undoReviewRevert(cwd: string, undoId: string, options?: RequestOptions): Promise<void>
  reviewUndoList(cwd: string, options?: RequestOptions): Promise<GitReviewUndoEntry[]>
  applyPatch(
    cwd: string,
    input: {
      diff: string
      target?: "unstaged" | "staged" | "staged-and-unstaged"
      atomic?: boolean
      reverse?: boolean
      allowBinary?: boolean
    },
    options?: RequestOptions
  ): Promise<GitPatchResult>
  applyChanges(
    cwd: string,
    input: {
      sourceHeadRef: string
      sourceTreeRef: string
      destinationHeadRef: string
    },
    options?: RequestOptions
  ): Promise<GitPatchResult>
  stage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  unstage(cwd: string, paths: string[], options?: RequestOptions): Promise<void>
  commit(
    cwd: string,
    input: string | { message: string; includeUnstaged?: boolean; coAuthors?: string[] },
    options?: RequestOptions
  ): Promise<string>
  generateText(
    cwd: string,
    kind: "commit" | "pull-request",
    base?: string,
    options?: RequestOptions
  ): Promise<{ title: string; body: string }>
  push(
    cwd: string,
    input?: { remote?: string; branch?: string; setUpstream?: boolean; forceWithLease?: boolean },
    options?: RequestOptions
  ): Promise<string>
  /** Where the checkout's pull request would go; null without a GitHub or GitLab origin. */
  pullRequestTarget(cwd: string, options?: RequestOptions): Promise<GitPullRequestTarget | null>
  /** Commits, pushes, creates the pull request, and attaches it to the Thread when given. */
  createPullRequest(
    input: Extract<GitClientMessage, { type: "git.pull-request-create.request" }>["payload"],
    options?: RequestOptions
  ): Promise<{
    url: string
    number: number | null
    source: GitPullRequestSource
    openedInBrowser: boolean
    branch: string
    commit: string | null
  }>
  worktrees(cwd: string, options?: RequestOptions): Promise<GitWorktree[]>
  /** Managed worktrees of every repository, grouped by repository. */
  managedWorktrees(
    options?: RequestOptions
  ): Promise<{ repositories: { root: string; worktrees: GitWorktree[] }[] }>
  createWorktree(cwd: string, startPoint?: string, options?: RequestOptions): Promise<GitWorktree>
  startWorktreeJob(
    cwd: string,
    input?: {
      startPoint?: string
      includeChanges?: boolean
      environmentConfigPath?: string | null
    },
    options?: RequestOptions
  ): Promise<GitWorktreeJob>
  worktreeJob(id: string, options?: RequestOptions): Promise<GitWorktreeJob>
  cancelWorktreeJob(id: string, options?: RequestOptions): Promise<GitWorktreeJob>
  retryWorktreeJob(
    id: string,
    skipSetup?: boolean,
    options?: RequestOptions
  ): Promise<GitWorktreeJob>
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
    input?: { copyChanges?: boolean },
    options?: RequestOptions
  ): Promise<void>
  syncedBranchState(
    cwd: string,
    path: string,
    options?: RequestOptions
  ): Promise<GitSyncedBranchState | null>
  syncBranch(
    cwd: string,
    path: string,
    expectedBranchHead: string,
    expectedWorktreeHead: string,
    options?: RequestOptions
  ): Promise<{ backupRef: string }>
  undoSync(cwd: string, path: string, options?: RequestOptions): Promise<void>
}

export const createGitActions = (client: ServerClient): GitActions => ({
  discover: async (cwd, options) =>
    unwrap(await client.requestGit("git.discover.request", { cwd }, options)),
  availability: async (cwd, options) =>
    unwrap(await client.requestGit("git.availability.request", { cwd }, options)),
  remotes: async (cwd, options) =>
    unwrap(await client.requestGit("git.remotes.request", { cwd }, options)),
  branchExists: async (cwd, name, scope, options) =>
    unwrap<{ exists: boolean }>(
      await client.requestGit("git.branch-exists.request", { cwd, name, scope }, options)
    ).exists,
  branchCommits: async (cwd, ref, limit, options) =>
    unwrap(await client.requestGit("git.branch-commits.request", { cwd, ref, limit }, options)),
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
  cloneState: async (cwd, options) =>
    unwrap(await client.requestGit("git.clone-state.request", { cwd }, options)),
  worktreeStartingRef: async (cwd, startPoint, options) =>
    unwrap(
      await client.requestGit("git.worktree-starting-ref.request", { cwd, startPoint }, options)
    ),
  configValue: async (cwd, key, options) =>
    unwrap<{ value: string | null }>(
      await client.requestGit("git.config-value.request", { cwd, key }, options)
    ).value,
  setConfigValue: async (cwd, key, value, options) => {
    unwrap(await client.requestGit("git.set-config-value.request", { cwd, key, value }, options))
  },
  indexEntries: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.index-entries.request", { cwd, path }, options)),
  submodulePaths: async (cwd, options) =>
    unwrap(await client.requestGit("git.submodule-paths.request", { cwd }, options)),
  textBlob: async (cwd, revision, path, options) =>
    unwrap(await client.requestGit("git.text-blob.request", { cwd, revision, path }, options)),
  reviewFileContents: async (cwd, input, options) =>
    unwrap(await client.requestGit("git.review-file-contents.request", { cwd, ...input }, options)),
  generatedPaths: async (cwd, paths, options) =>
    unwrap(await client.requestGit("git.generated-paths.request", { cwd, paths }, options)),
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
  applyReviewSections: async (cwd, sections, options) =>
    unwrap(
      await client.requestGit("git.apply-review-sections.request", { cwd, sections }, options)
    ),
  undoReviewRevert: async (cwd, undoId, options) => {
    unwrap(await client.requestGit("git.undo-review-revert.request", { cwd, undoId }, options))
  },
  reviewUndoList: async (cwd, options) =>
    unwrap(await client.requestGit("git.review-undo-list.request", { cwd }, options)),
  applyPatch: async (cwd, input, options) =>
    unwrap(await client.requestGit("git.apply-patch.request", { cwd, ...input }, options)),
  applyChanges: async (cwd, input, options) =>
    unwrap(await client.requestGit("git.apply-changes.request", { cwd, ...input }, options)),
  stage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.stage.request", { cwd, paths }, options))
  },
  unstage: async (cwd, paths, options) => {
    unwrap(await client.requestGit("git.unstage.request", { cwd, paths }, options))
  },
  commit: async (cwd, input, options) =>
    unwrap<{ commit: string }>(
      await client.requestGit(
        "git.commit.request",
        { cwd, ...(typeof input === "string" ? { message: input } : input) },
        options
      )
    ).commit,
  generateText: async (cwd, kind, base, options) =>
    unwrap(await client.requestGit("git.generate-text.request", { cwd, kind, base }, options)),
  push: async (cwd, input = {}, options) =>
    unwrap<{ output: string }>(
      await client.requestGit("git.push.request", { cwd, ...input }, options)
    ).output,
  pullRequestTarget: async (cwd, options) =>
    unwrap<{ target: GitPullRequestTarget | null }>(
      await client.requestGit("git.pull-request-target.request", { cwd }, options)
    ).target,
  createPullRequest: async (input, options) =>
    unwrap(
      await client.requestGit("git.pull-request-create.request", input, {
        timeoutMs: 600_000,
        ...options,
      })
    ),
  worktrees: async (cwd, options) =>
    unwrap(await client.requestGit("git.worktrees.request", { cwd }, options)),
  managedWorktrees: async (options) =>
    unwrap(await client.requestGit("git.managed-worktrees.request", {}, options)),
  createWorktree: async (cwd, startPoint, options) =>
    unwrap(await client.requestGit("git.worktree-create.request", { cwd, startPoint }, options)),
  startWorktreeJob: async (cwd, input = {}, options) =>
    unwrap(await client.requestGit("git.worktree-job-start.request", { cwd, ...input }, options)),
  worktreeJob: async (id, options) =>
    unwrap(await client.requestGit("git.worktree-job-read.request", { id }, options)),
  cancelWorktreeJob: async (id, options) =>
    unwrap(await client.requestGit("git.worktree-job-cancel.request", { id }, options)),
  retryWorktreeJob: async (id, skipSetup, options) =>
    unwrap(await client.requestGit("git.worktree-job-retry.request", { id, skipSetup }, options)),
  deleteWorktree: async (cwd, path, options) => {
    unwrap(await client.requestGit("git.worktree-delete.request", { cwd, path }, options))
  },
  restoreWorktree: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.worktree-restore.request", { cwd, path }, options)),
  setWorktreeOwner: async (cwd, path, threadId, options) =>
    unwrap(await client.requestGit("git.worktree-owner.request", { cwd, path, threadId }, options)),
  moveThreadToWorktree: async (cwd, path, threadId, input, options) => {
    unwrap(
      await client.requestGit(
        "git.worktree-move-thread.request",
        { cwd, path, threadId, ...input },
        options
      )
    )
  },
  syncedBranchState: async (cwd, path, options) =>
    unwrap(await client.requestGit("git.synced-branch-state.request", { cwd, path }, options)),
  syncBranch: async (cwd, path, expectedBranchHead, expectedWorktreeHead, options) =>
    unwrap(
      await client.requestGit(
        "git.synced-branch-sync.request",
        { cwd, path, expectedBranchHead, expectedWorktreeHead },
        options
      )
    ),
  undoSync: async (cwd, path, options) => {
    unwrap(await client.requestGit("git.synced-branch-undo.request", { cwd, path }, options))
  },
})
