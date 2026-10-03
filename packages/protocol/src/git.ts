import { z } from "zod"

import { ProjectThreadIdSchema } from "./project-thread.ts"
import { RequestIdSchema } from "./request-id.ts"

const path = z.string().min(1)
const paths = z.array(path).min(1).max(1000)
const input = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ type: z.literal(type), requestId: RequestIdSchema, payload }).strict()
const output = <T extends string, S extends z.ZodType>(type: T, value: S) =>
  z
    .object({
      type: z.literal(type),
      requestId: RequestIdSchema,
      payload: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value }).strict(),
        z
          .object({
            ok: z.literal(false),
            error: z.object({ code: z.string(), message: z.string() }).strict(),
          })
          .strict(),
      ]),
    })
    .strict()

export const GitRepositorySchema = z.object({ root: path, commonGitDir: path }).strict()
export const GitAvailabilitySchema = z
  .object({ available: z.boolean(), version: z.string().nullable() })
  .strict()
export const GitRemoteIdentitySchema = z
  .object({ name: z.string(), host: z.string(), repository: z.string() })
  .strict()
export const GitRepositoryChangedNotificationSchema = z
  .object({
    type: z.literal("git.repository-changed.notification"),
    payload: z.object({ root: path, generation: z.number().int().nonnegative() }).strict(),
  })
  .strict()
export type GitRepositoryChangedNotification = z.infer<
  typeof GitRepositoryChangedNotificationSchema
>
export const GitOriginSchema = z
  .object({ provider: z.enum(["github", "gitlab", "other", "none"]) })
  .strict()
export const GitStatusSchema = z
  .object({
    branch: z.string().nullable(),
    entries: z.array(z.object({ code: z.string().length(2), path }).strict()),
    head: z.string().nullable(),
    repository: GitRepositorySchema,
    /** Untracked files left out of `entries` because there were too many to list. */
    untrackedOmitted: z.number().int().nonnegative(),
  })
  .strict()
export const GitBranchSchema = z
  .object({ name: z.string(), current: z.boolean(), commit: z.string() })
  .strict()
export const GitBranchSearchResultSchema = GitBranchSchema.extend({
  scope: z.enum(["local", "remote"]),
}).strict()
export const GitBranchReviewSchema = z
  .object({
    base: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    head: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    entries: z.array(z.object({ code: z.enum(["A", "M", "D", "T", "U"]), path }).strict()),
  })
  .strict()
export const GitCommitSummarySchema = z
  .object({ id: z.string().regex(/^[a-f0-9]{40,64}$/iu), subject: z.string(), date: z.string() })
  .strict()
export const GitReviewFileSchema = z
  .object({
    source: z.enum(["staged", "unstaged"]),
    path,
    diff: z.string(),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    hunks: z.array(
      z.object({ index: z.number().int().nonnegative(), header: z.string() }).strict()
    ),
  })
  .strict()
export const GitReviewLineCountSchema = z
  .object({
    path,
    additions: z.number().int().nonnegative().nullable(),
    deletions: z.number().int().nonnegative().nullable(),
  })
  .strict()
export const GitReviewUndoEntrySchema = z
  .object({ id: z.uuid(), path, createdAt: z.iso.datetime() })
  .strict()
export const GitBranchContextSchema = z
  .object({
    current: z.string().nullable(),
    upstream: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
  })
  .strict()
export const GitBranchComparisonSchema = z
  .object({
    base: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    head: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    mergeBase: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    files: z.array(GitReviewLineCountSchema),
  })
  .strict()
export const GitCloneStateSchema = z
  .object({ shallow: z.boolean(), partial: z.boolean(), promisorRemote: z.string().nullable() })
  .strict()
export const GitIndexEntrySchema = z
  .object({
    path,
    mode: z.string().regex(/^[0-7]{6}$/u),
    objectId: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    stage: z.number().int().min(0).max(3),
  })
  .strict()
export const GitTextBlobSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), content: z.string() }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
])

/** Both complete sides of a Review file; a side is null when the file does not exist there. */
export const GitReviewFileContentsSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      oldContent: z.string().nullable(),
      newContent: z.string().nullable(),
    })
    .strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
])
export const GitBlameLineSchema = z
  .object({
    commitSha: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    lineNumber: z.number().int().positive(),
    author: z.string().nullable(),
    authorLogin: z.string().nullable(),
    authorTime: z.number().int().nonnegative().nullable(),
    summary: z.string().nullable(),
  })
  .strict()
export const GitWorktreeSchema = z
  .object({
    id: z.uuid().nullable(),
    path,
    head: z.string().nullable(),
    branch: z.string().nullable(),
    managed: z.boolean(),
    active: z.boolean(),
    ownerThreadId: ProjectThreadIdSchema.nullable(),
  })
  .strict()
export const GitSyncedBranchStateSchema = z
  .object({
    branch: z.string().min(1),
    expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    branchHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    worktreeHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    sourceDirty: z.boolean(),
    worktreeDirty: z.boolean(),
    backupRef: z.string().nullable(),
  })
  .strict()
export const GitWorktreeJobSchema = z
  .object({
    id: z.uuid(),
    phase: z.enum(["queued", "creating", "setting-up", "ready", "failed", "cancelled"]),
    path: path.nullable(),
    error: z.string().nullable(),
    log: z.string(),
    worktree: GitWorktreeSchema.nullable(),
  })
  .strict()
export const GitDiscoverRequestSchema = input(
  "git.discover.request",
  z.object({ cwd: path }).strict()
)
export const GitAvailabilityRequestSchema = input(
  "git.availability.request",
  z.object({ cwd: path }).strict()
)
export const GitRemotesRequestSchema = input(
  "git.remotes.request",
  z.object({ cwd: path }).strict()
)
export const GitBranchExistsRequestSchema = input(
  "git.branch-exists.request",
  z.object({ cwd: path, name: path, scope: z.enum(["local", "remote", "any"]).optional() }).strict()
)
export const GitBranchCommitsRequestSchema = input(
  "git.branch-commits.request",
  z.object({ cwd: path, ref: path, limit: z.number().int().min(1).max(100).optional() }).strict()
)
export const GitOriginRequestSchema = input("git.origin.request", z.object({ cwd: path }).strict())
export const GitStatusRequestSchema = input("git.status.request", z.object({ cwd: path }).strict())
export const GitBranchesRequestSchema = input(
  "git.branches.request",
  z.object({ cwd: path }).strict()
)
export const GitBranchSearchRequestSchema = input(
  "git.branch-search.request",
  z
    .object({ cwd: path, query: z.string().max(200), limit: z.number().int().min(1).max(100) })
    .strict()
)
export const GitBranchContextRequestSchema = input(
  "git.branch-context.request",
  z.object({ cwd: path }).strict()
)
export const GitBranchComparisonRequestSchema = input(
  "git.branch-comparison.request",
  z.object({ cwd: path, base: path, head: path.optional() }).strict()
)
export const GitCloneStateRequestSchema = input(
  "git.clone-state.request",
  z.object({ cwd: path }).strict()
)
export const GitWorktreeStartingRefRequestSchema = input(
  "git.worktree-starting-ref.request",
  z.object({ cwd: path, startPoint: z.string().min(1) }).strict()
)
export const GitConfigValueRequestSchema = input(
  "git.config-value.request",
  z.object({ cwd: path, key: z.enum(["codex.localEnvironmentConfigPath"]) }).strict()
)
export const GitSetConfigValueRequestSchema = input(
  "git.set-config-value.request",
  z
    .object({
      cwd: path,
      key: z.enum(["codex.localEnvironmentConfigPath"]),
      value: z.string().max(4096).nullable(),
    })
    .strict()
)
export const GitIndexEntriesRequestSchema = input(
  "git.index-entries.request",
  z.object({ cwd: path, path }).strict()
)
export const GitSubmodulePathsRequestSchema = input(
  "git.submodule-paths.request",
  z.object({ cwd: path }).strict()
)
export const GitTextBlobRequestSchema = input(
  "git.text-blob.request",
  z.object({ cwd: path, revision: z.string().regex(/^[a-f0-9]{40,64}$/iu), path }).strict()
)
export const GitReviewFileContentsRequestSchema = input(
  "git.review-file-contents.request",
  z
    .object({
      cwd: path,
      source: z.enum(["unstaged", "staged", "uncommitted", "branch", "commit", "last-turn"]),
      path,
      /** Previous path of a renamed file, read on the old side. */
      oldPath: path.optional(),
      /** Pinned old and new revisions; required for branch, commit, and last-turn sources. */
      base: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/iu)
        .optional(),
      head: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/iu)
        .optional(),
    })
    .strict()
)
export const GitGeneratedPathsRequestSchema = input(
  "git.generated-paths.request",
  z.object({ cwd: path, paths: z.array(path).max(5000) }).strict()
)
export const GitBlameFileRequestSchema = input(
  "git.blame-file.request",
  z.object({ cwd: path, path }).strict()
)
export const GitIndexInfoRequestSchema = input(
  "git.index-info.request",
  z.object({ cwd: path }).strict()
)
export const GitInitRequestSchema = input("git.init.request", z.object({ cwd: path }).strict())
export const GitBranchCreateRequestSchema = input(
  "git.branch-create.request",
  z.object({ cwd: path, name: z.string().min(1), startPoint: z.string().optional() }).strict()
)
export const GitCheckoutRequestSchema = input(
  "git.checkout.request",
  z.object({ cwd: path, target: z.string().min(1), stashChanges: z.boolean().optional() }).strict()
)
export const GitDiffRequestSchema = input(
  "git.diff.request",
  z
    .object({
      cwd: path,
      staged: z.boolean().optional(),
      ignoreWhitespace: z.boolean().optional(),
      base: z.string().optional(),
      paths: paths.optional(),
    })
    .strict()
)
export const GitBranchReviewRequestSchema = input(
  "git.branch-review.request",
  z.object({ cwd: path, base: z.string().min(1) }).strict()
)
export const GitBranchReviewDiffRequestSchema = input(
  "git.branch-review-diff.request",
  z
    .object({
      cwd: path,
      base: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      path,
      ignoreWhitespace: z.boolean().optional(),
    })
    .strict()
)
export const GitCommitListRequestSchema = input(
  "git.commit-list.request",
  z.object({ cwd: path, limit: z.number().int().min(1).max(100) }).strict()
)
export const GitCommitReviewRequestSchema = input(
  "git.commit-review.request",
  z.object({ cwd: path, commit: z.string().regex(/^[a-f0-9]{40,64}$/iu) }).strict()
)
export const GitCommitReviewDiffRequestSchema = input(
  "git.commit-review-diff.request",
  z
    .object({
      cwd: path,
      base: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      commit: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      path,
      ignoreWhitespace: z.boolean().optional(),
    })
    .strict()
)
export const GitLastTurnReviewRequestSchema = input(
  "git.last-turn-review.request",
  z.object({ cwd: path, threadId: ProjectThreadIdSchema }).strict()
)
export const GitLastTurnReviewDiffRequestSchema = input(
  "git.last-turn-review-diff.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      base: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      head: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      path,
      ignoreWhitespace: z.boolean().optional(),
    })
    .strict()
)
export const GitReviewLineCountsRequestSchema = input(
  "git.review-line-counts.request",
  z
    .object({
      cwd: path,
      source: z.enum(["unstaged", "staged", "uncommitted", "branch", "commit", "last-turn"]),
      ignoreWhitespace: z.boolean().optional(),
      base: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/iu)
        .optional(),
      head: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/iu)
        .optional(),
    })
    .strict()
)
export const GitReviewFileRequestSchema = input(
  "git.review-file.request",
  z
    .object({
      cwd: path,
      source: z.enum(["staged", "unstaged"]),
      path,
      ignoreWhitespace: z.boolean().optional(),
    })
    .strict()
)
export const GitApplyReviewSectionRequestSchema = input(
  "git.apply-review-section.request",
  z
    .object({
      cwd: path,
      source: z.enum(["staged", "unstaged"]),
      path,
      revision: z.string().regex(/^[a-f0-9]{64}$/u),
      action: z.enum(["stage", "unstage", "revert"]),
      hunkIndex: z.number().int().nonnegative().optional(),
    })
    .strict()
)
export const GitApplyReviewSectionsRequestSchema = input(
  "git.apply-review-sections.request",
  z
    .object({
      cwd: path,
      sections: z
        .array(GitApplyReviewSectionRequestSchema.shape.payload.omit({ cwd: true }))
        .min(1)
        .max(100),
    })
    .strict()
)
export const GitUndoReviewRevertRequestSchema = input(
  "git.undo-review-revert.request",
  z.object({ cwd: path, undoId: z.uuid() }).strict()
)
export const GitReviewUndoListRequestSchema = input(
  "git.review-undo-list.request",
  z.object({ cwd: path }).strict()
)
export const GitApplyPatchRequestSchema = input(
  "git.apply-patch.request",
  z
    .object({
      cwd: path,
      diff: z
        .string()
        .min(1)
        .max(32 * 1024 * 1024),
      target: z.enum(["unstaged", "staged", "staged-and-unstaged"]).default("unstaged"),
      atomic: z.boolean().optional(),
      reverse: z.boolean().optional(),
      allowBinary: z.boolean().optional(),
    })
    .strict()
)
export const GitApplyChangesRequestSchema = input(
  "git.apply-changes.request",
  z
    .object({
      cwd: path,
      sourceHeadRef: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      sourceTreeRef: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      destinationHeadRef: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitStageRequestSchema = input(
  "git.stage.request",
  z.object({ cwd: path, paths }).strict()
)
export const GitUnstageRequestSchema = input(
  "git.unstage.request",
  z.object({ cwd: path, paths }).strict()
)
export const GitCommitRequestSchema = input(
  "git.commit.request",
  z
    .object({
      cwd: path,
      message: z.string().min(1).max(100_000),
      includeUnstaged: z.boolean().optional(),
      coAuthors: z.array(z.string().min(1).max(200)).max(20).optional(),
    })
    .strict()
)
export const GitGenerateTextRequestSchema = input(
  "git.generate-text.request",
  z
    .object({ cwd: path, kind: z.enum(["commit", "pull-request"]), base: z.string().optional() })
    .strict()
)
export const GitPushRequestSchema = input(
  "git.push.request",
  z
    .object({
      cwd: path,
      remote: z.string().optional(),
      branch: z.string().optional(),
      setUpstream: z.boolean().optional(),
      forceWithLease: z.boolean().optional(),
    })
    .strict()
)

/**
 * How a pull request is created: GitHub's `gh` CLI signed in on this host, the GitHub or GitLab
 * account linked in ChatGPT, or the provider's own page opened in the browser.
 */
export const GitPullRequestSourceSchema = z.enum(["github-cli", "connector", "browser"])
export type GitPullRequestSource = z.infer<typeof GitPullRequestSourceSchema>

/** Where a checkout's pull request would go, and what creating it would have to do first. */
export const GitPullRequestTargetSchema = z
  .object({
    provider: z.enum(["github", "gitlab"]),
    host: z.string().min(1),
    /** The owner, or the GitLab group path. */
    owner: z.string().min(1),
    repository: z.string().min(1),
    root: path,
    branch: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    hasChanges: z.boolean(),
    /** The sources that can create it here, preferred first; the browser always can. */
    sources: z.array(GitPullRequestSourceSchema).min(1),
  })
  .strict()
export type GitPullRequestTarget = z.infer<typeof GitPullRequestTargetSchema>

export const GitPullRequestTargetRequestSchema = input(
  "git.pull-request-target.request",
  z.object({ cwd: path }).strict()
)
/**
 * Creates a pull request for a checkout: optionally on a new branch, after committing local
 * changes and pushing, then attaches it to the Thread. A blank title or body is written from the
 * branch's changes.
 */
export const GitPullRequestCreateRequestSchema = input(
  "git.pull-request-create.request",
  z
    .object({
      cwd: path,
      threadId: z.string().min(1).optional(),
      base: z.string().min(1).max(1024).optional(),
      newBranch: z.string().min(1).max(1024).optional(),
      includeLocalChanges: z.boolean(),
      commitMessage: z.string().max(100_000).optional(),
      title: z.string().max(1024).optional(),
      body: z.string().max(100_000).optional(),
      draft: z.boolean(),
      /** Opens the provider's prefilled page instead of creating the pull request here. */
      openInBrowser: z.boolean(),
    })
    .strict()
)

/** Managed worktrees of every repository, for the Worktrees settings page. */
export const GitManagedWorktreesRequestSchema = input(
  "git.managed-worktrees.request",
  z.object({}).strict()
)
export const GitWorktreesRequestSchema = input(
  "git.worktrees.request",
  z.object({ cwd: path }).strict()
)
export const GitWorktreeCreateRequestSchema = input(
  "git.worktree-create.request",
  z.object({ cwd: path, startPoint: z.string().optional() }).strict()
)
export const GitWorktreeJobStartRequestSchema = input(
  "git.worktree-job-start.request",
  z
    .object({
      cwd: path,
      startPoint: z.string().optional(),
      includeChanges: z.boolean().optional(),
      environmentConfigPath: z.string().nullable().optional(),
    })
    .strict()
)
export const GitWorktreeJobReadRequestSchema = input(
  "git.worktree-job-read.request",
  z.object({ id: z.uuid() }).strict()
)
export const GitWorktreeJobCancelRequestSchema = input(
  "git.worktree-job-cancel.request",
  z.object({ id: z.uuid() }).strict()
)
export const GitWorktreeJobRetryRequestSchema = input(
  "git.worktree-job-retry.request",
  z.object({ id: z.uuid(), skipSetup: z.boolean().optional() }).strict()
)
export const GitWorktreeDeleteRequestSchema = input(
  "git.worktree-delete.request",
  z.object({ cwd: path, path }).strict()
)
export const GitWorktreeRestoreRequestSchema = input(
  "git.worktree-restore.request",
  z.object({ cwd: path, path }).strict()
)
export const GitWorktreeOwnerRequestSchema = input(
  "git.worktree-owner.request",
  z.object({ cwd: path, path, threadId: ProjectThreadIdSchema.nullable() }).strict()
)
export const GitWorktreeMoveThreadRequestSchema = input(
  "git.worktree-move-thread.request",
  z
    .object({
      cwd: path,
      path,
      threadId: ProjectThreadIdSchema,
      copyChanges: z.boolean().optional(),
    })
    .strict()
)
export const GitSyncedBranchStateRequestSchema = input(
  "git.synced-branch-state.request",
  z.object({ cwd: path, path }).strict()
)
export const GitSyncedBranchSyncRequestSchema = input(
  "git.synced-branch-sync.request",
  z
    .object({
      cwd: path,
      path,
      expectedBranchHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      expectedWorktreeHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitSyncedBranchUndoRequestSchema = input(
  "git.synced-branch-undo.request",
  z.object({ cwd: path, path }).strict()
)
const success = z.object({ succeeded: z.literal(true) }).strict()
export const GitDiscoverResponseSchema = output("git.discover.response", GitRepositorySchema)
export const GitAvailabilityResponseSchema = output(
  "git.availability.response",
  GitAvailabilitySchema
)
export const GitRemotesResponseSchema = output(
  "git.remotes.response",
  z.array(GitRemoteIdentitySchema)
)
export const GitBranchExistsResponseSchema = output(
  "git.branch-exists.response",
  z.object({ exists: z.boolean() }).strict()
)
export const GitBranchCommitsResponseSchema = output(
  "git.branch-commits.response",
  z.array(GitCommitSummarySchema)
)
export const GitOriginResponseSchema = output("git.origin.response", GitOriginSchema)
export const GitStatusResponseSchema = output("git.status.response", GitStatusSchema)
export const GitBranchesResponseSchema = output("git.branches.response", z.array(GitBranchSchema))
export const GitBranchSearchResponseSchema = output(
  "git.branch-search.response",
  z.array(GitBranchSearchResultSchema)
)
export const GitBranchContextResponseSchema = output(
  "git.branch-context.response",
  GitBranchContextSchema
)
export const GitBranchComparisonResponseSchema = output(
  "git.branch-comparison.response",
  GitBranchComparisonSchema
)
export const GitCloneStateResponseSchema = output("git.clone-state.response", GitCloneStateSchema)
export const GitWorktreeStartingRefResponseSchema = output(
  "git.worktree-starting-ref.response",
  z.object({ ref: z.string(), commit: z.string().regex(/^[a-f0-9]{40,64}$/iu) }).strict()
)
export const GitConfigValueResponseSchema = output(
  "git.config-value.response",
  z.object({ value: z.string().nullable() }).strict()
)
export const GitSetConfigValueResponseSchema = output(
  "git.set-config-value.response",
  z.object({ succeeded: z.literal(true) }).strict()
)
export const GitIndexEntriesResponseSchema = output(
  "git.index-entries.response",
  z.array(GitIndexEntrySchema)
)
export const GitSubmodulePathsResponseSchema = output("git.submodule-paths.response", z.array(path))
export const GitTextBlobResponseSchema = output("git.text-blob.response", GitTextBlobSchema)
export const GitGeneratedPathsResponseSchema = output("git.generated-paths.response", z.array(path))
export const GitReviewFileContentsResponseSchema = output(
  "git.review-file-contents.response",
  GitReviewFileContentsSchema
)
export const GitBlameFileResponseSchema = output(
  "git.blame-file.response",
  z.array(GitBlameLineSchema)
)
export const GitIndexInfoResponseSchema = output(
  "git.index-info.response",
  z.object({ lastModified: z.number().nonnegative() }).strict()
)
export const GitInitResponseSchema = output("git.init.response", GitRepositorySchema)
export const GitBranchCreateResponseSchema = output(
  "git.branch-create.response",
  z.object({ name: z.string() }).strict()
)
export const GitCheckoutResponseSchema = output("git.checkout.response", GitStatusSchema)
export const GitDiffResponseSchema = output(
  "git.diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitBranchReviewResponseSchema = output(
  "git.branch-review.response",
  GitBranchReviewSchema
)
export const GitBranchReviewDiffResponseSchema = output(
  "git.branch-review-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitCommitListResponseSchema = output(
  "git.commit-list.response",
  z.array(GitCommitSummarySchema)
)
export const GitCommitReviewResponseSchema = output(
  "git.commit-review.response",
  GitBranchReviewSchema
)
export const GitCommitReviewDiffResponseSchema = output(
  "git.commit-review-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitLastTurnReviewResponseSchema = output(
  "git.last-turn-review.response",
  GitBranchReviewSchema.nullable()
)
export const GitLastTurnReviewDiffResponseSchema = output(
  "git.last-turn-review-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitReviewLineCountsResponseSchema = output(
  "git.review-line-counts.response",
  z.array(GitReviewLineCountSchema)
)
export const GitReviewFileResponseSchema = output("git.review-file.response", GitReviewFileSchema)
export const GitApplyReviewSectionResponseSchema = output(
  "git.apply-review-section.response",
  z.object({ undoId: z.uuid().nullable() }).strict()
)
export const GitApplyReviewSectionsResponseSchema = output(
  "git.apply-review-sections.response",
  z.array(
    z
      .object({
        path,
        status: z.enum(["applied", "stale", "conflict", "skipped", "failed"]),
        undoId: z.uuid().nullable(),
        error: z.string().nullable(),
      })
      .strict()
  )
)
export const GitUndoReviewRevertResponseSchema = output("git.undo-review-revert.response", success)
export const GitReviewUndoListResponseSchema = output(
  "git.review-undo-list.response",
  z.array(GitReviewUndoEntrySchema)
)
export const GitPatchResultSchema = z
  .object({
    status: z.enum(["success", "partial-success", "error"]),
    appliedPaths: z.array(path),
    skippedPaths: z.array(path),
    conflictedPaths: z.array(path),
    error: z.string().nullable(),
  })
  .strict()
export const GitApplyPatchResponseSchema = output("git.apply-patch.response", GitPatchResultSchema)
export const GitApplyChangesResponseSchema = output(
  "git.apply-changes.response",
  GitPatchResultSchema
)
export const GitStageResponseSchema = output("git.stage.response", success)
export const GitUnstageResponseSchema = output("git.unstage.response", success)
export const GitCommitResponseSchema = output(
  "git.commit.response",
  z.object({ commit: z.string() }).strict()
)
export const GitGenerateTextResponseSchema = output(
  "git.generate-text.response",
  z.object({ title: z.string(), body: z.string() }).strict()
)
export const GitPullRequestTargetResponseSchema = output(
  "git.pull-request-target.response",
  z.object({ target: GitPullRequestTargetSchema.nullable() }).strict()
)
export const GitPullRequestCreateResponseSchema = output(
  "git.pull-request-create.response",
  z
    .object({
      url: z.string().url(),
      /** Null when the browser page opens instead, or the provider did not say. */
      number: z.number().int().positive().nullable(),
      source: GitPullRequestSourceSchema,
      /** The page to finish in the browser; the pull request does not exist yet. */
      openedInBrowser: z.boolean(),
      branch: z.string(),
      /** The commit made from local changes, if any. */
      commit: z.string().nullable(),
    })
    .strict()
)
export const GitPushResponseSchema = output(
  "git.push.response",
  z.object({ output: z.string() }).strict()
)
export const GitManagedWorktreesResponseSchema = output(
  "git.managed-worktrees.response",
  z
    .object({
      repositories: z.array(
        z.object({ root: path, worktrees: z.array(GitWorktreeSchema) }).strict()
      ),
    })
    .strict()
)
export const GitWorktreesResponseSchema = output(
  "git.worktrees.response",
  z.array(GitWorktreeSchema)
)
export const GitWorktreeCreateResponseSchema = output(
  "git.worktree-create.response",
  GitWorktreeSchema
)
export const GitWorktreeJobStartResponseSchema = output(
  "git.worktree-job-start.response",
  GitWorktreeJobSchema
)
export const GitWorktreeJobReadResponseSchema = output(
  "git.worktree-job-read.response",
  GitWorktreeJobSchema
)
export const GitWorktreeJobCancelResponseSchema = output(
  "git.worktree-job-cancel.response",
  GitWorktreeJobSchema
)
export const GitWorktreeJobRetryResponseSchema = output(
  "git.worktree-job-retry.response",
  GitWorktreeJobSchema
)
export const GitWorktreeDeleteResponseSchema = output("git.worktree-delete.response", success)
export const GitWorktreeRestoreResponseSchema = output(
  "git.worktree-restore.response",
  GitWorktreeSchema
)
export const GitWorktreeOwnerResponseSchema = output(
  "git.worktree-owner.response",
  GitWorktreeSchema
)
export const GitWorktreeMoveThreadResponseSchema = output(
  "git.worktree-move-thread.response",
  success
)
export const GitSyncedBranchStateResponseSchema = output(
  "git.synced-branch-state.response",
  GitSyncedBranchStateSchema.nullable()
)
export const GitSyncedBranchSyncResponseSchema = output(
  "git.synced-branch-sync.response",
  z.object({ backupRef: z.string().min(1) }).strict()
)
export const GitSyncedBranchUndoResponseSchema = output("git.synced-branch-undo.response", success)
export const GIT_CLIENT_SCHEMAS = [
  GitDiscoverRequestSchema,
  GitAvailabilityRequestSchema,
  GitRemotesRequestSchema,
  GitBranchExistsRequestSchema,
  GitBranchCommitsRequestSchema,
  GitOriginRequestSchema,
  GitStatusRequestSchema,
  GitBranchesRequestSchema,
  GitBranchSearchRequestSchema,
  GitBranchContextRequestSchema,
  GitBranchComparisonRequestSchema,
  GitCloneStateRequestSchema,
  GitWorktreeStartingRefRequestSchema,
  GitConfigValueRequestSchema,
  GitSetConfigValueRequestSchema,
  GitIndexEntriesRequestSchema,
  GitSubmodulePathsRequestSchema,
  GitTextBlobRequestSchema,
  GitReviewFileContentsRequestSchema,
  GitGeneratedPathsRequestSchema,
  GitBlameFileRequestSchema,
  GitIndexInfoRequestSchema,
  GitInitRequestSchema,
  GitBranchCreateRequestSchema,
  GitCheckoutRequestSchema,
  GitDiffRequestSchema,
  GitBranchReviewRequestSchema,
  GitBranchReviewDiffRequestSchema,
  GitCommitListRequestSchema,
  GitCommitReviewRequestSchema,
  GitCommitReviewDiffRequestSchema,
  GitLastTurnReviewRequestSchema,
  GitLastTurnReviewDiffRequestSchema,
  GitReviewLineCountsRequestSchema,
  GitReviewFileRequestSchema,
  GitApplyReviewSectionRequestSchema,
  GitApplyReviewSectionsRequestSchema,
  GitUndoReviewRevertRequestSchema,
  GitReviewUndoListRequestSchema,
  GitApplyPatchRequestSchema,
  GitApplyChangesRequestSchema,
  GitStageRequestSchema,
  GitUnstageRequestSchema,
  GitCommitRequestSchema,
  GitGenerateTextRequestSchema,
  GitPushRequestSchema,
  GitPullRequestTargetRequestSchema,
  GitPullRequestCreateRequestSchema,
  GitManagedWorktreesRequestSchema,
  GitWorktreesRequestSchema,
  GitWorktreeCreateRequestSchema,
  GitWorktreeJobStartRequestSchema,
  GitWorktreeJobReadRequestSchema,
  GitWorktreeJobCancelRequestSchema,
  GitWorktreeJobRetryRequestSchema,
  GitWorktreeDeleteRequestSchema,
  GitWorktreeRestoreRequestSchema,
  GitWorktreeOwnerRequestSchema,
  GitWorktreeMoveThreadRequestSchema,
  GitSyncedBranchStateRequestSchema,
  GitSyncedBranchSyncRequestSchema,
  GitSyncedBranchUndoRequestSchema,
] as const
export const GIT_SERVER_SCHEMAS = [
  GitDiscoverResponseSchema,
  GitAvailabilityResponseSchema,
  GitRemotesResponseSchema,
  GitBranchExistsResponseSchema,
  GitBranchCommitsResponseSchema,
  GitOriginResponseSchema,
  GitStatusResponseSchema,
  GitBranchesResponseSchema,
  GitBranchSearchResponseSchema,
  GitBranchContextResponseSchema,
  GitBranchComparisonResponseSchema,
  GitCloneStateResponseSchema,
  GitWorktreeStartingRefResponseSchema,
  GitConfigValueResponseSchema,
  GitSetConfigValueResponseSchema,
  GitIndexEntriesResponseSchema,
  GitSubmodulePathsResponseSchema,
  GitTextBlobResponseSchema,
  GitReviewFileContentsResponseSchema,
  GitGeneratedPathsResponseSchema,
  GitBlameFileResponseSchema,
  GitIndexInfoResponseSchema,
  GitInitResponseSchema,
  GitBranchCreateResponseSchema,
  GitCheckoutResponseSchema,
  GitDiffResponseSchema,
  GitBranchReviewResponseSchema,
  GitBranchReviewDiffResponseSchema,
  GitCommitListResponseSchema,
  GitCommitReviewResponseSchema,
  GitCommitReviewDiffResponseSchema,
  GitLastTurnReviewResponseSchema,
  GitLastTurnReviewDiffResponseSchema,
  GitReviewLineCountsResponseSchema,
  GitReviewFileResponseSchema,
  GitApplyReviewSectionResponseSchema,
  GitApplyReviewSectionsResponseSchema,
  GitUndoReviewRevertResponseSchema,
  GitReviewUndoListResponseSchema,
  GitApplyPatchResponseSchema,
  GitApplyChangesResponseSchema,
  GitStageResponseSchema,
  GitUnstageResponseSchema,
  GitCommitResponseSchema,
  GitGenerateTextResponseSchema,
  GitPushResponseSchema,
  GitPullRequestTargetResponseSchema,
  GitPullRequestCreateResponseSchema,
  GitManagedWorktreesResponseSchema,
  GitWorktreesResponseSchema,
  GitWorktreeCreateResponseSchema,
  GitWorktreeJobStartResponseSchema,
  GitWorktreeJobReadResponseSchema,
  GitWorktreeJobCancelResponseSchema,
  GitWorktreeJobRetryResponseSchema,
  GitWorktreeDeleteResponseSchema,
  GitWorktreeRestoreResponseSchema,
  GitWorktreeOwnerResponseSchema,
  GitWorktreeMoveThreadResponseSchema,
  GitSyncedBranchStateResponseSchema,
  GitSyncedBranchSyncResponseSchema,
  GitSyncedBranchUndoResponseSchema,
] as const
export const GIT_RESPONSE_TYPES = GIT_SERVER_SCHEMAS.map((schema) => schema.shape.type.value)
export const GitClientMessageSchema = z.discriminatedUnion("type", GIT_CLIENT_SCHEMAS)
export type GitClientMessage = z.infer<(typeof GIT_CLIENT_SCHEMAS)[number]>
export type GitServerMessage = z.infer<(typeof GIT_SERVER_SCHEMAS)[number]>
export type GitRepository = z.infer<typeof GitRepositorySchema>
export type GitAvailability = z.infer<typeof GitAvailabilitySchema>
export type GitRemoteIdentity = z.infer<typeof GitRemoteIdentitySchema>
export type GitOrigin = z.infer<typeof GitOriginSchema>
export type GitStatus = z.infer<typeof GitStatusSchema>
export type GitBranch = z.infer<typeof GitBranchSchema>
export type GitBranchSearchResult = z.infer<typeof GitBranchSearchResultSchema>
export type GitBranchReview = z.infer<typeof GitBranchReviewSchema>
export type GitCommitSummary = z.infer<typeof GitCommitSummarySchema>
export type GitReviewFile = z.infer<typeof GitReviewFileSchema>
export type GitReviewLineCount = z.infer<typeof GitReviewLineCountSchema>
export type GitReviewUndoEntry = z.infer<typeof GitReviewUndoEntrySchema>
export type GitPatchResult = z.infer<typeof GitPatchResultSchema>
export type GitBranchContext = z.infer<typeof GitBranchContextSchema>
export type GitBranchComparison = z.infer<typeof GitBranchComparisonSchema>
export type GitCloneState = z.infer<typeof GitCloneStateSchema>
export type GitIndexEntry = z.infer<typeof GitIndexEntrySchema>
export type GitTextBlob = z.infer<typeof GitTextBlobSchema>
export type GitReviewFileContents = z.infer<typeof GitReviewFileContentsSchema>
export type GitBlameLine = z.infer<typeof GitBlameLineSchema>
export type GitWorktree = z.infer<typeof GitWorktreeSchema>
export type GitSyncedBranchState = z.infer<typeof GitSyncedBranchStateSchema>
export type GitWorktreeJob = z.infer<typeof GitWorktreeJobSchema>
