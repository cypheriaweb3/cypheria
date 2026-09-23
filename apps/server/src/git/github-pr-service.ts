import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  type GitHubAvailability,
  type GitHubPullRequest,
  GitHubPullRequestSchema,
} from "@cypheria/protocol"

const execFileAsync = promisify(execFile)
const fields =
  "number,title,body,url,state,isDraft,headRefName,headRefOid,baseRefName,updatedAt,author"
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
    limit = 30
  ): Promise<GitHubPullRequest[]> {
    const result = await this.#run(cwd, [
      "pr",
      "list",
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      fields,
    ])
    return GitHubPullRequestSchema.array().parse(JSON.parse(result))
  }

  async read(cwd: string, number: number): Promise<GitHubPullRequest> {
    const result = await this.#run(cwd, ["pr", "view", String(number), "--json", fields])
    return GitHubPullRequestSchema.parse(JSON.parse(result))
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
    input: { title?: string; body?: string }
  ): Promise<GitHubPullRequest> {
    if (input.title === undefined && input.body === undefined)
      throw new Error("No GitHub PR changes supplied")
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

  async #run(cwd: string, args: string[]): Promise<string> {
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
      const failure = error as Error & { stderr?: string }
      throw new Error(failure.stderr?.trim() || failure.message, { cause: error })
    }
  }
}
