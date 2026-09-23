import { isUtf8 } from "node:buffer"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { promisify } from "node:util"
import {
  type GitHubAvailability,
  type GitHubPrAttributesFile,
  GitHubPrAttributesFileSchema,
  type GitHubPrMetadata,
  GitHubPrMetadataSchema,
  type GitHubPrReviewStatus,
  GitHubPrReviewStatusSchema,
  type GitHubPrRevisionFile,
  GitHubPrRevisionFileSchema,
  type GitHubPrRevisionSnapshot,
  GitHubPrRevisionSnapshotSchema,
  type GitHubPrStackEntry,
  GitHubPrStackEntrySchema,
  type GitHubPullRequest,
  type GitHubPullRequestActivity,
  type GitHubPullRequestChecks,
  GitHubPullRequestChecksSchema,
  GitHubPullRequestSchema,
  type GitHubPullRequestThreads,
  GitHubPullRequestThreadsSchema,
  type GitHubUserCandidate,
  GitHubUserCandidateSchema,
} from "@cypheria/protocol"
import { z } from "zod"

const execFileAsync = promisify(execFile)
const fields =
  "number,title,body,url,state,isDraft,headRefName,headRefOid,baseRefName,updatedAt,author"
const activityResponse = z
  .object({
    comments: z.array(
      z
        .object({
          id: z.string().optional(),
          body: z.string(),
          createdAt: z.string().optional(),
          author: z.object({ login: z.string() }).nullable().optional(),
        })
        .passthrough()
    ),
    reviews: z.array(
      z
        .object({
          id: z.string().optional(),
          body: z.string(),
          state: z.string(),
          submittedAt: z.string().nullable().optional(),
          author: z.object({ login: z.string() }).nullable().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough()
const operand = (value: string, name: string): string => {
  if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value))
    throw new Error(`Invalid GitHub ${name}`)
  return value
}
const revision = (value: string): string => {
  if (!/^[a-f0-9]{40,64}$/iu.test(value)) throw new Error("Invalid GitHub revision")
  return value
}
const threadQuery = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id path line isResolved viewerCanResolve viewerCanUnresolve comments(first:100){nodes{id body createdAt author{login}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}`
const threadCommentsQuery = `query($threadId:ID!,$cursor:String!){node(id:$threadId){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{id body createdAt author{login}} pageInfo{hasNextPage endCursor}}}}}`
const threadReplyMutation = `mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id}}}`
const threadResolveMutation = `mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id}}}`
const threadUnresolveMutation = `mutation($threadId:ID!){unresolveReviewThread(input:{threadId:$threadId}){thread{id}}}`
const metadataQuery = `query($owner:String!,$repo:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$repo){mergeCommitAllowed squashMergeAllowed pullRequest(number:$number){additions deletions changedFiles headRefOid author{login avatarUrl} createdAt autoMergeRequest{enabledAt}}}}`
const reviewStatusQuery = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewDecision reviewRequests(first:100){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug}}} pageInfo{hasNextPage}} reviews(first:100,after:$cursor){nodes{author{login} state submittedAt} pageInfo{hasNextPage endCursor}}}}}`
const collaboratorQuery = `query($owner:String!,$repo:String!,$search:String!){repository(owner:$owner,name:$repo){collaborators(first:100,query:$search){edges{node{avatarUrl(size:48) login}}}}}`
const mentionQuery = `query($owner:String!,$repo:String!,$number:Int!,$search:String!){repository(owner:$owner,name:$repo){mentionableUsers(first:10,query:$search){nodes{avatarUrl(size:48) login}} pullRequest(number:$number){participants(first:100){nodes{avatarUrl(size:48) login}}}}}`
const commentMutations = {
  comment: {
    update: `mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}`,
    delete: `mutation($id:ID!){deleteIssueComment(input:{id:$id}){clientMutationId}}`,
  },
  review: {
    update: `mutation($id:ID!,$body:String!){updatePullRequestReview(input:{pullRequestReviewId:$id,body:$body}){pullRequestReview{id}}}`,
  },
  review_comment: {
    update: `mutation($id:ID!,$body:String!){updatePullRequestReviewComment(input:{pullRequestReviewCommentId:$id,body:$body}){pullRequestReviewComment{id}}}`,
    delete: `mutation($id:ID!){deletePullRequestReviewComment(input:{id:$id}){clientMutationId}}`,
  },
} as const

export class GitHubPrService {
  readonly #binary: string

  constructor(binary = "gh") {
    this.#binary = binary
  }

  async availability(cwd: string): Promise<GitHubAvailability> {
    const installed = await this.#run(cwd, ["--version"]).then(
      () => true,
      () => false
    )
    if (!installed)
      return {
        installed: false,
        authenticated: false,
        account: null,
        repository: null,
        error: "GitHub CLI is unavailable",
      }
    const account = await this.#run(cwd, ["api", "user", "--jq", ".login"]).then(
      (value) => value.trim(),
      () => null
    )
    if (!account)
      return {
        installed: true,
        authenticated: false,
        account: null,
        repository: null,
        error: "GitHub CLI account is unavailable",
      }
    const repository = await this.#run(cwd, [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]).then(
      (value) => value.trim(),
      () => null
    )
    return {
      installed: true,
      authenticated: true,
      account,
      repository,
      error: repository ? null : "GitHub CLI cannot access this repository",
    }
  }

  async list(
    cwd: string,
    state: "open" | "closed" | "merged" | "all" = "open",
    limit = 30,
    query = ""
  ): Promise<GitHubPullRequest[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid GitHub PR list limit")
    }
    if (query.length > 200 || query.includes("\0") || query.includes("\n")) {
      throw new Error("Invalid GitHub PR search query")
    }
    const result = await this.#run(cwd, [
      "pr",
      "list",
      "--state",
      state,
      "--limit",
      String(limit),
      ...(query.trim() ? ["--search", query.trim()] : []),
      "--json",
      fields,
    ])
    return GitHubPullRequestSchema.array().parse(JSON.parse(result))
  }

  async read(cwd: string, number: number): Promise<GitHubPullRequest> {
    const result = await this.#run(cwd, ["pr", "view", String(number), "--json", fields])
    return GitHubPullRequestSchema.parse(JSON.parse(result))
  }

  async forBranch(cwd: string, branch: string): Promise<GitHubPullRequest | null> {
    const head = operand(branch, "head branch")
    if (head.length > 500) throw new Error("Invalid GitHub head branch")
    const branchName = head.split(":").at(-1) ?? head
    const result = GitHubPullRequestSchema.array().parse(
      JSON.parse(
        await this.#run(cwd, [
          "pr",
          "list",
          "--head",
          branchName,
          "--author",
          "@me",
          "--state",
          "all",
          "--limit",
          "100",
          "--json",
          fields,
        ])
      )
    )
    const matching = result.filter((pr) => pr.headRefName === branchName)
    return (
      matching.find((pr) => pr.state === "OPEN") ??
      matching.find((pr) => pr.state === "MERGED") ??
      null
    )
  }

  async diff(cwd: string, number: number, expectedHead: string): Promise<string> {
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const diff = await this.#run(cwd, ["pr", "diff", String(number), "--patch"])
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return diff
  }

  async revisionSnapshot(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrRevisionSnapshot> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const { host, owner, repo } = this.#repositoryIdentity(pr.url, number)
    const details = z
      .object({
        base: z.object({ sha: z.string() }),
        head: z.object({ sha: z.string() }),
      })
      .parse(
        JSON.parse(
          await this.#run(cwd, [
            "api",
            `repos/${owner}/${repo}/pulls/${number}`,
            "--hostname",
            host,
          ])
        )
      )
    const base = revision(details.base.sha)
    const head = revision(details.head.sha)
    if (head !== expectedHead) throw new Error("GitHub PR revision changed")
    const pages = z
      .array(
        z.object({
          merge_base_commit: z.object({ sha: z.string() }),
          commits: z.array(
            z.object({
              sha: z.string(),
              parents: z.array(z.object({ sha: z.string() })),
              commit: z.object({ message: z.string() }),
            })
          ),
        })
      )
      .parse(
        JSON.parse(
          await this.#run(cwd, [
            "api",
            `repos/${owner}/${repo}/compare/${base}...${head}?per_page=100`,
            "--paginate",
            "--slurp",
            "--hostname",
            host,
          ])
        )
      )
    const first = pages[0]
    if (!first) throw new Error("GitHub returned no pull request revision snapshot")
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrRevisionSnapshotSchema.parse({
      baseRevision: base,
      headRevision: head,
      mergeBaseRevision: revision(first.merge_base_commit.sha),
      commits: pages.flatMap((page) =>
        page.commits.map((commit) => ({
          sha: revision(commit.sha),
          parentSha: commit.parents[0] ? revision(commit.parents[0].sha) : null,
          title: commit.commit.message.split("\n")[0] ?? "",
        }))
      ),
    })
  }

  async revisionDiff(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string
  ): Promise<string> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const { host, owner, repo } = this.#repositoryIdentity(pr.url, number)
    const base = revision(baseRevision)
    const head = revision(headRevision)
    const diff = await this.#run(cwd, [
      "api",
      `repos/${owner}/${repo}/compare/${base}...${head}`,
      "-H",
      "Accept: application/vnd.github.diff",
      "--hostname",
      host,
    ])
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return diff
  }

  async revisionFile(
    cwd: string,
    number: number,
    expectedHead: string,
    baseRevision: string,
    headRevision: string,
    basePath: string | null,
    headPath: string | null
  ): Promise<GitHubPrRevisionFile> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const { host, owner, repo } = this.#repositoryIdentity(pr.url, number)
    const base = revision(baseRevision)
    const head = revision(headRevision)
    const read = async (path: string | null, sha: string): Promise<string | null> => {
      if (path === null) return ""
      if (
        !path ||
        path.startsWith("/") ||
        path.split("/").includes("..") ||
        /[\0\r\n]/u.test(path) ||
        path.length > 1000
      )
        throw new Error("Invalid GitHub revision file path")
      const encoded = path.split("/").map(encodeURIComponent).join("/")
      const response = z
        .object({
          content: z.string(),
          encoding: z.string(),
          size: z.number().int().nonnegative(),
        })
        .parse(
          JSON.parse(
            await this.#run(cwd, [
              "api",
              `repos/${owner}/${repo}/contents/${encoded}?ref=${sha}`,
              "-H",
              "Accept: application/vnd.github.object+json",
              "--hostname",
              host,
            ])
          )
        )
      if (response.size > 1024 * 1024 || response.encoding !== "base64") return null
      const bytes = Buffer.from(response.content, "base64")
      if (bytes.byteLength > 1024 * 1024 || bytes.includes(0) || !isUtf8(bytes)) return null
      return bytes.toString("utf8")
    }
    const [baseContent, headContent] = await Promise.all([
      read(basePath, base),
      read(headPath, head),
    ])
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrRevisionFileSchema.parse(
      baseContent === null || headContent === null
        ? { status: "unavailable" }
        : { status: "success", baseContent, headContent }
    )
  }

  async metadata(cwd: string, number: number, expectedHead: string): Promise<GitHubPrMetadata> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const result = z
      .object({
        viewer: z.object({ login: z.string() }),
        repository: z
          .object({
            mergeCommitAllowed: z.boolean(),
            squashMergeAllowed: z.boolean(),
            pullRequest: z
              .object({
                additions: z.number().int().nonnegative().nullish(),
                deletions: z.number().int().nonnegative().nullish(),
                changedFiles: z.number().int().nonnegative().nullish(),
                headRefOid: z.string(),
                author: z.object({ login: z.string(), avatarUrl: z.url().nullable() }).nullable(),
                createdAt: z.string().nullable(),
                autoMergeRequest: z.object({ enabledAt: z.string() }).nullable(),
              })
              .nullable(),
          })
          .nullable(),
      })
      .parse(
        await this.#graphql(cwd, repository.host, metadataQuery, {
          owner: repository.owner,
          repo: repository.repo,
          number,
        })
      )
    const details = result.repository?.pullRequest
    if (!details) throw new Error("GitHub pull request metadata is unavailable")
    if (details.headRefOid !== expectedHead) throw new Error("GitHub pull request head changed")
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrMetadataSchema.parse({
      additions: details.additions ?? null,
      deletions: details.deletions ?? null,
      changedFiles: details.changedFiles ?? null,
      headRevision: revision(details.headRefOid),
      authorAvatarUrl: details.author?.avatarUrl ?? null,
      authorLogin: details.author?.login ?? null,
      createdAt: details.createdAt,
      isAuthor: details.author?.login.toLowerCase() === result.viewer.login.toLowerCase(),
      isAutoMergeEnabled: details.autoMergeRequest !== null,
      allowedMergeMethods: [
        ...(result.repository?.squashMergeAllowed ? ["squash" as const] : []),
        ...(result.repository?.mergeCommitAllowed ? ["merge" as const] : []),
      ],
    })
  }

  async reviewStatus(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPrReviewStatus> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const responseSchema = z.object({
      repository: z
        .object({
          pullRequest: z
            .object({
              reviewDecision: z.string().nullable(),
              reviewRequests: z.object({
                nodes: z.array(
                  z.object({
                    requestedReviewer: z
                      .object({
                        __typename: z.string(),
                        login: z.string().optional(),
                        slug: z.string().optional(),
                      })
                      .nullable(),
                  })
                ),
                pageInfo: z.object({ hasNextPage: z.boolean() }),
              }),
              reviews: z.object({
                nodes: z.array(
                  z.object({
                    author: z.object({ login: z.string() }).nullable(),
                    state: z.string(),
                    submittedAt: z.string().nullable(),
                  })
                ),
                pageInfo: z.object({
                  hasNextPage: z.boolean(),
                  endCursor: z.string().nullable().optional(),
                }),
              }),
            })
            .nullable(),
        })
        .nullable(),
    })
    const reviews: GitHubPrReviewStatus["reviews"] = []
    let requests: GitHubPrReviewStatus["reviewRequests"] = []
    let cursor: string | null = null
    let truncated = false
    let decision: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const result = responseSchema.parse(
        await this.#graphql(cwd, repository.host, reviewStatusQuery, {
          owner: repository.owner,
          repo: repository.repo,
          number,
          cursor,
        })
      )
      const data = result.repository?.pullRequest
      if (!data) throw new Error("GitHub pull request reviews are unavailable")
      if (page === 0) {
        decision = data.reviewDecision
        truncated = data.reviewRequests.pageInfo.hasNextPage
        requests = data.reviewRequests.nodes.flatMap<
          GitHubPrReviewStatus["reviewRequests"][number]
        >(({ requestedReviewer }) => {
          if (requestedReviewer?.__typename === "User" && requestedReviewer.login)
            return [{ type: "user" as const, login: requestedReviewer.login }]
          if (requestedReviewer?.__typename === "Team" && requestedReviewer.slug)
            return [{ type: "team" as const, login: requestedReviewer.slug }]
          return []
        })
      }
      reviews.push(
        ...data.reviews.nodes.map((review) => ({
          author: review.author?.login ?? null,
          state: review.state,
          submittedAt: review.submittedAt,
        }))
      )
      if (!data.reviews.pageInfo.hasNextPage) break
      const next = data.reviews.pageInfo.endCursor ?? null
      if (!next || next === cursor) throw new Error("GitHub reviews returned a repeated page")
      cursor = next
      if (page === 19) truncated = true
    }
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrReviewStatusSchema.parse({
      reviewDecision: decision,
      reviewRequests: requests,
      reviews,
      truncated,
    })
  }

  async userSearch(
    cwd: string,
    number: number,
    expectedHead: string,
    query: string,
    scope: "collaborators" | "mentions"
  ): Promise<GitHubUserCandidate[]> {
    if (query.length > 100 || /[\0\r\n]/u.test(query)) throw new Error("Invalid GitHub user search")
    if (scope === "collaborators" && !query.trim()) return []
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const user = z.object({ login: z.string(), avatarUrl: z.url().nullable() })
    const result = await this.#graphql(
      cwd,
      repository.host,
      scope === "collaborators" ? collaboratorQuery : mentionQuery,
      { owner: repository.owner, repo: repository.repo, number, search: query.trim() }
    )
    const users =
      scope === "collaborators"
        ? (z
            .object({
              repository: z
                .object({ collaborators: z.object({ edges: z.array(z.object({ node: user })) }) })
                .nullable(),
            })
            .parse(result)
            .repository?.collaborators.edges.map((edge) => edge.node) ?? [])
        : (() => {
            const data = z
              .object({
                repository: z
                  .object({
                    mentionableUsers: z.object({ nodes: z.array(user) }),
                    pullRequest: z
                      .object({ participants: z.object({ nodes: z.array(user) }) })
                      .nullable(),
                  })
                  .nullable(),
              })
              .parse(result).repository
            return [
              ...(data?.pullRequest?.participants.nodes ?? []).filter((candidate) =>
                candidate.login.toLowerCase().includes(query.trim().toLowerCase())
              ),
              ...(query.trim() ? (data?.mentionableUsers.nodes ?? []) : []),
            ]
          })()
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubUserCandidateSchema.array().parse([
      ...new Map(users.map((candidate) => [candidate.login.toLowerCase(), candidate])).values(),
    ])
  }

  async stack(cwd: string, number: number, expectedHead: string): Promise<GitHubPrStackEntry[]> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const branch = z.object({
      ref: z.string(),
      repo: z
        .object({ id: z.number().int(), owner: z.object({ login: z.string() }).optional() })
        .nullable(),
    })
    const stackPr = z.object({
      number: z.number().int().positive(),
      title: z.string(),
      draft: z.boolean().default(false),
      state: z.enum(["open", "closed"]),
      base: branch,
      head: branch,
      stack: z.object({ number: z.number().int().positive().optional() }).nullish(),
    })
    type StackPr = z.infer<typeof stackPr>
    const fetch = async (suffix: string): Promise<unknown> =>
      JSON.parse(
        await this.#run(cwd, [
          "api",
          `repos/${repository.owner}/${repository.repo}/${suffix}`,
          "--hostname",
          repository.host,
        ])
      )
    const current = stackPr.parse(await fetch(`pulls/${number}`))
    if (current.number !== number) throw new Error("GitHub returned the wrong pull request")
    if (current.state !== "open") return []
    const related = (child: StackPr, parent: StackPr): boolean =>
      child.number !== parent.number &&
      child.head.repo?.id === parent.base.repo?.id &&
      child.head.ref === parent.base.ref
    let entries: StackPr[]
    if (current.stack?.number) {
      entries = z
        .object({ pull_requests: z.array(stackPr).max(50) })
        .parse(await fetch(`stacks/${current.stack.number}`))
        .pull_requests.filter((item) => item.state === "open")
      if (!entries.some((item) => item.number === number))
        throw new Error("GitHub stack omitted the selected pull request")
    } else {
      entries = [current]
      const seen = new Set([number])
      for (let index = 0; index < entries.length; index += 1) {
        const item = entries[index]
        if (!item) break
        const candidates = await Promise.all([
          item.base.repo
            ? fetch(
                `pulls?state=open&per_page=51&head=${encodeURIComponent(`${item.base.repo.owner?.login ?? repository.owner}:${item.base.ref}`)}`
              )
            : Promise.resolve([]),
          item.head.repo?.id === current.base.repo?.id
            ? fetch(`pulls?state=open&per_page=51&base=${encodeURIComponent(item.head.ref)}`)
            : Promise.resolve([]),
        ])
        const [parents, children] = candidates.map((candidate) =>
          z.array(stackPr).max(50).parse(candidate)
        )
        for (const candidate of [
          ...(parents ?? []).filter((entry) => related(entry, item)),
          ...(children ?? []).filter((entry) => related(item, entry)),
        ]) {
          if (seen.has(candidate.number)) continue
          if (entries.length >= 50) throw new Error("GitHub PR stack exceeds the 50-PR limit")
          seen.add(candidate.number)
          entries.push(candidate)
        }
      }
    }
    const mapped = entries.map((entry) => {
      const parents = entries.filter((candidate) => related(candidate, entry))
      if (parents.length > 1) throw new Error("Multiple GitHub PRs match a stack base branch")
      return {
        number: entry.number,
        title: entry.title,
        isDraft: entry.draft,
        baseBranch: entry.base.ref,
        headBranch: entry.head.ref,
        parentNumber: parents[0]?.number ?? null,
      }
    })
    const ordered: typeof mapped = []
    const visit = (parent: number | null) => {
      for (const entry of mapped.filter((candidate) => candidate.parentNumber === parent)) {
        if (ordered.some((item) => item.number === entry.number)) continue
        ordered.push(entry)
        visit(entry.number)
      }
    }
    visit(null)
    if (ordered.length !== mapped.length) throw new Error("GitHub PR stack contains a cycle")
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrStackEntrySchema.array().parse(ordered)
  }

  async attributes(
    cwd: string,
    number: number,
    expectedHead: string,
    paths: readonly string[]
  ): Promise<GitHubPrAttributesFile[]> {
    if (paths.length > 500) throw new Error("Too many GitHub PR paths")
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const directories = new Set<string>()
    for (const path of paths) {
      if (
        !path ||
        path.startsWith("/") ||
        path.split("/").includes("..") ||
        /[\0\r\n]/u.test(path) ||
        path.length > 1000
      )
        throw new Error("Invalid GitHub PR path")
      for (let directory = posix.dirname(path); ; directory = posix.dirname(directory)) {
        directories.add(directory)
        if (directory === ".") break
      }
    }
    const files: GitHubPrAttributesFile[] = []
    const values = [...directories]
    for (let start = 0; start < values.length; start += 50) {
      const batch = values.slice(start, start + 50)
      const fields = batch.map((directory, index) => {
        const attributePath = directory === "." ? ".gitattributes" : `${directory}/.gitattributes`
        return `f${index}:object(expression:${JSON.stringify(`${expectedHead}:${attributePath}`)}){... on Blob{text isTruncated}}`
      })
      const result = z
        .object({ repository: z.object({}).passthrough().nullable() })
        .parse(
          await this.#graphql(
            cwd,
            repository.host,
            `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){${fields.join(" ")}}}`,
            { owner: repository.owner, repo: repository.repo }
          )
        )
      if (!result.repository) throw new Error("GitHub repository is unavailable")
      for (const [index, directory] of batch.entries()) {
        const raw = result.repository[`f${index}`]
        const file = z
          .object({ text: z.string().nullable(), isTruncated: z.boolean() })
          .nullable()
          .parse(raw)
        if (file?.isTruncated) throw new Error("GitHub PR attributes were truncated")
        if (file?.text !== null && file?.text !== undefined)
          files.push({ basePath: directory === "." ? "" : directory, contents: file.text })
      }
    }
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPrAttributesFileSchema.array().parse(files)
  }

  async autoMergeEnabled(cwd: string, number: number): Promise<boolean> {
    const response: unknown = JSON.parse(
      await this.#run(cwd, ["pr", "view", String(number), "--json", "autoMergeRequest"])
    )
    const parsed = z
      .object({
        autoMergeRequest: z.object({ enabledAt: z.string() }).passthrough().nullable(),
      })
      .parse(response)
    return parsed.autoMergeRequest !== null
  }

  async toggleAutoMerge(
    cwd: string,
    number: number,
    expectedHead: string,
    enabled: boolean,
    method: "merge" | "squash"
  ): Promise<void> {
    await this.#assertCurrentHead(cwd, number, expectedHead)
    await this.#run(cwd, [
      "pr",
      "merge",
      String(number),
      ...(enabled
        ? ["--auto", `--${method}`, "--match-head-commit", expectedHead]
        : ["--disable-auto"]),
    ])
  }

  async checks(cwd: string, number: number): Promise<GitHubPullRequestChecks> {
    const result = await this.#run(
      cwd,
      [
        "pr",
        "checks",
        String(number),
        "--json",
        "bucket,completedAt,link,name,startedAt,state,workflow",
      ],
      { allowExitCodes: [1, 8] }
    )
    const checks: unknown = JSON.parse(result)
    if (!Array.isArray(checks)) throw new Error("GitHub CLI returned invalid PR checks")
    return GitHubPullRequestChecksSchema.parse(
      checks.map((check: unknown) => {
        if (typeof check !== "object" || check === null) return check
        const value = check as Record<string, unknown>
        return {
          ...value,
          link: value.link || null,
          workflow: value.workflow || null,
          startedAt: value.startedAt || null,
          completedAt: value.completedAt || null,
        }
      })
    )
  }

  async activity(cwd: string, number: number): Promise<GitHubPullRequestActivity> {
    const result = activityResponse.parse(
      JSON.parse(await this.#run(cwd, ["pr", "view", String(number), "--json", "comments,reviews"]))
    )
    return {
      comments: result.comments.map((comment, index) => ({
        id: comment.id ?? `comment-${index}`,
        body: comment.body,
        author: comment.author?.login ?? null,
        createdAt: comment.createdAt ?? "",
      })),
      reviews: result.reviews.map((review, index) => ({
        id: review.id ?? `review-${index}`,
        body: review.body,
        author: review.author?.login ?? null,
        state: review.state,
        submittedAt: review.submittedAt ?? "",
      })),
    }
  }

  async threads(
    cwd: string,
    number: number,
    expectedHead: string
  ): Promise<GitHubPullRequestThreads> {
    const pr = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, number)
    const commentConnection = z.object({
      nodes: z.array(
        z.object({
          id: z.string(),
          body: z.string(),
          createdAt: z.string(),
          author: z.object({ login: z.string() }).nullable(),
        })
      ),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() }),
    })
    const responseSchema = z.object({
      repository: z
        .object({
          pullRequest: z
            .object({
              reviewThreads: z.object({
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    path: z.string(),
                    line: z.number().int().nullable(),
                    isResolved: z.boolean(),
                    viewerCanResolve: z.boolean(),
                    viewerCanUnresolve: z.boolean(),
                    comments: commentConnection,
                  })
                ),
                pageInfo: z.object({
                  hasNextPage: z.boolean(),
                  endCursor: z.string().nullable().optional(),
                }),
              }),
            })
            .nullable(),
        })
        .nullable(),
    })
    const threads: GitHubPullRequestThreads["threads"] = []
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < 100; page += 1) {
      const response = responseSchema.parse(
        await this.#graphql(cwd, repository.host, threadQuery, {
          owner: repository.owner,
          repo: repository.repo,
          number,
          cursor,
        })
      )
      if (!response.repository?.pullRequest) throw new Error("GitHub pull request is unavailable")
      const connection = response.repository.pullRequest.reviewThreads
      for (const thread of connection.nodes) {
        const comments = [...thread.comments.nodes]
        let commentCursor = thread.comments.pageInfo.endCursor ?? null
        let hasMore = thread.comments.pageInfo.hasNextPage
        for (let commentPage = 0; hasMore && commentPage < 100; commentPage += 1) {
          if (!commentCursor) throw new Error("GitHub review comments are missing a page cursor")
          const next = z
            .object({ node: z.object({ comments: commentConnection }).nullable() })
            .parse(
              await this.#graphql(cwd, repository.host, threadCommentsQuery, {
                threadId: thread.id,
                cursor: commentCursor,
              })
            )
          if (!next.node) throw new Error("GitHub review thread is unavailable")
          comments.push(...next.node.comments.nodes)
          hasMore = next.node.comments.pageInfo.hasNextPage
          const nextCursor = next.node.comments.pageInfo.endCursor ?? null
          if (hasMore && (!nextCursor || nextCursor === commentCursor))
            throw new Error("GitHub review comments returned a repeated page")
          commentCursor = nextCursor
        }
        truncated ||= hasMore
        threads.push({
          id: thread.id,
          path: thread.path,
          line: thread.line,
          isResolved: thread.isResolved,
          canResolve: thread.viewerCanResolve,
          canUnresolve: thread.viewerCanUnresolve,
          comments: comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            author: comment.author?.login ?? null,
            createdAt: comment.createdAt,
          })),
        })
      }
      if (!connection.pageInfo.hasNextPage) break
      const nextCursor = connection.pageInfo.endCursor ?? null
      if (!nextCursor || nextCursor === cursor)
        throw new Error("GitHub review threads returned a repeated page")
      cursor = nextCursor
      if (page === 99) truncated = true
    }
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return GitHubPullRequestThreadsSchema.parse({ threads, truncated })
  }

  async threadAction(
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
    }
  ): Promise<void> {
    const pr = await this.#assertCurrentHead(cwd, input.number, input.expectedHead)
    const repository = this.#repositoryIdentity(pr.url, input.number)
    if (input.action === "inline") {
      const path = input.path
      if (
        !path ||
        path.startsWith("/") ||
        path.startsWith("-") ||
        path.split("/").includes("..") ||
        /[\0\r\n]/u.test(path) ||
        path.length > 1000
      )
        throw new Error("Invalid GitHub PR comment path")
      if (
        !input.body?.trim() ||
        input.body.length > 100_000 ||
        !Number.isInteger(input.line) ||
        (input.line ?? 0) < 1 ||
        !input.side
      )
        throw new Error("Invalid GitHub PR inline comment")
      await this.#withBodyFile(
        JSON.stringify({
          body: input.body.trim(),
          commit_id: input.expectedHead,
          path,
          line: input.line,
          side: input.side,
        }),
        async (bodyFile) => {
          await this.#run(cwd, [
            "api",
            "--method",
            "POST",
            `repos/${repository.owner}/${repository.repo}/pulls/${input.number}/comments`,
            "--input",
            bodyFile,
            "--hostname",
            repository.host,
          ])
        }
      )
      return
    }
    const threadId = input.threadId
    if (!threadId || threadId.length > 2000 || /[\0\r\n]/u.test(threadId))
      throw new Error("Invalid GitHub PR review thread")
    const threads = await this.threads(cwd, input.number, input.expectedHead)
    const thread = threads.threads.find((entry) => entry.id === threadId)
    if (!thread) throw new Error("GitHub PR review thread is unavailable")
    if (input.action === "reply") {
      if (!input.body?.trim() || input.body.length > 100_000)
        throw new Error("GitHub PR reply body is required")
      const data = z
        .object({
          addPullRequestReviewThreadReply: z.object({ comment: z.object({ id: z.string() }) }),
        })
        .parse(
          await this.#graphql(cwd, repository.host, threadReplyMutation, {
            threadId,
            body: input.body.trim(),
          })
        )
      if (!data.addPullRequestReviewThreadReply.comment.id)
        throw new Error("GitHub PR reply failed")
      return
    }
    if (input.action === "resolve" || input.action === "unresolve") {
      if (input.action === "resolve" && (thread.isResolved || !thread.canResolve))
        throw new Error("GitHub PR thread cannot be resolved")
      if (input.action === "unresolve" && (!thread.isResolved || !thread.canUnresolve))
        throw new Error("GitHub PR thread cannot be reopened")
      const field = input.action === "resolve" ? "resolveReviewThread" : "unresolveReviewThread"
      z.object({ [field]: z.object({ thread: z.object({ id: z.string() }) }) }).parse(
        await this.#graphql(
          cwd,
          repository.host,
          input.action === "resolve" ? threadResolveMutation : threadUnresolveMutation,
          { threadId }
        )
      )
      return
    }
    throw new Error("Invalid GitHub PR thread action")
  }

  async comment(cwd: string, number: number, expectedHead: string, body: string): Promise<void> {
    if (!body.trim()) throw new Error("GitHub PR comment is required")
    await this.#assertCurrentHead(cwd, number, expectedHead)
    await this.#withBodyFile(body, async (bodyFile) => {
      await this.#run(cwd, ["pr", "comment", String(number), "--body-file", bodyFile])
    })
  }

  async commentAction(
    cwd: string,
    input: {
      number: number
      expectedHead: string
      nodeId: string
      commentType: "comment" | "review" | "review_comment"
      action: "update" | "delete"
      body?: string
    }
  ): Promise<void> {
    if (!input.nodeId.trim() || input.nodeId.length > 2000 || /[\0\r\n]/u.test(input.nodeId))
      throw new Error("Invalid GitHub comment ID")
    if (input.action === "update" && (!input.body?.trim() || input.body.length > 100_000))
      throw new Error("GitHub comment body is required")
    if (input.commentType === "review" && input.action === "delete")
      throw new Error("GitHub reviews cannot be deleted here")
    const pr = await this.#assertCurrentHead(cwd, input.number, input.expectedHead, false)
    const repository = this.#repositoryIdentity(pr.url, input.number)
    const account = (
      await this.#run(cwd, ["api", "user", "--jq", ".login", "--hostname", repository.host])
    ).trim()
    if (!account) throw new Error("GitHub account is unavailable")
    const items =
      input.commentType === "review_comment"
        ? (await this.threads(cwd, input.number, input.expectedHead)).threads.flatMap(
            (thread) => thread.comments
          )
        : input.commentType === "review"
          ? (await this.activity(cwd, input.number)).reviews
          : (await this.activity(cwd, input.number)).comments
    const target = items.find((item) => item.id === input.nodeId)
    if (!target || target.author?.toLowerCase() !== account.toLowerCase())
      throw new Error("GitHub comment is unavailable for this account")
    const mutation =
      input.action === "delete"
        ? input.commentType === "comment"
          ? commentMutations.comment.delete
          : commentMutations.review_comment.delete
        : commentMutations[input.commentType].update
    await this.#assertCurrentHead(cwd, input.number, input.expectedHead, false)
    await this.#graphql(cwd, repository.host, mutation, {
      id: input.nodeId,
      ...(input.action === "update" ? { body: input.body?.trim() ?? "" } : {}),
    })
  }

  async review(
    cwd: string,
    number: number,
    expectedHead: string,
    decision: "approve" | "comment" | "request_changes",
    body: string
  ): Promise<void> {
    if (decision !== "approve" && decision !== "comment" && decision !== "request_changes") {
      throw new Error("Invalid GitHub PR review decision")
    }
    if (decision !== "approve" && !body.trim()) throw new Error("GitHub PR review body is required")
    await this.#assertCurrentHead(cwd, number, expectedHead)
    const flag =
      decision === "approve"
        ? "--approve"
        : decision === "comment"
          ? "--comment"
          : "--request-changes"
    await this.#withBodyFile(body, async (bodyFile) => {
      await this.#run(cwd, ["pr", "review", String(number), flag, "--body-file", bodyFile])
    })
  }

  async setState(
    cwd: string,
    number: number,
    expectedHead: string,
    action: "close" | "reopen" | "ready" | "draft"
  ): Promise<void> {
    const current = await this.#assertCurrentHead(cwd, number, expectedHead, false)
    if (action === "close") {
      if (current.state !== "OPEN") throw new Error("The GitHub pull request is not open")
      await this.#run(cwd, ["pr", "close", String(number)])
    } else if (action === "reopen") {
      if (current.state !== "CLOSED") throw new Error("The GitHub pull request is not closed")
      await this.#run(cwd, ["pr", "reopen", String(number)])
    } else if (action === "ready") {
      if (current.state !== "OPEN" || !current.isDraft)
        throw new Error("The GitHub pull request is not a draft")
      await this.#run(cwd, ["pr", "ready", String(number)])
    } else if (action === "draft") {
      if (current.state !== "OPEN" || current.isDraft)
        throw new Error("The GitHub pull request is not ready")
      await this.#run(cwd, ["pr", "ready", String(number), "--undo"])
    } else {
      throw new Error("Invalid GitHub pull request state action")
    }
  }

  async #assertCurrentHead(
    cwd: string,
    number: number,
    expectedHead: string,
    requireOpen = true
  ): Promise<GitHubPullRequest> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("Invalid expected GitHub PR head")
    const current = await this.read(cwd, number)
    if (requireOpen && current.state !== "OPEN")
      throw new Error("The GitHub pull request is no longer open")
    if (current.headRefOid !== expectedHead) throw new Error("The GitHub pull request head changed")
    return current
  }

  async create(
    cwd: string,
    input: { head: string; base: string; title: string; body: string; draft?: boolean }
  ): Promise<GitHubPullRequest> {
    const head = operand(input.head, "head branch")
    const base = operand(input.base, "base branch")
    const title = input.title
    if (!title.trim() || title.includes("\0")) throw new Error("Invalid GitHub PR title")
    if (!head.includes(":")) {
      const existing = GitHubPullRequestSchema.array().parse(
        JSON.parse(
          await this.#run(cwd, ["pr", "list", "--state", "open", "--head", head, "--json", fields])
        )
      )
      if (existing.length) throw new Error(`Pull request already exists for ${head}`)
    }
    const url = await this.#withBodyFile(input.body, async (bodyFile) =>
      this.#run(cwd, [
        "pr",
        "create",
        "--head",
        head,
        "--base",
        base,
        "--title",
        title,
        "--body-file",
        bodyFile,
        ...(input.draft ? ["--draft"] : []),
      ])
    )
    const match = url.trim().match(/^https:\/\/[^\s]+\/pull\/(\d+)$/u)
    if (!match) throw new Error("GitHub CLI did not return a pull request URL")
    return this.read(cwd, Number(match[1]))
  }

  async update(
    cwd: string,
    number: number,
    input: { expectedHead: string; title?: string; body?: string }
  ): Promise<GitHubPullRequest> {
    if (input.title === undefined && input.body === undefined)
      throw new Error("No GitHub PR changes supplied")
    await this.#assertCurrentHead(cwd, number, input.expectedHead)
    const args = ["pr", "edit", String(number)]
    if (input.title !== undefined) {
      if (!input.title.trim() || input.title.includes("\0"))
        throw new Error("Invalid GitHub PR title")
      args.push("--title", input.title)
    }
    if (input.body !== undefined) {
      await this.#withBodyFile(input.body, async (bodyFile) => {
        await this.#run(cwd, [...args, "--body-file", bodyFile])
      })
    } else {
      await this.#run(cwd, args)
    }
    return this.read(cwd, number)
  }

  async reviewer(
    cwd: string,
    number: number,
    expectedHead: string,
    reviewer: string,
    action: "add" | "remove"
  ): Promise<void> {
    if (
      reviewer !== "@copilot" &&
      !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9][A-Za-z0-9-]*)?$/u.test(reviewer)
    )
      throw new Error("Invalid GitHub reviewer")
    if (action !== "add" && action !== "remove") throw new Error("Invalid GitHub reviewer action")
    await this.#assertCurrentHead(cwd, number, expectedHead)
    await this.#run(cwd, [
      "pr",
      "edit",
      String(number),
      action === "add" ? "--add-reviewer" : "--remove-reviewer",
      reviewer,
    ])
  }

  async merge(
    cwd: string,
    number: number,
    expectedHead: string,
    method: "merge" | "squash"
  ): Promise<GitHubPullRequest> {
    if (!/^[a-f0-9]{40,64}$/iu.test(expectedHead))
      throw new Error("Invalid expected GitHub PR head")
    await this.#run(cwd, [
      "pr",
      "merge",
      String(number),
      `--${method}`,
      "--match-head-commit",
      expectedHead,
    ])
    return this.read(cwd, number)
  }

  #repositoryIdentity(url: string, number: number): { host: string; owner: string; repo: string } {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/u)
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !match ||
      Number(match[3]) !== number
    )
      throw new Error("GitHub pull request URL does not match the repository")
    return { host: parsed.hostname, owner: match[1] ?? "", repo: match[2] ?? "" }
  }

  async #graphql(
    cwd: string,
    host: string,
    query: string,
    variables: Record<string, string | number | null>
  ): Promise<unknown> {
    const raw = await this.#withBodyFile(JSON.stringify({ query, variables }), (bodyFile) =>
      this.#run(cwd, ["api", "graphql", "--input", bodyFile, "--hostname", host])
    )
    const response = z
      .object({
        data: z.unknown().optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .passthrough()
      .parse(JSON.parse(raw))
    if (response.errors?.length)
      throw new Error(response.errors.map((error) => error.message).join("; "))
    if (response.data == null) throw new Error("GitHub GraphQL returned no data")
    return response.data
  }

  async #withBodyFile<T>(body: string, use: (path: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-gh-pr-"))
    const path = join(directory, "body.md")
    try {
      await writeFile(path, body, { mode: 0o600 })
      return await use(path)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async #run(
    cwd: string,
    args: string[],
    options: { allowExitCodes?: readonly number[] } = {}
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.#binary, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      })
      return stdout
    } catch (error) {
      const failure = error as Error & { code?: number | string; stderr?: string; stdout?: string }
      if (
        typeof failure.code === "number" &&
        options.allowExitCodes?.includes(failure.code) &&
        failure.stdout?.trim()
      ) {
        return failure.stdout
      }
      throw new Error(failure.stderr?.trim() || failure.message, { cause: error })
    }
  }
}
