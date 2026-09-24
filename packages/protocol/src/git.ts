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
export const GitOriginSchema = z
  .object({ provider: z.enum(["github", "gitlab", "other", "none"]) })
  .strict()
export const GitStatusSchema = z
  .object({
    branch: z.string().nullable(),
    entries: z.array(z.object({ code: z.string().length(2), path }).strict()),
    head: z.string().nullable(),
    repository: GitRepositorySchema,
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
export const GitHubAvailabilitySchema = z
  .object({
    installed: z.boolean(),
    authenticated: z.boolean(),
    account: z.string().nullable(),
    repository: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict()
export const GitHubAppAvailabilitySchema = z
  .object({
    available: z.boolean(),
    canList: z.boolean(),
    canRead: z.boolean(),
    canSearchByAccount: z.boolean(),
    canDiff: z.boolean(),
    canActivity: z.boolean(),
    canChecks: z.boolean(),
    canThreads: z.boolean(),
    canMedia: z.boolean(),
    repository: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict()
export const GitLabMrAvailabilitySchema = z
  .object({
    connected: z.boolean(),
    project: z.string().nullable(),
    error: z.string().nullable(),
    canRead: z.boolean(),
    canFindByBranch: z.boolean(),
    canCreate: z.boolean(),
    canComment: z.boolean(),
    canUpdateTitle: z.boolean(),
    canReadDiscussions: z.boolean(),
    canReadReviewers: z.boolean(),
    canSearchReviewers: z.boolean(),
    canManageReviewers: z.boolean(),
    canReadChecks: z.boolean(),
  })
  .strict()
export const GitHubAppCreatedPullRequestSchema = z
  .object({ number: z.number().int().positive(), url: z.url() })
  .strict()
export const GitHubPullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    url: z.url(),
    state: z.string(),
    isDraft: z.boolean(),
    headRefName: z.string(),
    headRefOid: z.string(),
    baseRefName: z.string(),
    updatedAt: z.string(),
    author: z.object({ login: z.string() }).nullable(),
  })
  .strict()
export const GitHubAppPullRequestSummarySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    url: z.url(),
    updatedAt: z.string(),
  })
  .strict()
export const GitHubAppPullRequestSchema = GitHubPullRequestSchema.omit({ headRefOid: true })
  .extend({ headRefOid: z.string().nullable() })
  .strict()
export const GitHubPullRequestChecksSchema = z.array(
  z
    .object({
      name: z.string(),
      state: z.string(),
      bucket: z.enum(["pass", "fail", "pending", "skipping", "cancel"]),
      link: z.url().nullable(),
      workflow: z.string().nullable(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    })
    .strict()
)
export const GitHubAppPrChecksSchema = z
  .object({ checks: GitHubPullRequestChecksSchema, complete: z.boolean() })
  .strict()
export const GitHubAppPrMediaSchema = z
  .object({
    mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    contentsBase64: z.string().min(1),
  })
  .strict()
export const GitHubPullRequestActivitySchema = z
  .object({
    comments: z.array(
      z
        .object({
          id: z.string(),
          body: z.string(),
          author: z.string().nullable(),
          createdAt: z.string(),
        })
        .strict()
    ),
    reviews: z.array(
      z
        .object({
          id: z.string(),
          body: z.string(),
          author: z.string().nullable(),
          state: z.string(),
          submittedAt: z.string(),
        })
        .strict()
    ),
  })
  .strict()
export const GitHubPullRequestThreadsSchema = z
  .object({
    threads: z.array(
      z
        .object({
          id: z.string(),
          path: z.string(),
          line: z.number().int().nullable(),
          isResolved: z.boolean(),
          canResolve: z.boolean(),
          canUnresolve: z.boolean(),
          comments: z.array(
            z
              .object({
                id: z.string(),
                body: z.string(),
                author: z.string().nullable(),
                createdAt: z.string(),
              })
              .strict()
          ),
        })
        .strict()
    ),
    truncated: z.boolean(),
  })
  .strict()
export const GitHubPrRevisionSnapshotSchema = z
  .object({
    baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    headRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    mergeBaseRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    commits: z.array(
      z
        .object({
          sha: z.string().regex(/^[a-f0-9]{40,64}$/iu),
          parentSha: z
            .string()
            .regex(/^[a-f0-9]{40,64}$/iu)
            .nullable(),
          title: z.string(),
        })
        .strict()
    ),
  })
  .strict()
export const GitHubPrRevisionFileSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("success"), baseContent: z.string(), headContent: z.string() })
    .strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
])
export const GitHubPrMetadataSchema = z
  .object({
    additions: z.number().int().nonnegative().nullable(),
    deletions: z.number().int().nonnegative().nullable(),
    changedFiles: z.number().int().nonnegative().nullable(),
    headRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    authorAvatarUrl: z.url().nullable(),
    authorLogin: z.string().nullable(),
    createdAt: z.string().nullable(),
    isAuthor: z.boolean(),
    isAutoMergeEnabled: z.boolean(),
    allowedMergeMethods: z.array(z.enum(["merge", "squash"])),
  })
  .strict()
export const GitHubPrReviewStatusSchema = z
  .object({
    reviewDecision: z.string().nullable(),
    reviewRequests: z.array(
      z.object({ type: z.enum(["user", "team"]), login: z.string() }).strict()
    ),
    reviews: z.array(
      z
        .object({
          author: z.string().nullable(),
          state: z.string(),
          submittedAt: z.string().nullable(),
        })
        .strict()
    ),
    truncated: z.boolean(),
  })
  .strict()
export const GitHubUserCandidateSchema = z
  .object({ login: z.string(), avatarUrl: z.url().nullable() })
  .strict()
export const GitHubPrStackEntrySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    isDraft: z.boolean(),
    baseBranch: z.string(),
    headBranch: z.string(),
    parentNumber: z.number().int().positive().nullable(),
  })
  .strict()
export const GitHubPrAttributesFileSchema = z
  .object({ basePath: z.string(), contents: z.string() })
  .strict()
export const GitLabMergeRequestSchema = z
  .object({
    iid: z.number().int().positive(),
    projectPath: z.string().min(1),
    title: z.string(),
    description: z.string(),
    state: z.enum(["opened", "closed", "merged", "locked"]),
    draft: z.boolean(),
    sourceBranch: z.string(),
    targetBranch: z.string(),
    webUrl: z.url(),
  })
  .strict()
export const GitLabMergeRequestNoteSchema = z
  .object({ id: z.number().int().positive(), body: z.string() })
  .strict()
export const GitLabMergeRequestDiscussionSchema = z
  .object({
    id: z.string(),
    notes: z.array(
      z
        .object({
          id: z.number().int().positive(),
          body: z.string(),
          author: z.string(),
          createdAt: z.string(),
          system: z.boolean(),
          resolved: z.boolean(),
          path: z.string().nullable(),
          line: z.number().int().nullable(),
          side: z.enum(["left", "right"]).nullable(),
        })
        .strict()
    ),
  })
  .strict()
export const GitLabReviewerSchema = z
  .object({
    userId: z.number().int().positive(),
    login: z.string(),
    avatarUrl: z.url().nullable(),
    status: z.enum(["waiting", "changes_requested", "approved"]),
    isReviewRequested: z.boolean(),
  })
  .strict()
export const GitLabReviewerCandidateSchema = GitLabReviewerSchema.pick({
  userId: true,
  login: true,
  avatarUrl: true,
}).strict()
export const GitLabMergeRequestChecksSchema = z
  .object({
    checksComplete: z.boolean(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          stage: z.string(),
          state: z.enum(["passing", "failing", "neutral", "skipped", "pending", "unknown"]),
          link: z.url(),
          startedAt: z.string().nullable(),
          completedAt: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict()

export const GitDiscoverRequestSchema = input(
  "git.discover.request",
  z.object({ cwd: path }).strict()
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
export const GitHubAvailabilityRequestSchema = input(
  "git.github-availability.request",
  z.object({ cwd: path }).strict()
)
export const GitHubAppAvailabilityRequestSchema = input(
  "git.github-app-availability.request",
  z.object({ cwd: path, threadId: ProjectThreadIdSchema }).strict()
)
export const GitHubAppPrCreateRequestSchema = input(
  "git.github-app-pr-create.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      head: z.string().min(1),
      base: z.string().min(1),
      title: z.string().min(1).max(1000),
      body: z.string().max(100_000),
      draft: z.boolean().optional(),
    })
    .strict()
)
export const GitHubAppPrListRequestSchema = input(
  "git.github-app-pr-list.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      state: z.enum(["open", "closed", "merged", "all"]).optional(),
      scope: z.enum(["all", "authored", "reviewing"]).optional(),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
)
export const GitHubAppPrReadRequestSchema = input(
  "git.github-app-pr-read.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, number: z.number().int().positive() })
    .strict()
)
export const GitHubAppPrDiffRequestSchema = input(
  "git.github-app-pr-diff.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubAppPrActivityRequestSchema = input(
  "git.github-app-pr-activity.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubAppPrChecksRequestSchema = input(
  "git.github-app-pr-checks.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubAppPrThreadsRequestSchema = input(
  "git.github-app-pr-threads.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubAppPrMediaRequestSchema = input(
  "git.github-app-pr-media.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      url: z.url(),
    })
    .strict()
)
export const GitHubPrListRequestSchema = input(
  "git.github-pr-list.request",
  z
    .object({
      cwd: path,
      state: z.enum(["open", "closed", "merged", "all"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      query: z.string().max(200).optional(),
    })
    .strict()
)
export const GitHubPrReadRequestSchema = input(
  "git.github-pr-read.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
)
export const GitHubPrForBranchRequestSchema = input(
  "git.github-pr-for-branch.request",
  z.object({ cwd: path, branch: z.string().min(1).max(500) }).strict()
)
export const GitHubPrDiffRequestSchema = input(
  "git.github-pr-diff.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrRevisionSnapshotRequestSchema = input(
  "git.github-pr-revision-snapshot.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrRevisionDiffRequestSchema = input(
  "git.github-pr-revision-diff.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      headRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrRevisionFileRequestSchema = input(
  "git.github-pr-revision-file.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      headRevision: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      basePath: path.nullable(),
      headPath: path.nullable(),
    })
    .strict()
)
export const GitHubPrMetadataRequestSchema = input(
  "git.github-pr-metadata.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrReviewStatusRequestSchema = input(
  "git.github-pr-review-status.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrUserSearchRequestSchema = input(
  "git.github-pr-user-search.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      query: z.string().max(100),
      scope: z.enum(["collaborators", "mentions"]),
    })
    .strict()
)
export const GitHubPrStackRequestSchema = input(
  "git.github-pr-stack.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrAttributesRequestSchema = input(
  "git.github-pr-attributes.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      paths: z.array(path).max(500),
    })
    .strict()
)
export const GitHubPrAutoMergeStatusRequestSchema = input(
  "git.github-pr-auto-merge-status.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
)
export const GitHubPrToggleAutoMergeRequestSchema = input(
  "git.github-pr-toggle-auto-merge.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      enabled: z.boolean(),
      method: z.enum(["merge", "squash"]),
    })
    .strict()
)
export const GitHubPrChecksRequestSchema = input(
  "git.github-pr-checks.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
)
export const GitHubPrActivityRequestSchema = input(
  "git.github-pr-activity.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
)
export const GitHubPrThreadsRequestSchema = input(
  "git.github-pr-threads.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
    })
    .strict()
)
export const GitHubPrThreadActionRequestSchema = input(
  "git.github-pr-thread-action.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      action: z.enum(["reply", "resolve", "unresolve", "inline"]),
      threadId: z.string().min(1).max(2000).optional(),
      body: z.string().max(100_000).optional(),
      path: path.optional(),
      line: z.number().int().positive().optional(),
      side: z.enum(["LEFT", "RIGHT"]).optional(),
    })
    .strict()
)
export const GitHubPrCommentRequestSchema = input(
  "git.github-pr-comment.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      body: z.string().min(1).max(100_000),
    })
    .strict()
)
export const GitHubPrCommentActionRequestSchema = input(
  "git.github-pr-comment-action.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      nodeId: z.string().min(1).max(2000),
      commentType: z.enum(["comment", "review", "review_comment"]),
      action: z.enum(["update", "delete"]),
      body: z.string().max(100_000).optional(),
    })
    .strict()
)
export const GitHubPrReviewRequestSchema = input(
  "git.github-pr-review.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      decision: z.enum(["approve", "comment", "request_changes"]),
      body: z.string().max(100_000),
    })
    .strict()
)
export const GitHubPrSetStateRequestSchema = input(
  "git.github-pr-set-state.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      action: z.enum(["close", "reopen", "ready", "draft"]),
    })
    .strict()
)
export const GitHubPrCreateRequestSchema = input(
  "git.github-pr-create.request",
  z
    .object({
      cwd: path,
      head: z.string().min(1),
      base: z.string().min(1),
      title: z.string().min(1).max(1000),
      body: z.string().max(100_000),
      draft: z.boolean().optional(),
    })
    .strict()
)
export const GitHubPrUpdateRequestSchema = input(
  "git.github-pr-update.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      title: z.string().min(1).max(1000).optional(),
      body: z.string().max(100_000).optional(),
    })
    .strict()
)
export const GitHubPrReviewerRequestSchema = input(
  "git.github-pr-reviewer.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      reviewer: z.string().min(1).max(100),
      action: z.enum(["add", "remove"]),
    })
    .strict()
)
export const GitHubPrMergeRequestSchema = input(
  "git.github-pr-merge.request",
  z
    .object({
      cwd: path,
      number: z.number().int().positive(),
      expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/iu),
      method: z.enum(["merge", "squash"]),
    })
    .strict()
)
export const GitLabMrReadRequestSchema = input(
  "git.gitlab-mr-read.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, iid: z.number().int().positive() })
    .strict()
)
export const GitLabMrAvailabilityRequestSchema = input(
  "git.gitlab-mr-availability.request",
  z.object({ cwd: path, threadId: ProjectThreadIdSchema }).strict()
)
export const GitLabMrForBranchRequestSchema = input(
  "git.gitlab-mr-for-branch.request",
  z.object({ cwd: path, threadId: ProjectThreadIdSchema, branch: z.string().min(1) }).strict()
)
export const GitLabMrChecksRequestSchema = input(
  "git.gitlab-mr-checks.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, iid: z.number().int().positive() })
    .strict()
)
export const GitLabMrDiscussionsRequestSchema = input(
  "git.gitlab-mr-discussions.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, iid: z.number().int().positive() })
    .strict()
)
export const GitLabMrReviewersRequestSchema = input(
  "git.gitlab-mr-reviewers.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, iid: z.number().int().positive() })
    .strict()
)
export const GitLabMrReviewerSearchRequestSchema = input(
  "git.gitlab-mr-reviewer-search.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      query: z.string().trim().min(1).max(100),
    })
    .strict()
)
export const GitLabMrReviewerActionRequestSchema = input(
  "git.gitlab-mr-reviewer-action.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      iid: z.number().int().positive(),
      userId: z.number().int().positive(),
      action: z.enum(["add", "remove"]),
    })
    .strict()
)
export const GitLabMrUpdateTitleRequestSchema = input(
  "git.gitlab-mr-update-title.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      iid: z.number().int().positive(),
      title: z.string().min(1).max(1000),
    })
    .strict()
)
export const GitLabMrPostCommentRequestSchema = input(
  "git.gitlab-mr-post-comment.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      iid: z.number().int().positive(),
      body: z.string().min(1).max(1_000_000),
    })
    .strict()
)
export const GitLabMrCreateRequestSchema = input(
  "git.gitlab-mr-create.request",
  z
    .object({
      cwd: path,
      threadId: ProjectThreadIdSchema,
      sourceBranch: z.string().min(1),
      targetBranch: z.string().min(1).optional(),
      title: z.string().min(1).max(1000),
      description: z.string().max(1_000_000),
      draft: z.boolean().optional(),
    })
    .strict()
)
export const GitLabMrBrowserFormRequestSchema = input(
  "git.gitlab-mr-browser-form.request",
  z
    .object({
      cwd: path,
      sourceBranch: z.string().min(1),
      title: z.string().min(1).max(1000),
      description: z.string().max(1_000_000),
    })
    .strict()
)

const success = z.object({ succeeded: z.literal(true) }).strict()
export const GitDiscoverResponseSchema = output("git.discover.response", GitRepositorySchema)
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
        status: z.enum(["applied", "stale", "conflict", "failed"]),
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
export const GitStageResponseSchema = output("git.stage.response", success)
export const GitUnstageResponseSchema = output("git.unstage.response", success)
export const GitCommitResponseSchema = output(
  "git.commit.response",
  z.object({ commit: z.string() }).strict()
)
export const GitPushResponseSchema = output(
  "git.push.response",
  z.object({ output: z.string() }).strict()
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
export const GitHubAvailabilityResponseSchema = output(
  "git.github-availability.response",
  GitHubAvailabilitySchema
)
export const GitHubAppAvailabilityResponseSchema = output(
  "git.github-app-availability.response",
  GitHubAppAvailabilitySchema
)
export const GitHubAppPrCreateResponseSchema = output(
  "git.github-app-pr-create.response",
  GitHubAppCreatedPullRequestSchema
)
export const GitHubAppPrListResponseSchema = output(
  "git.github-app-pr-list.response",
  z.object({ items: z.array(GitHubAppPullRequestSummarySchema), truncated: z.boolean() }).strict()
)
export const GitHubAppPrReadResponseSchema = output(
  "git.github-app-pr-read.response",
  GitHubAppPullRequestSchema
)
export const GitHubAppPrDiffResponseSchema = output(
  "git.github-app-pr-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitHubAppPrActivityResponseSchema = output(
  "git.github-app-pr-activity.response",
  GitHubPullRequestActivitySchema
)
export const GitHubAppPrChecksResponseSchema = output(
  "git.github-app-pr-checks.response",
  GitHubAppPrChecksSchema
)
export const GitHubAppPrThreadsResponseSchema = output(
  "git.github-app-pr-threads.response",
  GitHubPullRequestThreadsSchema
)
export const GitHubAppPrMediaResponseSchema = output(
  "git.github-app-pr-media.response",
  GitHubAppPrMediaSchema
)
export const GitHubPrListResponseSchema = output(
  "git.github-pr-list.response",
  z.array(GitHubPullRequestSchema)
)
export const GitHubPrReadResponseSchema = output(
  "git.github-pr-read.response",
  GitHubPullRequestSchema
)
export const GitHubPrForBranchResponseSchema = output(
  "git.github-pr-for-branch.response",
  GitHubPullRequestSchema.nullable()
)
export const GitHubPrDiffResponseSchema = output(
  "git.github-pr-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitHubPrRevisionSnapshotResponseSchema = output(
  "git.github-pr-revision-snapshot.response",
  GitHubPrRevisionSnapshotSchema
)
export const GitHubPrRevisionDiffResponseSchema = output(
  "git.github-pr-revision-diff.response",
  z.object({ diff: z.string() }).strict()
)
export const GitHubPrRevisionFileResponseSchema = output(
  "git.github-pr-revision-file.response",
  GitHubPrRevisionFileSchema
)
export const GitHubPrMetadataResponseSchema = output(
  "git.github-pr-metadata.response",
  GitHubPrMetadataSchema
)
export const GitHubPrReviewStatusResponseSchema = output(
  "git.github-pr-review-status.response",
  GitHubPrReviewStatusSchema
)
export const GitHubPrUserSearchResponseSchema = output(
  "git.github-pr-user-search.response",
  z.array(GitHubUserCandidateSchema)
)
export const GitHubPrStackResponseSchema = output(
  "git.github-pr-stack.response",
  z.array(GitHubPrStackEntrySchema)
)
export const GitHubPrAttributesResponseSchema = output(
  "git.github-pr-attributes.response",
  z.array(GitHubPrAttributesFileSchema)
)
export const GitHubPrAutoMergeStatusResponseSchema = output(
  "git.github-pr-auto-merge-status.response",
  z.object({ enabled: z.boolean() }).strict()
)
export const GitHubPrToggleAutoMergeResponseSchema = output(
  "git.github-pr-toggle-auto-merge.response",
  success
)
export const GitHubPrChecksResponseSchema = output(
  "git.github-pr-checks.response",
  GitHubPullRequestChecksSchema
)
export const GitHubPrActivityResponseSchema = output(
  "git.github-pr-activity.response",
  GitHubPullRequestActivitySchema
)
export const GitHubPrThreadsResponseSchema = output(
  "git.github-pr-threads.response",
  GitHubPullRequestThreadsSchema
)
export const GitHubPrThreadActionResponseSchema = output(
  "git.github-pr-thread-action.response",
  success
)
export const GitHubPrCommentResponseSchema = output("git.github-pr-comment.response", success)
export const GitHubPrCommentActionResponseSchema = output(
  "git.github-pr-comment-action.response",
  success
)
export const GitHubPrReviewResponseSchema = output("git.github-pr-review.response", success)
export const GitHubPrSetStateResponseSchema = output("git.github-pr-set-state.response", success)
export const GitHubPrCreateResponseSchema = output(
  "git.github-pr-create.response",
  GitHubPullRequestSchema
)
export const GitHubPrUpdateResponseSchema = output(
  "git.github-pr-update.response",
  GitHubPullRequestSchema
)
export const GitHubPrReviewerResponseSchema = output("git.github-pr-reviewer.response", success)
export const GitHubPrMergeResponseSchema = output(
  "git.github-pr-merge.response",
  GitHubPullRequestSchema
)
export const GitLabMrReadResponseSchema = output(
  "git.gitlab-mr-read.response",
  GitLabMergeRequestSchema
)
export const GitLabMrAvailabilityResponseSchema = output(
  "git.gitlab-mr-availability.response",
  GitLabMrAvailabilitySchema
)
export const GitLabMrForBranchResponseSchema = output(
  "git.gitlab-mr-for-branch.response",
  GitLabMergeRequestSchema.nullable()
)
export const GitLabMrChecksResponseSchema = output(
  "git.gitlab-mr-checks.response",
  GitLabMergeRequestChecksSchema
)
export const GitLabMrDiscussionsResponseSchema = output(
  "git.gitlab-mr-discussions.response",
  z.array(GitLabMergeRequestDiscussionSchema)
)
export const GitLabMrReviewersResponseSchema = output(
  "git.gitlab-mr-reviewers.response",
  z.array(GitLabReviewerSchema)
)
export const GitLabMrReviewerSearchResponseSchema = output(
  "git.gitlab-mr-reviewer-search.response",
  z.array(GitLabReviewerCandidateSchema)
)
export const GitLabMrReviewerActionResponseSchema = output(
  "git.gitlab-mr-reviewer-action.response",
  z.array(GitLabReviewerSchema)
)
export const GitLabMrUpdateTitleResponseSchema = output(
  "git.gitlab-mr-update-title.response",
  GitLabMergeRequestSchema
)
export const GitLabMrPostCommentResponseSchema = output(
  "git.gitlab-mr-post-comment.response",
  GitLabMergeRequestNoteSchema
)
export const GitLabMrCreateResponseSchema = output(
  "git.gitlab-mr-create.response",
  GitLabMergeRequestSchema
)
export const GitLabMrBrowserFormResponseSchema = output(
  "git.gitlab-mr-browser-form.response",
  z.object({ url: z.url() }).strict()
)

export const GIT_CLIENT_SCHEMAS = [
  GitDiscoverRequestSchema,
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
  GitStageRequestSchema,
  GitUnstageRequestSchema,
  GitCommitRequestSchema,
  GitPushRequestSchema,
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
  GitHubAvailabilityRequestSchema,
  GitHubAppAvailabilityRequestSchema,
  GitHubAppPrCreateRequestSchema,
  GitHubAppPrListRequestSchema,
  GitHubAppPrReadRequestSchema,
  GitHubAppPrDiffRequestSchema,
  GitHubAppPrActivityRequestSchema,
  GitHubAppPrChecksRequestSchema,
  GitHubAppPrThreadsRequestSchema,
  GitHubAppPrMediaRequestSchema,
  GitHubPrListRequestSchema,
  GitHubPrReadRequestSchema,
  GitHubPrForBranchRequestSchema,
  GitHubPrDiffRequestSchema,
  GitHubPrRevisionSnapshotRequestSchema,
  GitHubPrRevisionDiffRequestSchema,
  GitHubPrRevisionFileRequestSchema,
  GitHubPrMetadataRequestSchema,
  GitHubPrReviewStatusRequestSchema,
  GitHubPrUserSearchRequestSchema,
  GitHubPrStackRequestSchema,
  GitHubPrAttributesRequestSchema,
  GitHubPrAutoMergeStatusRequestSchema,
  GitHubPrToggleAutoMergeRequestSchema,
  GitHubPrChecksRequestSchema,
  GitHubPrActivityRequestSchema,
  GitHubPrThreadsRequestSchema,
  GitHubPrThreadActionRequestSchema,
  GitHubPrCommentRequestSchema,
  GitHubPrCommentActionRequestSchema,
  GitHubPrReviewRequestSchema,
  GitHubPrSetStateRequestSchema,
  GitHubPrCreateRequestSchema,
  GitHubPrUpdateRequestSchema,
  GitHubPrReviewerRequestSchema,
  GitHubPrMergeRequestSchema,
  GitLabMrReadRequestSchema,
  GitLabMrAvailabilityRequestSchema,
  GitLabMrForBranchRequestSchema,
  GitLabMrChecksRequestSchema,
  GitLabMrDiscussionsRequestSchema,
  GitLabMrReviewersRequestSchema,
  GitLabMrReviewerSearchRequestSchema,
  GitLabMrReviewerActionRequestSchema,
  GitLabMrUpdateTitleRequestSchema,
  GitLabMrPostCommentRequestSchema,
  GitLabMrCreateRequestSchema,
  GitLabMrBrowserFormRequestSchema,
] as const
export const GIT_SERVER_SCHEMAS = [
  GitDiscoverResponseSchema,
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
  GitStageResponseSchema,
  GitUnstageResponseSchema,
  GitCommitResponseSchema,
  GitPushResponseSchema,
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
  GitHubAvailabilityResponseSchema,
  GitHubAppAvailabilityResponseSchema,
  GitHubAppPrCreateResponseSchema,
  GitHubAppPrListResponseSchema,
  GitHubAppPrReadResponseSchema,
  GitHubAppPrDiffResponseSchema,
  GitHubAppPrActivityResponseSchema,
  GitHubAppPrChecksResponseSchema,
  GitHubAppPrThreadsResponseSchema,
  GitHubAppPrMediaResponseSchema,
  GitHubPrListResponseSchema,
  GitHubPrReadResponseSchema,
  GitHubPrForBranchResponseSchema,
  GitHubPrDiffResponseSchema,
  GitHubPrRevisionSnapshotResponseSchema,
  GitHubPrRevisionDiffResponseSchema,
  GitHubPrRevisionFileResponseSchema,
  GitHubPrMetadataResponseSchema,
  GitHubPrReviewStatusResponseSchema,
  GitHubPrUserSearchResponseSchema,
  GitHubPrStackResponseSchema,
  GitHubPrAttributesResponseSchema,
  GitHubPrAutoMergeStatusResponseSchema,
  GitHubPrToggleAutoMergeResponseSchema,
  GitHubPrChecksResponseSchema,
  GitHubPrActivityResponseSchema,
  GitHubPrThreadsResponseSchema,
  GitHubPrThreadActionResponseSchema,
  GitHubPrCommentResponseSchema,
  GitHubPrCommentActionResponseSchema,
  GitHubPrReviewResponseSchema,
  GitHubPrSetStateResponseSchema,
  GitHubPrCreateResponseSchema,
  GitHubPrUpdateResponseSchema,
  GitHubPrReviewerResponseSchema,
  GitHubPrMergeResponseSchema,
  GitLabMrReadResponseSchema,
  GitLabMrAvailabilityResponseSchema,
  GitLabMrForBranchResponseSchema,
  GitLabMrChecksResponseSchema,
  GitLabMrDiscussionsResponseSchema,
  GitLabMrReviewersResponseSchema,
  GitLabMrReviewerSearchResponseSchema,
  GitLabMrReviewerActionResponseSchema,
  GitLabMrUpdateTitleResponseSchema,
  GitLabMrPostCommentResponseSchema,
  GitLabMrCreateResponseSchema,
  GitLabMrBrowserFormResponseSchema,
] as const
export const GIT_RESPONSE_TYPES = GIT_SERVER_SCHEMAS.map((schema) => schema.shape.type.value)
export const GitClientMessageSchema = z.discriminatedUnion("type", GIT_CLIENT_SCHEMAS)
export type GitClientMessage = z.infer<(typeof GIT_CLIENT_SCHEMAS)[number]>
export type GitServerMessage = z.infer<(typeof GIT_SERVER_SCHEMAS)[number]>
export type GitRepository = z.infer<typeof GitRepositorySchema>
export type GitOrigin = z.infer<typeof GitOriginSchema>
export type GitStatus = z.infer<typeof GitStatusSchema>
export type GitBranch = z.infer<typeof GitBranchSchema>
export type GitBranchSearchResult = z.infer<typeof GitBranchSearchResultSchema>
export type GitBranchReview = z.infer<typeof GitBranchReviewSchema>
export type GitCommitSummary = z.infer<typeof GitCommitSummarySchema>
export type GitReviewFile = z.infer<typeof GitReviewFileSchema>
export type GitReviewLineCount = z.infer<typeof GitReviewLineCountSchema>
export type GitReviewUndoEntry = z.infer<typeof GitReviewUndoEntrySchema>
export type GitBranchContext = z.infer<typeof GitBranchContextSchema>
export type GitBranchComparison = z.infer<typeof GitBranchComparisonSchema>
export type GitCloneState = z.infer<typeof GitCloneStateSchema>
export type GitIndexEntry = z.infer<typeof GitIndexEntrySchema>
export type GitTextBlob = z.infer<typeof GitTextBlobSchema>
export type GitBlameLine = z.infer<typeof GitBlameLineSchema>
export type GitWorktree = z.infer<typeof GitWorktreeSchema>
export type GitSyncedBranchState = z.infer<typeof GitSyncedBranchStateSchema>
export type GitWorktreeJob = z.infer<typeof GitWorktreeJobSchema>
export type GitLabMrAvailability = z.infer<typeof GitLabMrAvailabilitySchema>
export type GitHubAvailability = z.infer<typeof GitHubAvailabilitySchema>
export type GitHubAppAvailability = z.infer<typeof GitHubAppAvailabilitySchema>
export type GitHubAppCreatedPullRequest = z.infer<typeof GitHubAppCreatedPullRequestSchema>
export type GitHubAppPrChecks = z.infer<typeof GitHubAppPrChecksSchema>
export type GitHubAppPrMedia = z.infer<typeof GitHubAppPrMediaSchema>
export type GitHubAppPullRequestSummary = z.infer<typeof GitHubAppPullRequestSummarySchema>
export type GitHubAppPullRequest = z.infer<typeof GitHubAppPullRequestSchema>
export type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>
export type GitHubPullRequestChecks = z.infer<typeof GitHubPullRequestChecksSchema>
export type GitHubPullRequestActivity = z.infer<typeof GitHubPullRequestActivitySchema>
export type GitHubPullRequestThreads = z.infer<typeof GitHubPullRequestThreadsSchema>
export type GitHubPrRevisionSnapshot = z.infer<typeof GitHubPrRevisionSnapshotSchema>
export type GitHubPrRevisionFile = z.infer<typeof GitHubPrRevisionFileSchema>
export type GitHubPrMetadata = z.infer<typeof GitHubPrMetadataSchema>
export type GitHubPrReviewStatus = z.infer<typeof GitHubPrReviewStatusSchema>
export type GitHubUserCandidate = z.infer<typeof GitHubUserCandidateSchema>
export type GitHubPrStackEntry = z.infer<typeof GitHubPrStackEntrySchema>
export type GitHubPrAttributesFile = z.infer<typeof GitHubPrAttributesFileSchema>
export type GitLabMergeRequest = z.infer<typeof GitLabMergeRequestSchema>
export type GitLabMergeRequestNote = z.infer<typeof GitLabMergeRequestNoteSchema>
export type GitLabMergeRequestDiscussion = z.infer<typeof GitLabMergeRequestDiscussionSchema>
export type GitLabReviewer = z.infer<typeof GitLabReviewerSchema>
export type GitLabReviewerCandidate = z.infer<typeof GitLabReviewerCandidateSchema>
export type GitLabMergeRequestChecks = z.infer<typeof GitLabMergeRequestChecksSchema>
