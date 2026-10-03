import { z } from "zod"

/** The MCP App the `code-review` plugin serves. */
export const CODE_REVIEW_APP_URI = "ui://pull-requests/app"
export const CODE_REVIEW_SERVER = "code-review"

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z\d.-]+$/u)

export const GitHubConnectionSchema = z.object({
  connectorId: z.string().min(1),
  accountLinkId: z.string().min(1),
})

/** A GitHub account as Code Review names it: host, login, and its ChatGPT connection. */
export const ReviewAccountSchema = z.object({
  hostname,
  login: z.string().trim().min(1),
  connection: GitHubConnectionSchema.optional(),
})
export type ReviewAccount = z.infer<typeof ReviewAccountSchema>

/** A GitLab account: one connector link on one GitLab host. */
export const GitLabReviewAccountSchema = z.object({
  provider: z.literal("gitlab-connector"),
  hostId: z.string().min(1),
  hostname: z.string().min(1).max(253),
  connectorId: z.string().min(1),
  accountLinkId: z.string().min(1),
})
export type GitLabReviewAccount = z.infer<typeof GitLabReviewAccountSchema>

export const LocalReviewAccountSchema = z.union([
  GitLabReviewAccountSchema,
  ReviewAccountSchema.extend({ provider: z.never().optional() }),
])
export type LocalReviewAccount = z.infer<typeof LocalReviewAccountSchema>

export const isGitLabAccount = (account: LocalReviewAccount): account is GitLabReviewAccount =>
  "provider" in account && account.provider === "gitlab-connector"

/** A pull request as tools receive it. */
export const PullRequestIdentitySchema = z.object({
  hostname: z.string().trim().min(1),
  number: z.number().int().positive(),
  owner: z.string().trim().min(1),
  repository: z.string().trim().min(1),
})
export type PullRequestIdentity = z.infer<typeof PullRequestIdentitySchema>

export const ReviewPullRequestSchema = z.object({
  hostname,
  owner: z.string().regex(/^[\w.-]+$/u),
  repository: z.string().regex(/^[\w.-]+$/u),
  number: z.number().int().positive(),
})
/** GitLab projects may live in nested groups, so their owner may contain slashes. */
export const LocalReviewPullRequestSchema = ReviewPullRequestSchema.extend({
  owner: z.string().regex(/^[\w.-]+(?:\/[\w.-]+)*$/u),
})
export type LocalReviewPullRequest = z.infer<typeof LocalReviewPullRequestSchema>

/** A stable identity of an account for comparing the one a caller names with the current one. */
export const accountKey = (account: LocalReviewAccount): string =>
  isGitLabAccount(account)
    ? JSON.stringify([
        account.provider,
        account.hostId,
        account.hostname,
        account.connectorId,
        account.accountLinkId,
      ])
    : account.connection == null
      ? `${account.hostname.toLowerCase()}/${account.login.toLowerCase()}`
      : JSON.stringify([
          account.hostname.toLowerCase(),
          account.login.toLowerCase(),
          account.connection.connectorId,
          account.connection.accountLinkId,
        ])

export const pullRequestKey = (pr: {
  hostname: string
  owner: string
  repository: string
  number: number
}) =>
  `${pr.hostname.toLowerCase()}/${pr.owner.toLowerCase()}/${pr.repository.toLowerCase()}/${pr.number}`

/** The result a private review returns. */
export const ReviewFindingSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(8000),
  priority: z.number().int().min(0).max(2),
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(["left", "right"]).default("right"),
})
export const ReviewResultSchema = z.object({
  summary: z.string().min(1).max(6000),
  impact: z.object({
    level: z.enum(["low", "medium", "high"]),
    explanation: z.string().min(1).max(3000),
  }),
  findings: z.array(ReviewFindingSchema).max(50),
})
export type ReviewResult = z.infer<typeof ReviewResultSchema>

const UnanchoredFindingSchema = ReviewFindingSchema.extend({
  path: ReviewFindingSchema.shape.path.optional().catch(undefined),
  line: ReviewFindingSchema.shape.line.optional().catch(undefined),
  side: z.enum(["left", "right"]).optional().catch(undefined),
})

/** How a review that ran in a chat ended. */
export const ChatReviewOutcomeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("completed"),
    result: ReviewResultSchema.extend({ findings: z.array(UnanchoredFindingSchema).max(50) }),
  }),
  z.object({ type: z.literal("failed"), error: z.string().min(1) }),
  z.object({ type: z.literal("cancelled") }),
])
export type ChatReviewOutcome = z.infer<typeof ChatReviewOutcomeSchema>

/** The chat turn a review runs in. */
export const ChatReviewBindingSchema = z.object({
  hostId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
})
export type ChatReviewBinding = z.infer<typeof ChatReviewBindingSchema>

const revision = z.string().regex(/^[a-f\d]{40,64}$/iu)

/** A GitLab merge request the host read for a review, since GitLab reads run in the host. */
export const GitLabReviewSnapshotSchema = z.object({
  baseRevision: revision,
  baseBranch: z.string().min(1),
  headRevision: revision,
  mergeBaseRevision: revision,
  title: z.string(),
  body: z.string().nullable(),
  diff: z.string(),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type GitLabReviewSnapshot = z.infer<typeof GitLabReviewSnapshotSchema>

export const ReviewProgressSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.enum([
      "loading_pr",
      "loading_diff",
      "reviewing",
      "read_diff",
      "list_files",
      "finalizing",
    ]),
  }),
  z.object({ step: z.literal("read_file"), path: z.string().min(1).max(400) }),
])
export type ReviewProgress = z.infer<typeof ReviewProgressSchema>

/** A private review as Code Review stores and shows it. */
export const PrivateReviewSchema = z.object({
  runId: z.string(),
  pullRequest: LocalReviewPullRequestSchema,
  baseRevision: z.string(),
  baseBranch: z.string().default(""),
  headRevision: z.string(),
  policyVersion: z.number().int().default(0),
  mergeBaseRevision: z.string().nullable(),
  runsInChat: z.literal(true).optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  result: ReviewResultSchema.nullable(),
  findingResolutions: z.record(z.string(), z.boolean()).default({}),
  findingPosts: z.record(z.string(), z.boolean()).optional(),
  progress: ReviewProgressSchema.optional(),
  error: z.string().nullable(),
})
export type PrivateReview = z.infer<typeof PrivateReviewSchema>

/** Bumped when the review prompt or anchoring rules change, so older reviews read as stale. */
export const REVIEW_POLICY_VERSION = 1
