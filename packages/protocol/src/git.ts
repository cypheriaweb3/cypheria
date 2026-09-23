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
export const GitBranchContextSchema = z
  .object({
    current: z.string().nullable(),
    upstream: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
  })
  .strict()
export const GitWorktreeSchema = z
  .object({
    path,
    head: z.string().nullable(),
    branch: z.string().nullable(),
    managed: z.boolean(),
    active: z.boolean(),
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
    repository: z.string().nullable(),
    error: z.string().nullable(),
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
  z.object({ cwd: path, message: z.string().min(1).max(100_000) }).strict()
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
export const GitWorktreeDeleteRequestSchema = input(
  "git.worktree-delete.request",
  z.object({ cwd: path, path }).strict()
)
export const GitWorktreeRestoreRequestSchema = input(
  "git.worktree-restore.request",
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
export const GitHubPrListRequestSchema = input(
  "git.github-pr-list.request",
  z
    .object({
      cwd: path,
      state: z.enum(["open", "closed", "merged", "all"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
)
export const GitHubPrReadRequestSchema = input(
  "git.github-pr-read.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
)
export const GitHubPrChecksRequestSchema = input(
  "git.github-pr-checks.request",
  z.object({ cwd: path, number: z.number().int().positive() }).strict()
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
      title: z.string().min(1).max(1000).optional(),
      body: z.string().max(100_000).optional(),
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
export const GitLabMrChecksRequestSchema = input(
  "git.gitlab-mr-checks.request",
  z
    .object({ cwd: path, threadId: ProjectThreadIdSchema, iid: z.number().int().positive() })
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
export const GitWorktreeDeleteResponseSchema = output("git.worktree-delete.response", success)
export const GitWorktreeRestoreResponseSchema = output(
  "git.worktree-restore.response",
  GitWorktreeSchema
)
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
export const GitHubPrListResponseSchema = output(
  "git.github-pr-list.response",
  z.array(GitHubPullRequestSchema)
)
export const GitHubPrReadResponseSchema = output(
  "git.github-pr-read.response",
  GitHubPullRequestSchema
)
export const GitHubPrChecksResponseSchema = output(
  "git.github-pr-checks.response",
  GitHubPullRequestChecksSchema
)
export const GitHubPrCreateResponseSchema = output(
  "git.github-pr-create.response",
  GitHubPullRequestSchema
)
export const GitHubPrUpdateResponseSchema = output(
  "git.github-pr-update.response",
  GitHubPullRequestSchema
)
export const GitHubPrMergeResponseSchema = output(
  "git.github-pr-merge.response",
  GitHubPullRequestSchema
)
export const GitLabMrReadResponseSchema = output(
  "git.gitlab-mr-read.response",
  GitLabMergeRequestSchema
)
export const GitLabMrChecksResponseSchema = output(
  "git.gitlab-mr-checks.response",
  GitLabMergeRequestChecksSchema
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
  GitInitRequestSchema,
  GitBranchCreateRequestSchema,
  GitCheckoutRequestSchema,
  GitDiffRequestSchema,
  GitBranchReviewRequestSchema,
  GitBranchReviewDiffRequestSchema,
  GitStageRequestSchema,
  GitUnstageRequestSchema,
  GitCommitRequestSchema,
  GitPushRequestSchema,
  GitWorktreesRequestSchema,
  GitWorktreeCreateRequestSchema,
  GitWorktreeDeleteRequestSchema,
  GitWorktreeRestoreRequestSchema,
  GitHubAvailabilityRequestSchema,
  GitHubAppAvailabilityRequestSchema,
  GitHubAppPrCreateRequestSchema,
  GitHubPrListRequestSchema,
  GitHubPrReadRequestSchema,
  GitHubPrChecksRequestSchema,
  GitHubPrCreateRequestSchema,
  GitHubPrUpdateRequestSchema,
  GitHubPrMergeRequestSchema,
  GitLabMrReadRequestSchema,
  GitLabMrChecksRequestSchema,
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
  GitInitResponseSchema,
  GitBranchCreateResponseSchema,
  GitCheckoutResponseSchema,
  GitDiffResponseSchema,
  GitBranchReviewResponseSchema,
  GitBranchReviewDiffResponseSchema,
  GitStageResponseSchema,
  GitUnstageResponseSchema,
  GitCommitResponseSchema,
  GitPushResponseSchema,
  GitWorktreesResponseSchema,
  GitWorktreeCreateResponseSchema,
  GitWorktreeDeleteResponseSchema,
  GitWorktreeRestoreResponseSchema,
  GitHubAvailabilityResponseSchema,
  GitHubAppAvailabilityResponseSchema,
  GitHubAppPrCreateResponseSchema,
  GitHubPrListResponseSchema,
  GitHubPrReadResponseSchema,
  GitHubPrChecksResponseSchema,
  GitHubPrCreateResponseSchema,
  GitHubPrUpdateResponseSchema,
  GitHubPrMergeResponseSchema,
  GitLabMrReadResponseSchema,
  GitLabMrChecksResponseSchema,
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
export type GitBranchContext = z.infer<typeof GitBranchContextSchema>
export type GitWorktree = z.infer<typeof GitWorktreeSchema>
export type GitHubAvailability = z.infer<typeof GitHubAvailabilitySchema>
export type GitHubAppAvailability = z.infer<typeof GitHubAppAvailabilitySchema>
export type GitHubAppCreatedPullRequest = z.infer<typeof GitHubAppCreatedPullRequestSchema>
export type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>
export type GitHubPullRequestChecks = z.infer<typeof GitHubPullRequestChecksSchema>
export type GitLabMergeRequest = z.infer<typeof GitLabMergeRequestSchema>
export type GitLabMergeRequestNote = z.infer<typeof GitLabMergeRequestNoteSchema>
export type GitLabMergeRequestChecks = z.infer<typeof GitLabMergeRequestChecksSchema>
