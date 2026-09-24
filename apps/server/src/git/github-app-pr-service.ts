import type {
  GitHubAppPrChecks,
  GitHubAppPrMedia,
  GitHubPullRequestThreads,
} from "@cypheria/protocol"
import { GitHubAppPrChecksSchema, GitHubPullRequestThreadsSchema } from "@cypheria/protocol"
import { z } from "zod"
import type { CodexAppSelection, CodexAppToolClient } from "../codex-app-tool-client.js"
import type { GitExecutor } from "./git-executor.js"

const connectorId = "connector_76869538009648d5b282a4bb21c3d157"
const repoSegment = /^[A-Za-z0-9_.-]+$/u
const repoResponse = z.object({ repository_full_name: z.string().min(3) }).passthrough()
const createdResponse = z
  .object({ number: z.number().int().positive(), url: z.url() })
  .passthrough()
const searchResponse = z
  .object({
    issues: z.array(
      z
        .object({
          issue_number: z.number().int().positive(),
          title: z.string().optional(),
          url: z.url().optional(),
          updated_at: z.string().nullable().optional(),
        })
        .passthrough()
    ),
    total_count: z.number().int().nonnegative().optional(),
  })
  .passthrough()
const infoResponse = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable().optional(),
    url: z.url().nullable().optional(),
    state: z.enum(["OPEN", "CLOSED", "MERGED", "open", "closed", "merged"]),
    merged: z.boolean(),
    draft: z.boolean(),
    head: z.string(),
    head_sha: z.string().nullish(),
    base: z.string(),
    updated_at: z.string().nullable().optional(),
    user: z.object({ login: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough()
const diffResponse = z.object({ diff: z.string().max(8 * 1024 * 1024) }).passthrough()
const mediaResponse = z.union([
  z.object({ content: z.string() }).passthrough(),
  z.object({ contentsBase64: z.string(), mimeType: z.string() }).passthrough(),
  z.object({ contents_base64: z.string(), mime_type: z.string() }).passthrough(),
  z.object({ content_base64: z.string(), mime_type: z.string() }).passthrough(),
])
const imageMime = (bytes: Buffer): GitHubAppPrMedia["mimeType"] | null => {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png"
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg"
  if (
    bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
    bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  )
    return "image/gif"
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp"
  return null
}
const threadsResponse = z
  .object({
    review_threads: z
      .array(
        z
          .object({
            id: z.string(),
            path: z.string(),
            line: z.number().int().nullable().optional(),
            is_resolved: z.boolean(),
            viewer_can_resolve: z.boolean().optional(),
            viewer_can_unresolve: z.boolean().optional(),
            comments: z
              .array(
                z
                  .object({
                    id: z.union([z.string(), z.number().int()]),
                    body: z.string(),
                    created_at: z.string(),
                    author: z.object({ login: z.string() }).nullable().optional(),
                  })
                  .passthrough()
              )
              .max(500),
          })
          .passthrough()
      )
      .max(500),
  })
  .passthrough()
const commentsResponse = z
  .object({
    comments: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number().int()]),
            body: z.string().nullable().optional(),
            created_at: z.string(),
            user: z.object({ login: z.string() }).nullable().optional(),
          })
          .passthrough()
      )
      .max(500),
  })
  .passthrough()
const reviewsResponse = z
  .object({
    reviews: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number().int()]),
            body: z.string().nullable().optional(),
            state: z.string(),
            submitted_at: z.string().nullable().optional(),
            author: z.object({ login: z.string() }).nullable().optional(),
          })
          .passthrough()
      )
      .max(500),
  })
  .passthrough()
const checksResponse = z
  .object({
    viewer_login: z.string().nullable(),
    results: z
      .array(
        z
          .object({
            status: z.enum(["success", "not_found", "error"]),
            pr_number: z.number().int().positive(),
            repository_full_name: z.string(),
            checks_complete: z.boolean().optional(),
            pull_request: z
              .object({
                number: z.number().int().positive(),
                headRefOid: z.string(),
                url: z.url(),
              })
              .passthrough()
              .optional(),
            checks: z
              .array(
                z.discriminatedUnion("__typename", [
                  z
                    .object({
                      __typename: z.literal("CheckRun"),
                      name: z.string(),
                      status: z.string(),
                      conclusion: z.string().nullable(),
                      detailsUrl: z.string().nullable(),
                      startedAt: z.string().nullable(),
                      completedAt: z.string().nullable(),
                      checkSuite: z
                        .object({
                          workflowRun: z
                            .object({ workflow: z.object({ name: z.string() }).nullable() })
                            .nullable(),
                        })
                        .nullable()
                        .optional(),
                    })
                    .passthrough(),
                  z
                    .object({
                      __typename: z.literal("StatusContext"),
                      context: z.string(),
                      state: z.string(),
                      targetUrl: z.string().nullable(),
                      createdAt: z.string().nullable().optional(),
                    })
                    .passthrough(),
                ])
              )
              .max(500)
              .optional(),
          })
          .passthrough()
      )
      .length(1),
  })
  .passthrough()
const checkBucket = (state: string): "pass" | "fail" | "pending" | "skipping" | "cancel" => {
  switch (state.toLowerCase()) {
    case "success":
      return "pass"
    case "neutral":
    case "skipped":
      return "skipping"
    case "cancelled":
      return "cancel"
    case "failure":
    case "error":
    case "timed_out":
    case "action_required":
      return "fail"
    default:
      return "pending"
  }
}
const safeCheckUrl = (value: string | null | undefined): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? value : null
  } catch {
    return null
  }
}

const checkedPrUrl = (repository: string, number: number, value?: string | null): string => {
  const result = value ?? `https://github.com/${repository}/pull/${number}`
  const url = new URL(result)
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !== `/${repository}/pull/${number}`.toLowerCase()
  ) {
    throw new Error("The GitHub app returned a pull request from another repository")
  }
  return result
}

const repositoryFromRemote = (remote: string): string => {
  const value = remote.trim()
  const scp = /^git@github\.com:(.+)$/u.exec(value)
  let path: string
  if (scp) {
    path = scp[1] ?? ""
  } else {
    const url = new URL(value)
    if (
      (url.protocol !== "https:" && url.protocol !== "ssh:") ||
      url.hostname !== "github.com" ||
      url.port ||
      (url.username && !(url.protocol === "ssh:" && url.username === "git")) ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("The repository origin is not a trusted GitHub.com URL")
    }
    path = url.pathname.replace(/^\//u, "")
  }
  path = path.replace(/\.git$/u, "")
  const parts = path.split("/")
  if (
    parts.length !== 2 ||
    parts.some((part) => !repoSegment.test(part) || part === "." || part === "..")
  ) {
    throw new Error("The repository origin has an invalid GitHub repository path")
  }
  return parts.join("/")
}

export type GitHubAppAvailability = {
  available: boolean
  canRead: boolean
  repository: string | null
  error: string | null
}

export class GitHubAppPrService {
  readonly #executor: GitExecutor
  readonly #apps: CodexAppToolClient

  constructor(executor: GitExecutor, apps: CodexAppToolClient) {
    this.#executor = executor
    this.#apps = apps
  }

  async availability(root: string, nativeThreadId: string): Promise<GitHubAppAvailability> {
    const create = await this.#context(root, nativeThreadId, ["create_pull_request"]).then(
      ({ repository }) => ({ repository, error: null }),
      (error) => ({
        repository: null,
        error: error instanceof Error ? error.message : String(error),
      })
    )
    const read = await this.#context(root, nativeThreadId, ["search_prs", "get_pr_info"]).then(
      ({ repository }) => ({ repository, error: null }),
      (error) => ({
        repository: null,
        error: error instanceof Error ? error.message : String(error),
      })
    )
    return {
      available: create.repository !== null,
      canRead: read.repository !== null,
      repository: create.repository ?? read.repository,
      error: create.repository || read.repository ? null : (create.error ?? read.error),
    }
  }

  async list(
    root: string,
    nativeThreadId: string,
    options: {
      state?: "open" | "closed" | "merged" | "all"
      scope?: "all" | "authored" | "reviewing"
      query?: string
      limit?: number
    } = {}
  ): Promise<{
    items: Array<{ number: number; title: string; url: string; updatedAt: string }>
    truncated: boolean
  }> {
    const state = options.state ?? "open"
    const scope = options.scope ?? "all"
    const limit = options.limit ?? 100
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (options.query?.length ?? 0) > 200
    )
      throw new Error("Invalid GitHub pull request search")
    const { repository, selection } = await this.#context(
      root,
      nativeThreadId,
      scope === "all" ? ["search_prs"] : ["search_prs", "get_user_login"]
    )
    const login =
      scope === "all"
        ? null
        : z
            .object({ login: z.string().min(1) })
            .parse(await this.#apps.call(selection, nativeThreadId, "github", "get_user_login", {}))
            .login
    const baseQuery = [
      "is:pr",
      "archived:false",
      options.query?.trim() || "",
      login ? (scope === "authored" ? `author:${login}` : `review-requested:${login}`) : "",
    ]
      .filter(Boolean)
      .join(" ")
    const searches =
      state === "all"
        ? [
            { state: "open", query: baseQuery },
            { state: "closed", query: `${baseQuery} is:merged` },
            { state: "closed", query: `${baseQuery} -is:merged` },
          ]
        : [
            {
              state: state === "open" ? "open" : "closed",
              query:
                state === "merged"
                  ? `${baseQuery} is:merged`
                  : state === "closed"
                    ? `${baseQuery} -is:merged`
                    : baseQuery,
            },
          ]
    const pages = await Promise.all(
      searches.map(async (search) => {
        const page = searchResponse.parse(
          await this.#apps.call(selection, nativeThreadId, "github", "search_prs", {
            query: search.query,
            state: search.state,
            order: "desc",
            sort: "updated",
            topn: limit,
            repository_full_name: repository,
          })
        )
        if (page.issues.length > limit)
          throw new Error("The GitHub app returned too many pull requests")
        for (const issue of page.issues) checkedPrUrl(repository, issue.issue_number, issue.url)
        return page
      })
    )
    const issues = [
      ...new Map(
        pages.flatMap((page) => page.issues).map((issue) => [issue.issue_number, issue])
      ).values(),
    ].sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""))
    return {
      items: issues.slice(0, limit).map((issue) => ({
        number: issue.issue_number,
        title: issue.title ?? `Pull request #${issue.issue_number}`,
        url: checkedPrUrl(repository, issue.issue_number, issue.url),
        updatedAt: issue.updated_at ?? "",
      })),
      truncated:
        issues.length > limit ||
        pages.some((page) =>
          page.total_count === undefined
            ? page.issues.length === limit
            : page.total_count > page.issues.length
        ),
    }
  }

  async read(
    root: string,
    nativeThreadId: string,
    number: number
  ): Promise<{
    number: number
    title: string
    body: string
    url: string
    state: string
    isDraft: boolean
    headRefName: string
    headRefOid: string | null
    baseRefName: string
    updatedAt: string
    author: { login: string } | null
  }> {
    const { repository, selection } = await this.#context(root, nativeThreadId, ["get_pr_info"])
    const info = infoResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
        pr_number: number,
        repository_full_name: repository,
      })
    )
    if (info.number !== number) throw new Error("The selected GitHub pull request changed")
    return {
      number: info.number,
      title: info.title,
      body: info.body ?? "",
      url: checkedPrUrl(repository, number, info.url),
      state: info.merged ? "MERGED" : info.state.toUpperCase(),
      isDraft: info.draft,
      headRefName: info.head,
      headRefOid: info.head_sha ?? null,
      baseRefName: info.base,
      updatedAt: info.updated_at ?? "",
      author: info.user ? { login: info.user.login } : null,
    }
  }

  async diff(
    root: string,
    nativeThreadId: string,
    number: number,
    expectedHead: string
  ): Promise<string> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("A pinned GitHub pull request head is required")
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "get_pr_info",
      "get_pr_diff",
    ])
    const readHead = async (): Promise<string> => {
      const info = infoResponse.parse(
        await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
          pr_number: number,
          repository_full_name: repository,
        })
      )
      if (info.number !== number) throw new Error("The selected GitHub pull request changed")
      checkedPrUrl(repository, number, info.url)
      if (!info.head_sha || !/^[a-f0-9]{40,64}$/iu.test(info.head_sha))
        throw new Error("The GitHub app did not return the pull request head")
      return info.head_sha
    }
    if ((await readHead()) !== expectedHead) throw new Error("The GitHub pull request head changed")
    const { diff } = diffResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_pr_diff", {
        format: "diff",
        pr_number: number,
        repo_full_name: repository,
      })
    )
    if (diff && !diff.startsWith("diff --git "))
      throw new Error("The GitHub app returned an invalid pull request diff")
    if ((await readHead()) !== expectedHead)
      throw new Error("The GitHub pull request head changed during diff acquisition")
    return diff
  }

  async activity(
    root: string,
    nativeThreadId: string,
    number: number,
    expectedHead: string
  ): Promise<{
    comments: Array<{ id: string; body: string; author: string | null; createdAt: string }>
    reviews: Array<{
      id: string
      body: string
      author: string | null
      state: string
      submittedAt: string
    }>
  }> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("A pinned GitHub pull request head is required")
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "get_pr_info",
      "fetch_pr_comments",
      "list_pull_request_reviews",
    ])
    const readHead = async (): Promise<string> => {
      const info = infoResponse.parse(
        await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
          pr_number: number,
          repository_full_name: repository,
        })
      )
      if (info.number !== number) throw new Error("The selected GitHub pull request changed")
      checkedPrUrl(repository, number, info.url)
      if (!info.head_sha || !/^[a-f0-9]{40,64}$/iu.test(info.head_sha))
        throw new Error("The GitHub app did not return the pull request head")
      return info.head_sha
    }
    if ((await readHead()) !== expectedHead) throw new Error("The GitHub pull request head changed")
    const args = { pr_number: number, repo_full_name: repository }
    const comments = commentsResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "fetch_pr_comments", args)
    )
    const reviews = reviewsResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "list_pull_request_reviews", args)
    )
    if ((await readHead()) !== expectedHead)
      throw new Error("The GitHub pull request head changed during activity acquisition")
    return {
      comments: comments.comments.map((comment) => ({
        id: String(comment.id),
        body: comment.body ?? "",
        author: comment.user?.login ?? null,
        createdAt: comment.created_at,
      })),
      reviews: reviews.reviews.map((review) => ({
        id: String(review.id),
        body: review.body ?? "",
        author: review.author?.login ?? null,
        state: review.state,
        submittedAt: review.submitted_at ?? "",
      })),
    }
  }

  async checks(
    root: string,
    nativeThreadId: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubAppPrChecks> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("A pinned GitHub pull request head is required")
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "get_user_login",
      "get_pr_statuses",
      "get_pr_info",
    ])
    const identity = z
      .object({ login: z.string().min(1) })
      .parse(await this.#apps.call(selection, nativeThreadId, "github", "get_user_login", {}))
    const response = checksResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_pr_statuses", {
        pull_requests: [{ pr_number: number, repository_full_name: repository }],
      })
    )
    const result = response.results[0]
    if (
      !result ||
      response.viewer_login?.toLowerCase() !== identity.login.toLowerCase() ||
      result.pr_number !== number ||
      result.repository_full_name.toLowerCase() !== repository.toLowerCase() ||
      result.status !== "success" ||
      !result.pull_request ||
      result.pull_request.number !== number ||
      result.pull_request.headRefOid !== expectedHead
    )
      throw new Error("GitHub pull request checks are unavailable or stale")
    checkedPrUrl(repository, number, result.pull_request.url)
    const info = infoResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
        pr_number: number,
        repository_full_name: repository,
      })
    )
    if (info.number !== number || info.head_sha !== expectedHead)
      throw new Error("The GitHub pull request head changed during checks acquisition")
    checkedPrUrl(repository, number, info.url)
    return GitHubAppPrChecksSchema.parse({
      complete: result.checks_complete ?? false,
      checks: (result.checks ?? []).map((check) => {
        if (check.__typename === "CheckRun") {
          const state = check.conclusion ?? check.status
          return {
            name: check.name,
            state,
            bucket: checkBucket(state),
            link: safeCheckUrl(check.detailsUrl),
            workflow: check.checkSuite?.workflowRun?.workflow?.name ?? null,
            startedAt: check.startedAt,
            completedAt: check.completedAt,
          }
        }
        return {
          name: check.context,
          state: check.state,
          bucket: checkBucket(check.state),
          link: safeCheckUrl(check.targetUrl),
          workflow: null,
          startedAt: check.createdAt ?? null,
          completedAt: null,
        }
      }),
    })
  }

  async threads(
    root: string,
    nativeThreadId: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPullRequestThreads> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("A pinned GitHub pull request head is required")
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "get_pr_info",
      "list_pull_request_review_threads",
    ])
    const readHead = async (): Promise<string> => {
      const info = infoResponse.parse(
        await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
          pr_number: number,
          repository_full_name: repository,
        })
      )
      if (info.number !== number) throw new Error("The selected GitHub pull request changed")
      checkedPrUrl(repository, number, info.url)
      if (!info.head_sha || !/^[a-f0-9]{40,64}$/iu.test(info.head_sha))
        throw new Error("The GitHub app did not return the pull request head")
      return info.head_sha
    }
    if ((await readHead()) !== expectedHead) throw new Error("The GitHub pull request head changed")
    const response = threadsResponse.parse(
      await this.#apps.call(
        selection,
        nativeThreadId,
        "github",
        "list_pull_request_review_threads",
        {
          pr_number: number,
          repo_full_name: repository,
        }
      )
    )
    if ((await readHead()) !== expectedHead)
      throw new Error("The GitHub pull request head changed during review thread acquisition")
    return GitHubPullRequestThreadsSchema.parse({
      threads: response.review_threads.map((thread) => ({
        id: thread.id,
        path: thread.path,
        line: thread.line ?? null,
        isResolved: thread.is_resolved,
        canResolve: thread.viewer_can_resolve ?? false,
        canUnresolve: thread.viewer_can_unresolve ?? false,
        comments: thread.comments.map((comment) => ({
          id: String(comment.id),
          body: comment.body,
          author: comment.author?.login ?? null,
          createdAt: comment.created_at,
        })),
      })),
      truncated: false,
    })
  }

  async media(
    root: string,
    nativeThreadId: string,
    number: number,
    expectedHead: string,
    source: string
  ): Promise<GitHubAppPrMedia> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("A pinned GitHub pull request head is required")
    if (source.length > 4096) throw new Error("Invalid GitHub media URL")
    const url = new URL(source)
    if (
      url.protocol !== "https:" ||
      url.hostname !== "private-user-images.githubusercontent.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname === "/"
    )
      throw new Error("Invalid GitHub media URL")
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "get_pr_info",
      "download_user_content",
    ])
    const readHead = async (): Promise<string> => {
      const info = infoResponse.parse(
        await this.#apps.call(selection, nativeThreadId, "github", "get_pr_info", {
          pr_number: number,
          repository_full_name: repository,
        })
      )
      if (info.number !== number) throw new Error("The selected GitHub pull request changed")
      checkedPrUrl(repository, number, info.url)
      if (!info.head_sha || !/^[a-f0-9]{40,64}$/iu.test(info.head_sha))
        throw new Error("The GitHub app did not return the pull request head")
      return info.head_sha
    }
    if ((await readHead()) !== expectedHead) throw new Error("The GitHub pull request head changed")
    const result = mediaResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "download_user_content", {
        url: source,
      })
    )
    const encoded =
      typeof result.content === "string"
        ? result.content
        : typeof result.contentsBase64 === "string"
          ? result.contentsBase64
          : typeof result.contents_base64 === "string"
            ? result.contents_base64
            : typeof result.content_base64 === "string"
              ? result.content_base64
              : null
    if (
      encoded === null ||
      encoded.length > 6 * 1024 * 1024 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
    )
      throw new Error("GitHub media exceeds the size limit or is invalid")
    const bytes = Buffer.from(encoded, "base64")
    if (bytes.length > 4 * 1024 * 1024 || bytes.toString("base64") !== encoded)
      throw new Error("GitHub media exceeds the size limit or is invalid")
    const mimeType = imageMime(bytes)
    if (!mimeType) throw new Error("GitHub media is not a supported image")
    if ((await readHead()) !== expectedHead)
      throw new Error("The GitHub pull request head changed during media acquisition")
    return { mimeType, contentsBase64: encoded }
  }

  async create(
    root: string,
    nativeThreadId: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<{ number: number; url: string }> {
    if (!input.title.trim()) throw new Error("GitHub pull request title is required")
    if (!input.base || input.base.startsWith("-") || /[\0\r\n]/u.test(input.base)) {
      throw new Error("Invalid GitHub base branch")
    }
    const { repository, selection } = await this.#context(root, nativeThreadId, [
      "create_pull_request",
    ])
    await this.#verifiedPushedBranch(root, input.head)
    const created = createdResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "create_pull_request", {
        repository_full_name: repository,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
        draft: input.draft ?? false,
      })
    )
    return { number: created.number, url: checkedPrUrl(repository, created.number, created.url) }
  }

  async #context(
    root: string,
    nativeThreadId: string,
    actions: readonly string[]
  ): Promise<{ repository: string; selection: CodexAppSelection }> {
    const remote = (
      await this.#executor.run(root, ["remote", "get-url", "origin"], { readOnly: true })
    ).stdout
    const repository = repositoryFromRemote(remote)
    const selection = await this.#apps.select(connectorId, "github", ["get_repo", ...actions])
    const result = repoResponse.parse(
      await this.#apps.call(selection, nativeThreadId, "github", "get_repo", {
        repository_full_name: repository,
      })
    )
    if (result.repository_full_name.toLowerCase() !== repository.toLowerCase()) {
      throw new Error("The selected GitHub account cannot access this repository")
    }
    return { repository, selection }
  }

  async #verifiedPushedBranch(root: string, branch: string): Promise<void> {
    if (!branch || branch.startsWith("-") || /[\0\r\n]/u.test(branch)) {
      throw new Error("Invalid GitHub head branch")
    }
    const current = (
      await this.#executor.run(root, ["branch", "--show-current"], { readOnly: true })
    ).stdout.trim()
    if (current !== branch) throw new Error("The selected GitHub branch is not checked out")
    const local = (
      await this.#executor.run(root, ["rev-parse", "--verify", `refs/heads/${branch}`], {
        readOnly: true,
      })
    ).stdout.trim()
    const remote = (
      await this.#executor.run(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
        readOnly: true,
      })
    ).stdout.trim()
    if (remote !== `${local}\trefs/heads/${branch}`) {
      throw new Error("Push the current branch to GitHub before creating a pull request")
    }
  }
}
