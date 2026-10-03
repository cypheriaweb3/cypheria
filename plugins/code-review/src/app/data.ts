import type { CodeReviewSettings, CodeReviewSetup } from "@cypheria/protocol/code-review-app"
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"

import { callTool, expectSuccess, ReadFailure } from "./bridge.js"
import { host } from "./host.js"
import {
  AccountResultSchema,
  type ActivityItem,
  ActivityItemSchema,
  BodySchema,
  type Check,
  CheckSchema,
  type Comment,
  CommentSchema,
  DiffSchema,
  DiscussionSchema,
  type GitHubAccount,
  isGitLab,
  type Metadata,
  MetadataSchema,
  type PrivateReview,
  PrivateReviewSchema,
  type PullRequestIdentity,
  type PullRequestState,
  pullRequestUrl,
  type Reaction,
  type ReviewAccount,
  type Reviews,
  ReviewsSchema,
  StackSchema,
  type Summary,
  SummarySchema,
  UserSearchSchema,
  WriteResultSchema,
} from "./schemas.js"

export type Provider = "github" | "gitlab"

/** The account and pull request every detail read and write names. */
export type DetailRequest = {
  readonly provider: Provider
  readonly account: ReviewAccount
  readonly pullRequest: PullRequestIdentity
}

export const requestKey = (request: DetailRequest) =>
  [
    request.provider,
    request.account.hostname,
    "login" in request.account ? request.account.login : request.account.accountLinkId,
    request.pullRequest.hostname,
    request.pullRequest.owner,
    request.pullRequest.repository,
    request.pullRequest.number,
  ] as const

/** Code Review settings and provider setup, refreshed when the host reports a change. */
export const useHostContext = () => {
  const setup = useQuery({
    queryFn: () => host.setup(),
    queryKey: ["setup"],
    staleTime: 60_000,
  })
  const settings = useQuery({
    queryFn: () => host.settings(),
    queryKey: ["settings"],
    staleTime: Number.POSITIVE_INFINITY,
  })
  return { settings, setup }
}

export const useUpdateSettings = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<CodeReviewSettings>) => host.updateSettings(patch),
    onSuccess: (settings) => client.setQueryData(["settings"], settings),
  })
}

/** The account Code Review acts for with the selected provider, once it is connected. */
export const useReviewAccount = (
  setup: CodeReviewSetup | undefined,
  settings: CodeReviewSettings | undefined
) => {
  const provider: Provider = settings?.gitHostingProvider ?? "github"
  const connection = settings?.githubConnection ?? null
  const hostname = connection?.hostname ?? "github.com"
  const github = useQuery({
    enabled:
      Boolean(setup?.chatgpt.signedIn) && provider === "github" && setup?.github.status === "ready",
    queryFn: async () =>
      AccountResultSchema.parse(
        await callTool("pull_requests.account", {
          hostname,
          ...(connection
            ? {
                connection: {
                  accountLinkId: connection.accountLinkId,
                  connectorId: connection.connectorId,
                },
              }
            : {}),
        })
      ),
    queryKey: ["account", hostname, connection?.connectorId, connection?.accountLinkId],
    staleTime: 15 * 60_000,
  })
  if (provider === "gitlab") {
    const account = setup?.gitlab.account ?? null
    return {
      account: account as ReviewAccount | null,
      avatarUrl: null as string | null,
      error: null as Error | null,
      isLoading: false,
      provider,
    }
  }
  const user = github.data?.currentUser
  return {
    account: user?.status === "success" ? (user.account as GitHubAccount) : null,
    avatarUrl: user?.status === "success" ? (user.avatarUrl ?? null) : null,
    error:
      github.error ?? (user?.status === "error" ? new ReadFailure(user.error, "access") : null),
    isLoading: github.isLoading,
    provider,
  }
}

/** One pull request, the same shape for GitHub and GitLab. */
export type PullRequestModel = {
  readonly provider: Provider
  readonly pullRequest: PullRequestIdentity
  readonly url: string
  readonly title: string
  readonly body: string | null
  readonly state: PullRequestState
  readonly isDraft: boolean
  readonly authorLogin: string | null
  readonly authorAvatarUrl: string | null
  readonly createdAt: string | null
  readonly mergedAt: string | null
  readonly mergedBy: string | null
  readonly headBranch: string | null
  readonly baseBranch: string | null
  readonly headRevision: string | null
  readonly additions: number | null
  readonly deletions: number | null
  readonly changedFiles: number | null
  readonly canMerge: boolean
  readonly mergeBlocker: "conflicts" | "unknown" | null
  readonly isAutoMergeEnabled: boolean
  readonly allowedMergeMethods: readonly ("merge" | "squash")[]
  readonly viewerCanUpdate: boolean
  readonly canManageReviewers: boolean
  readonly isAuthor: boolean
  readonly reactions: readonly Reaction[]
  readonly viewerCanReact: boolean
  readonly checks: readonly Check[]
  readonly ciStatus: "failing" | "none" | "passing" | "pending"
  readonly checksComplete: boolean
}

const githubRead =
  <T>(name: string, schema: z.ZodType<T>) =>
  async (request: DetailRequest): Promise<T> =>
    schema.parse(
      await callTool(`pull_requests.${name}`, {
        account: request.account,
        pullRequest: request.pullRequest,
      })
    )

const gitlabRead =
  <T>(operation: string, schema: z.ZodType<T>, extra: Record<string, unknown> = {}) =>
  async (request: DetailRequest): Promise<T> =>
    schema.parse(
      await host.gitlab(operation, {
        account: request.account,
        pullRequest: request.pullRequest,
        ...extra,
      })
    )

const GitLabPullRequestSchema = z
  .object({
    title: z.string(),
    body: z.string().nullable().optional(),
    state: z.enum(["open", "closed", "merged"]),
    isDraft: z.boolean(),
    isAuthor: z.boolean().nullable().optional(),
    viewerCanUpdate: z.boolean().optional(),
    author: z
      .object({ login: z.string().nullable(), avatarUrl: z.string().nullable().optional() })
      .nullable()
      .optional(),
    createdAt: z.string().nullable().optional(),
    headBranch: z.string().nullable().optional(),
    baseBranch: z.string().nullable().optional(),
    headRevision: z.string().nullable().optional(),
    additions: z.number().nullable().optional(),
    deletions: z.number().nullable().optional(),
    changedFiles: z.number().nullable().optional(),
    url: z.string().optional(),
    mergedAt: z.string().nullable().optional(),
  })
  .passthrough()

const GitLabMergeabilitySchema = z
  .object({
    status: z.string().optional(),
    canMerge: z.boolean().optional(),
    mergeBlocker: z.enum(["conflicts", "unknown"]).nullable().optional(),
    isAutoMergeEnabled: z.boolean().optional(),
  })
  .passthrough()

const GitLabChecksSchema = z
  .object({ checks: z.array(CheckSchema).optional(), ciStatus: z.string().optional() })
  .passthrough()

const summaryOf = githubRead("summary", SummarySchema)
const bodyOf = githubRead("body", BodySchema)
const metadataOf = githubRead("metadata", MetadataSchema)

/** The pull request a detail view shows, from the provider's reads. */
export const usePullRequest = (request: DetailRequest | null) =>
  useQuery({
    enabled: request != null,
    queryFn: async (): Promise<PullRequestModel> => {
      if (!request) throw new Error("No pull request")
      if (request.provider === "gitlab") {
        const [pr, mergeability, checks] = await Promise.all([
          gitlabRead("read-pull-request", GitLabPullRequestSchema)(request),
          gitlabRead("read-mergeability", GitLabMergeabilitySchema)(request).catch(() => null),
          gitlabRead("read-checks", GitLabChecksSchema)(request).catch(() => null),
        ])
        const list = checks?.checks ?? []
        return {
          additions: pr.additions ?? null,
          allowedMergeMethods: ["merge", "squash"],
          authorAvatarUrl: pr.author?.avatarUrl ?? null,
          authorLogin: pr.author?.login ?? null,
          baseBranch: pr.baseBranch ?? null,
          body: pr.body ?? null,
          canManageReviewers: pr.viewerCanUpdate ?? false,
          canMerge: mergeability?.canMerge ?? false,
          changedFiles: pr.changedFiles ?? null,
          checks: list,
          checksComplete: true,
          ciStatus: ciStatusOf(list),
          createdAt: pr.createdAt ?? null,
          deletions: pr.deletions ?? null,
          headBranch: pr.headBranch ?? null,
          headRevision: pr.headRevision ?? null,
          isAuthor: pr.isAuthor ?? false,
          isAutoMergeEnabled: mergeability?.isAutoMergeEnabled ?? false,
          isDraft: pr.isDraft,
          mergeBlocker: mergeability?.mergeBlocker ?? null,
          mergedAt: pr.mergedAt ?? null,
          mergedBy: null,
          provider: "gitlab",
          pullRequest: request.pullRequest,
          reactions: [],
          state: pr.state,
          title: pr.title,
          url: pr.url ?? pullRequestUrl(request.pullRequest, "gitlab"),
          viewerCanReact: false,
          viewerCanUpdate: pr.viewerCanUpdate ?? false,
        }
      }
      const [summary, body, metadata] = await Promise.all([
        summaryOf(request),
        bodyOf(request).catch(() => null),
        metadataOf(request).catch(() => null),
      ])
      if (summary.status !== "success") {
        throw new ReadFailure("Pull request details are unavailable", "access")
      }
      return githubModel(request.pullRequest, summary, body?.body ?? null, metadata)
    },
    queryKey: ["pull-request", ...(request ? requestKey(request) : [])],
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.state !== "open") return false
      return data.ciStatus === "pending" ? 15_000 : 60_000
    },
    retry: false,
    staleTime: 15_000,
  })

const ciStatusOf = (checks: readonly Check[]): PullRequestModel["ciStatus"] =>
  checks.length === 0
    ? "none"
    : checks.some((check) => check.status === "failing")
      ? "failing"
      : checks.some((check) => check.status === "pending")
        ? "pending"
        : "passing"

export const githubModel = (
  pullRequest: PullRequestIdentity,
  summary: Extract<Summary, { status: "success" }>,
  body: string | null,
  metadata: Metadata | null
): PullRequestModel => ({
  additions: metadata?.additions ?? null,
  allowedMergeMethods: metadata?.allowedMergeMethods ?? ["merge", "squash"],
  authorAvatarUrl: metadata?.authorAvatarUrl ?? null,
  authorLogin: metadata?.authorLogin ?? null,
  baseBranch: summary.baseBranch,
  body,
  canManageReviewers: metadata?.canManageReviewers ?? false,
  canMerge: summary.canMerge,
  changedFiles: metadata?.changedFiles ?? null,
  checks: summary.checks,
  checksComplete: summary.checksComplete,
  ciStatus: summary.ciStatus,
  createdAt: metadata?.createdAt ?? null,
  deletions: metadata?.deletions ?? null,
  headBranch: summary.headBranch,
  headRevision: summary.headRevision,
  isAuthor: metadata?.isAuthor ?? false,
  isAutoMergeEnabled: metadata?.isAutoMergeEnabled ?? false,
  isDraft: summary.isDraft,
  mergeBlocker: summary.mergeBlocker,
  mergedAt: metadata?.mergedAt ?? null,
  mergedBy: metadata?.mergedBy ?? null,
  provider: "github",
  pullRequest,
  reactions: metadata?.reactions ?? [],
  state: summary.state,
  title: summary.title ?? `#${pullRequest.number}`,
  url: summary.url ?? pullRequestUrl(pullRequest),
  viewerCanReact: metadata?.viewerCanReact ?? false,
  viewerCanUpdate: metadata?.viewerCanUpdate ?? false,
})

const GitLabDiscussionsSchema = z
  .object({
    discussions: z
      .array(
        z.object({ id: z.string(), isStandalone: z.boolean(), comments: z.array(CommentSchema) })
      )
      .optional(),
    activityItems: z.array(ActivityItemSchema).optional(),
  })
  .passthrough()

/** The pull request's activity: comments, reviews, review threads, events, and commits. */
export const useActivity = (request: DetailRequest | null) =>
  useQuery({
    enabled: request != null,
    queryFn: async (): Promise<{ items: ActivityItem[]; threads: Comment[] }> => {
      if (!request) return { items: [], threads: [] }
      if (request.provider === "gitlab") {
        const value = await gitlabRead("read-discussions", GitLabDiscussionsSchema)(request)
        if (value.activityItems) return splitActivity(value.activityItems)
        const items: ActivityItem[] = []
        const threads: Comment[] = []
        for (const discussion of value.discussions ?? []) {
          const [first, ...rest] = discussion.comments
          if (!first) continue
          const comment: Comment = {
            ...first,
            replies: rest.map((reply) => ({ ...reply })),
            reviewThreadId: discussion.isStandalone ? null : discussion.id,
          }
          if (comment.path) threads.push(comment)
          items.push(comment)
        }
        return { items, threads }
      }
      const value = expectSuccess(
        DiscussionSchema.parse(
          await callTool("pull_requests.discussion", {
            account: request.account,
            pullRequest: request.pullRequest,
          })
        )
      )
      return splitActivity(value.activityItems ?? [])
    },
    queryKey: ["activity", ...(request ? requestKey(request) : [])],
    retry: false,
    staleTime: 30_000,
  })

const splitActivity = (items: ActivityItem[]) => ({
  items,
  threads: items.filter(
    (item): item is Comment =>
      item.type === "review_comment" && typeof (item as Comment).path === "string"
  ),
})

/** The pull request's reviewers and review decision. */
export const useReviewers = (request: DetailRequest | null) =>
  useQuery({
    enabled: request != null,
    queryFn: async (): Promise<Reviews> => {
      if (!request) throw new Error("No pull request")
      if (request.provider === "gitlab") {
        return ReviewsSchema.parse({
          status: "success",
          ...(await host.gitlab<Record<string, unknown>>("read-reviewers", {
            account: request.account,
            pullRequest: request.pullRequest,
          })),
        })
      }
      return githubRead("reviews", ReviewsSchema)(request)
    },
    queryKey: ["reviewers", ...(request ? requestKey(request) : [])],
    retry: false,
    staleTime: 30_000,
  })

/** The pull request's unified diff, pinned to the head it was read at. */
export const useDiff = (request: DetailRequest | null, headRevision: string | null) =>
  useQuery({
    enabled: request != null && (request.provider === "github" || headRevision != null),
    queryFn: async () => {
      if (!request) throw new Error("No pull request")
      const value =
        request.provider === "gitlab"
          ? DiffSchema.parse(
              await host.gitlab("read-diff", {
                account: request.account,
                headRevision,
                pullRequest: request.pullRequest,
              })
            )
          : DiffSchema.parse(
              await callTool("pull_requests.diff", {
                account: request.account,
                pullRequest: request.pullRequest,
              })
            )
      expectSuccess(value)
      return { headRevision: value.headRevision ?? headRevision, patch: value.unifiedDiff ?? "" }
    },
    queryKey: ["diff", ...(request ? requestKey(request) : []), headRevision],
    retry: false,
    staleTime: 60_000,
  })

export const useStack = (request: DetailRequest | null) =>
  useQuery({
    enabled: request != null,
    queryFn: async () => {
      if (!request) throw new Error("No pull request")
      return request.provider === "gitlab"
        ? StackSchema.parse({
            status: "success",
            ...(await host.gitlab<Record<string, unknown>>("read-stack", {
              account: request.account,
              pullRequest: request.pullRequest,
            })),
          })
        : githubRead("stack", StackSchema)(request)
    },
    queryKey: ["stack", ...(request ? requestKey(request) : [])],
    retry: false,
    staleTime: 60_000,
  })

/** Users to mention or request a review from. */
export const searchUsers = async (
  request: DetailRequest,
  query: string,
  scope: "collaborators" | "mentions"
): Promise<{ login: string; avatarUrl: string | null }[]> => {
  if (request.provider === "gitlab") {
    const value = z
      .object({
        users: z
          .array(z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() }))
          .optional(),
        candidates: z
          .array(z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() }))
          .optional(),
      })
      .passthrough()
      .parse(
        await host.gitlab(
          scope === "mentions" ? "read-mention-suggestions" : "search-reviewer-candidates",
          {
            account: request.account,
            pullRequest: request.pullRequest,
            query,
          }
        )
      )
    return (value.users ?? value.candidates ?? []).map((user) => ({
      avatarUrl: user.avatarUrl ?? null,
      login: user.login,
    }))
  }
  const value = UserSearchSchema.parse(
    await callTool("pull_requests.userSearch", {
      account: request.account,
      pullRequest: request.pullRequest,
      query,
      scope,
    })
  )
  return (value.users ?? []).map((user) => ({
    avatarUrl: user.avatarUrl ?? null,
    login: user.login,
  }))
}

/** Runs a write and refreshes the reads it changes. */
export const usePullRequestWrite = (request: DetailRequest | null) => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (write: () => Promise<unknown>) => {
      const value = WriteResultSchema.safeParse(await write())
      if (value.success && value.data.status === "error") {
        throw new ReadFailure(value.data.error ?? "The update failed", "transient")
      }
    },
    onSettled: () => (request ? invalidatePullRequest(client, request) : undefined),
  })
}

export const invalidatePullRequest = async (client: QueryClient, request: DetailRequest) => {
  const key = requestKey(request)
  await Promise.allSettled(
    ["pull-request", "activity", "reviewers", "diff", "stack", "private-review"].map((root) =>
      client.invalidateQueries({ queryKey: [root, ...key] })
    )
  )
}

/** A GitHub write through the plugin's tools. */
export const githubWrite = (request: DetailRequest, tool: string, args: Record<string, unknown>) =>
  callTool(`pull_requests.${tool}`, {
    account: request.account,
    pullRequest: request.pullRequest,
    ...args,
  })

/** A GitLab write through the host. */
export const gitlabWrite = (
  request: DetailRequest,
  operation: string,
  args: Record<string, unknown>
) => host.gitlab(operation, { account: request.account, pullRequest: request.pullRequest, ...args })

/** Private reviews of the pull request by this account. */
export const usePrivateReview = (request: DetailRequest | null) =>
  useQuery({
    enabled: request != null,
    queryFn: async () => {
      if (!request) throw new Error("No pull request")
      const value = z
        .object({
          review: PrivateReviewSchema.nullable(),
          completedReviews: z.array(PrivateReviewSchema).default([]),
        })
        .parse(
          await callTool("pull_requests.localReview", {
            account: request.account,
            pullRequest: request.pullRequest,
          })
        )
      return value as { review: PrivateReview | null; completedReviews: PrivateReview[] }
    },
    queryKey: ["private-review", ...(request ? requestKey(request) : [])],
    refetchInterval: (query) => {
      const status = query.state.data?.review?.status
      return status === "queued" || status === "running" ? 2_000 : false
    },
    retry: false,
  })

export const accountKey = (account: ReviewAccount) =>
  isGitLab(account)
    ? JSON.stringify([
        account.provider,
        account.hostname,
        account.connectorId,
        account.accountLinkId,
      ])
    : JSON.stringify([
        account.hostname.toLowerCase(),
        account.login.toLowerCase(),
        account.connection?.accountLinkId,
      ])
