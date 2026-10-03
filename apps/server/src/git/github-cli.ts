import { execFile } from "node:child_process"
import { isAbsolute } from "node:path"
import { promisify } from "node:util"

import { resolveExecutable } from "./git-executor.js"

const execFileAsync = promisify(execFile)
const STATUS_TTL_MS = 60_000

export class GitHubCliError extends Error {
  /** The pull request that already exists for the branch, when GitHub says so. */
  readonly existingUrl: string | null

  constructor(message: string, existingUrl: string | null = null) {
    super(message)
    this.name = "GitHubCliError"
    this.existingUrl = existingUrl
  }
}

/** The number at the end of a GitHub pull request URL. */
export const pullRequestNumber = (url: string): number | null => {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/u.exec(url)
  const number = match ? Number(match[1]) : Number.NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/**
 * GitHub's `gh` CLI, when it is installed and signed in for a host. It creates pull requests with
 * the user's own GitHub credentials, as ChatGPT Desktop does when `gh` is available.
 */
export class GitHubCli {
  readonly #status = new Map<string, { at: number; value: Promise<boolean> }>()
  readonly #now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now
  }

  #executable(): string | null {
    const executable = resolveExecutable("gh")
    return isAbsolute(executable) ? executable : null
  }

  async #run(cwd: string, args: readonly string[], timeoutMs: number) {
    const executable = this.#executable()
    if (!executable) throw new GitHubCliError("GitHub CLI is not installed")
    return execFileAsync(executable, args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_PROMPT_DISABLED: "1",
        GH_SPINNER_DISABLED: "1",
        NO_COLOR: "1",
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    })
  }

  /** Whether `gh` is installed and signed in for a host; remembered for a minute. */
  available(host: string, cwd: string): Promise<boolean> {
    const key = host.toLowerCase()
    const cached = this.#status.get(key)
    if (cached && this.#now() - cached.at < STATUS_TTL_MS) return cached.value
    const value = this.#executable()
      ? this.#run(cwd, ["auth", "status", "--hostname", key], 10_000).then(
          () => true,
          () => false
        )
      : Promise.resolve(false)
    this.#status.set(key, { at: this.#now(), value })
    return value
  }

  async createPullRequest(
    root: string,
    input: { base: string; head: string; title: string; body: string; draft: boolean }
  ): Promise<{ url: string; number: number | null }> {
    const args = [
      "pr",
      "create",
      "--head",
      input.head,
      "--base",
      input.base,
      "--title",
      input.title,
    ]
    if (input.draft) args.push("--draft")
    args.push("--body", input.body)
    try {
      const { stdout, stderr } = await this.#run(root, args, 60_000)
      const url = /https:\/\/\S+\/pull\/\d+/u.exec(`${stdout}\n${stderr}`)?.[0]
      if (!url) throw new GitHubCliError("GitHub CLI did not report the pull request it created")
      return { number: pullRequestNumber(url), url }
    } catch (error) {
      if (error instanceof GitHubCliError) throw error
      const failure = error as Error & { stderr?: string; stdout?: string }
      const output = `${failure.stderr ?? ""}\n${failure.stdout ?? ""}`.trim()
      const existing = /already exists/iu.test(output)
        ? (/https:\/\/\S+\/pull\/\d+/u.exec(output)?.[0] ?? null)
        : null
      throw new GitHubCliError(output || failure.message, existing)
    }
  }
}
