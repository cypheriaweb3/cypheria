import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  type GitHubAvailability,
  type GitHubPullRequest,
  type GitHubPullRequestActivity,
  type GitHubPullRequestChecks,
  GitHubPullRequestChecksSchema,
  GitHubPullRequestSchema,
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

  async diff(cwd: string, number: number, expectedHead: string): Promise<string> {
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    const diff = await this.#run(cwd, ["pr", "diff", String(number), "--patch"])
    await this.#assertCurrentHead(cwd, number, expectedHead, false)
    return diff
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

  async comment(cwd: string, number: number, expectedHead: string, body: string): Promise<void> {
    if (!body.trim()) throw new Error("GitHub PR comment is required")
    await this.#assertCurrentHead(cwd, number, expectedHead)
    await this.#withBodyFile(body, async (bodyFile) => {
      await this.#run(cwd, ["pr", "comment", String(number), "--body-file", bodyFile])
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
