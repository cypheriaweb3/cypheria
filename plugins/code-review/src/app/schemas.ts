import { z } from "zod"

/**
 * What the `pull_requests.*` tools and the host return. Schemas validate the fields the App reads
 * and pass the rest through, since the OpenAI service may add fields over time.
 */

export const PullRequestIdentitySchema = z.object({
  hostname: z.string(),
  owner: z.string(),
  repository: z.string(),
  number: z.number().int().positive(),
})
export type PullRequestIdentity = z.infer<typeof PullRequestIdentitySchema>

export const GitHubAccountSchema = z.object({
  hostname: z.string(),
  login: z.string(),
  connection: z.object({ connectorId: z.string(), accountLinkId: z.string() }).optional(),
})
export type GitHubAccount = z.infer<typeof GitHubAccountSchema>

export const GitLabAccountSchema = z.object({
  provider: z.literal("gitlab-connector"),
  hostId: z.string(),
  hostname: z.string(),
  connectorId: z.string(),
  accountLinkId: z.string(),
})
export type GitLabAccount = z.infer<typeof GitLabAccountSchema>
export type ReviewAccount = GitHubAccount | GitLabAccount

export const isGitLab = (account: ReviewAccount): account is GitLabAccount =>
  "provider" in account && account.provider === "gitlab-connector"

export const AccountResultSchema = z.object({
  currentUser: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("success"),
      account: GitHubAccountSchema.passthrough(),
      avatarUrl: z.string().nullish(),
      login: z.string().optional(),
    }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
})

export const PullRequestStateSchema = z.enum(["open", "closed", "merged"])
export type PullRequestState = z.infer<typeof PullRequestStateSchema>

export const SearchItemSchema = z
  .object({
    pullRequest: PullRequestIdentitySchema,
    title: z.string(),
    url: z.string(),
    state: PullRequestStateSchema,
    isDraft: z.boolean(),
    updatedAt: z.string(),
    createdAt: z.string().optional(),
    authorLogin: z.string().nullable().optional(),
    authorName: z.string().nullable().optional(),
    authorAvatarUrl: z.string().optional(),
    ciStatus: z.enum(["failing", "none", "passing", "pending"]).optional(),
    headBranch: z.string().optional(),
    baseBranch: z.string().optional(),
  })
  .passthrough()
export type SearchItem = z.infer<typeof SearchItemSchema>

export const SearchPageSchema = z.object({
  items: z.array(SearchItemSchema),
  endCursor: z.string().nullable().optional(),
  hasNextPage: z.boolean(),
  totalCount: z.number().optional(),
  truncated: z.boolean().optional(),
})
export type SearchPage = z.infer<typeof SearchPageSchema>

export const CheckSchema = z
  .object({
    name: z.string(),
    status: z.enum(["failing", "neutral", "passing", "pending", "skipped", "unknown"]),
    workflow: z.string().nullable(),
    completedAt: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
  })
  .passthrough()
export type Check = z.infer<typeof CheckSchema>

export const SummarySchema = z.union([
  z
    .object({
      status: z.literal("success"),
      baseBranch: z.string().nullable(),
      headBranch: z.string().nullable(),
      headRevision: z.string(),
      canMerge: z.boolean(),
      checks: z.array(CheckSchema),
      checksComplete: z.boolean(),
      ciStatus: z.enum(["failing", "none", "passing", "pending"]),
      hasOpenPr: z.boolean(),
      hasPendingChecks: z.boolean(),
      isDraft: z.boolean(),
      isInMergeQueue: z.boolean().optional(),
      mergeBlocker: z.enum(["conflicts", "unknown"]).nullable(),
      state: PullRequestStateSchema,
      title: z.string().nullable(),
      url: z.string().nullable(),
    })
    .passthrough(),
  z.object({ status: z.enum(["unavailable", "not-found", "error"]) }).passthrough(),
])
export type Summary = z.infer<typeof SummarySchema>

export const BodySchema = z
  .object({ status: z.string(), body: z.string().optional() })
  .passthrough()

export const ReactionSchema = z.object({
  content: z.string(),
  count: z.number(),
  viewerHasReacted: z.boolean(),
  emoji: z.string().optional(),
})
export type Reaction = z.infer<typeof ReactionSchema>

export const MetadataSchema = z
  .object({
    status: z.string(),
    viewerCanUpdate: z.boolean().optional(),
    hasWritePermission: z.boolean().optional(),
    canManageReviewers: z.boolean().optional(),
    reactions: z.array(ReactionSchema).optional(),
    viewerCanReact: z.boolean().optional(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    changedFiles: z.number().optional(),
    headRevision: z.string().optional(),
    createdAt: z.string().optional(),
    authorLogin: z.string().nullable().optional(),
    authorAvatarUrl: z.string().nullable().optional(),
    isAuthor: z.boolean().optional(),
    isAutoMergeEnabled: z.boolean().optional(),
    allowedMergeMethods: z.array(z.enum(["merge", "squash"])).optional(),
    mergedAt: z.string().nullable().optional(),
    mergedBy: z.string().nullable().optional(),
  })
  .passthrough()
export type Metadata = z.infer<typeof MetadataSchema>

export const ReviewsSchema = z
  .object({
    status: z.string(),
    reviewers: z
      .object({
        approved: z.array(z.string()),
        changesRequested: z.array(z.string()),
        commented: z.array(z.string()),
        requested: z.array(z.string()),
        requestedTeams: z.array(z.string()),
        requestedTeamSlugs: z.record(z.string(), z.string()).optional(),
        avatarUrlsByLogin: z.record(z.string(), z.string()).optional(),
        commentCounts: z.array(z.object({ reviewer: z.string(), commentCount: z.number() })),
      })
      .optional(),
    reviewStatus: z.enum(["approved", "changes_requested", "none", "review_required"]).optional(),
  })
  .passthrough()
export type Reviews = z.infer<typeof ReviewsSchema>

const reactionFields = {
  viewerCanReact: z.boolean().optional(),
  reactions: z.array(ReactionSchema).optional(),
}

export const CommentReplySchema = z
  .object({
    ...reactionFields,
    authorAvatarUrl: z.string().nullable().optional(),
    authorLogin: z.string().nullable(),
    body: z.string(),
    createdAt: z.string(),
    id: z.string(),
    nodeId: z.string().optional(),
    isPending: z.boolean().optional(),
    pendingReviewId: z.string().optional(),
    url: z.string().nullable(),
    viewerCanDelete: z.boolean().optional(),
    viewerCanUpdate: z.boolean().optional(),
  })
  .passthrough()
export type CommentReply = z.infer<typeof CommentReplySchema>

export const CommentSchema = z
  .object({
    ...reactionFields,
    type: z.enum(["comment", "review", "review_comment"]),
    authorAvatarUrl: z.string().nullable().optional(),
    authorLogin: z.string().nullable(),
    body: z.string(),
    createdAt: z.string(),
    id: z.string(),
    nodeId: z.string().optional(),
    diffHunk: z.string().nullable().optional(),
    isResolved: z.boolean().optional(),
    isPending: z.boolean().optional(),
    pendingReviewId: z.string().optional(),
    line: z.number().nullable().optional(),
    originalLine: z.number().nullable().optional(),
    startLine: z.number().nullable().optional(),
    path: z.string().nullable().optional(),
    side: z.enum(["left", "right"]).nullable().optional(),
    startSide: z.enum(["left", "right"]).nullable().optional(),
    replies: z.array(CommentReplySchema).optional(),
    reviewThreadId: z.string().nullable().optional(),
    url: z.string().nullable(),
    viewerCanDelete: z.boolean().optional(),
    viewerCanResolve: z.boolean().optional(),
    viewerCanUnresolve: z.boolean().optional(),
    viewerCanUpdate: z.boolean().optional(),
  })
  .passthrough()
export type Comment = z.infer<typeof CommentSchema>

export const ActivityItemSchema = z.union([
  z.object({
    type: z.literal("event"),
    actorLogin: z.string().nullable(),
    createdAt: z.string(),
    event: z.enum(["approved", "changes_requested", "merged", "opened"]),
    id: z.string(),
    url: z.string().nullable(),
  }),
  z.object({
    type: z.literal("commit_group"),
    createdAt: z.string(),
    id: z.string(),
    commits: z.array(
      z.object({
        authorLogin: z.string().nullable(),
        authorName: z.string().nullable(),
        committedDate: z.string(),
        messageHeadline: z.string(),
        oid: z.string(),
        url: z.string().nullable(),
      })
    ),
  }),
  CommentSchema,
])
export type ActivityItem = z.infer<typeof ActivityItemSchema>

export const DiscussionSchema = z
  .object({
    status: z.string(),
    activityItems: z.array(ActivityItemSchema).optional(),
    unresolvedCommentCount: z.number().optional(),
  })
  .passthrough()
export type Discussion = z.infer<typeof DiscussionSchema>

export const DiffSchema = z
  .object({
    status: z.string(),
    headRevision: z.string().optional(),
    unifiedDiff: z.string().optional(),
  })
  .passthrough()

export const StackSchema = z
  .object({
    status: z.string(),
    entries: z
      .array(
        z
          .object({
            number: z.number(),
            title: z.string(),
            isDraft: z.boolean(),
            baseBranch: z.string(),
            headBranch: z.string(),
            parentNumber: z.number().nullable().optional(),
            url: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()

export const UserSearchSchema = z.object({
  status: z.string(),
  users: z
    .array(z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() }))
    .optional(),
})

export const WriteResultSchema = z
  .object({ status: z.string(), error: z.string().optional() })
  .passthrough()

export const ReviewFindingSchema = z.object({
  title: z.string(),
  body: z.string(),
  priority: z.number(),
  path: z.string(),
  line: z.number(),
  side: z.enum(["left", "right"]).default("right"),
})
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>

export const PrivateReviewSchema = z
  .object({
    runId: z.string(),
    baseRevision: z.string(),
    baseBranch: z.string().default(""),
    headRevision: z.string(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    startedAt: z.number(),
    finishedAt: z.number().nullable(),
    result: z
      .object({
        summary: z.string(),
        impact: z.object({ level: z.enum(["low", "medium", "high"]), explanation: z.string() }),
        findings: z.array(ReviewFindingSchema),
      })
      .nullable(),
    findingResolutions: z.record(z.string(), z.boolean()).default({}),
    findingPosts: z.record(z.string(), z.boolean()).optional(),
    progress: z.object({ step: z.string(), path: z.string().optional() }).optional(),
    error: z.string().nullable(),
  })
  .passthrough()
export type PrivateReview = z.infer<typeof PrivateReviewSchema>

/** The view a tool call asked the App to open. */
export const InitialViewSchema = z.union([
  z.object({ type: z.literal("inbox"), hostname: z.string().optional() }),
  z.object({ type: z.literal("pull_request"), pullRequest: PullRequestIdentitySchema }),
  z.object({ type: z.literal("settings") }),
])
export type InitialView = z.infer<typeof InitialViewSchema>

/** A pull request URL on a GitHub or GitLab host. */
export const parsePullRequestUrl = (
  value: string,
  provider: "github" | "gitlab" = "github"
): PullRequestIdentity | null => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:") return null
    const parts = url.pathname.split("/").filter(Boolean)
    if (provider === "gitlab") {
      const marker = parts.indexOf("-")
      if (marker < 2 || parts[marker + 1] !== "merge_requests") return null
      const number = Number(parts[marker + 2])
      const path = parts.slice(0, marker)
      const repository = path.pop()
      if (!repository || !Number.isInteger(number) || number <= 0) return null
      return { hostname: url.hostname.toLowerCase(), number, owner: path.join("/"), repository }
    }
    if (parts.length < 4 || parts[2] !== "pull") return null
    const number = Number(parts[3])
    if (!Number.isInteger(number) || number <= 0) return null
    return {
      hostname: url.hostname.toLowerCase(),
      number,
      owner: parts[0] as string,
      repository: parts[1] as string,
    }
  } catch {
    return null
  }
}

export const pullRequestUrl = (
  pr: PullRequestIdentity,
  provider: "github" | "gitlab" = "github"
) =>
  provider === "gitlab"
    ? `https://${pr.hostname}/${pr.owner}/${pr.repository}/-/merge_requests/${pr.number}`
    : `https://${pr.hostname}/${pr.owner}/${pr.repository}/pull/${pr.number}`

export const pullRequestKey = (pr: PullRequestIdentity) =>
  `${pr.hostname.toLowerCase()}/${pr.owner.toLowerCase()}/${pr.repository.toLowerCase()}/${pr.number}`
