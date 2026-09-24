import { execFile } from "node:child_process"
import { mkdir, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

export type GitCommandResult = { stdout: string; stderr: string }

export class GitCommandError extends Error {
  readonly args: readonly string[]
  readonly stderr: string
  readonly stdout: string

  constructor(args: readonly string[], stdout: string, stderr: string, cause: unknown) {
    super(stderr.trim() || (cause instanceof Error ? cause.message : "Git command failed"))
    this.name = "GitCommandError"
    this.args = args
    this.stderr = stderr
    this.stdout = stdout
  }
}

/** The only local Git process boundary. Callers provide argv, never shell text. */
export class GitExecutor {
  readonly #hooksDir: string

  constructor(cacheDir: string) {
    this.#hooksDir = join(cacheDir, "git-empty-hooks")
  }

  async run(
    cwd: string,
    args: readonly string[],
    options: {
      readOnly?: boolean
      signal?: AbortSignal
      timeoutMs?: number
      allowExitCodes?: readonly number[]
      env?: Record<string, string>
    } = {}
  ): Promise<GitCommandResult> {
    const resolvedCwd = await realpath(cwd)
    if (!(await stat(resolvedCwd)).isDirectory())
      throw new Error("Git working directory is invalid")
    await mkdir(this.#hooksDir, { recursive: true, mode: 0o700 })
    const commandArgs = [
      "-c",
      "safe.bareRepository=explicit",
      "-c",
      `core.hooksPath=${this.#hooksDir}`,
      "-c",
      "core.pager=cat",
      ...args,
    ]
    try {
      const { stdout, stderr } = await execFileAsync("git", commandArgs, {
        cwd: resolvedCwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: options.readOnly ? "0" : "1",
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LANGUAGE: "C",
          LC_MESSAGES: "C",
          ...options.env,
        },
        maxBuffer: MAX_OUTPUT_BYTES,
        signal: options.signal,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      })
      return { stdout, stderr }
    } catch (error) {
      const failure = error as Error & { code?: number | string; stderr?: string; stdout?: string }
      if (typeof failure.code === "number" && options.allowExitCodes?.includes(failure.code)) {
        return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }
      }
      throw new GitCommandError(args, failure.stdout ?? "", failure.stderr ?? "", error)
    }
  }

  async readBlob(cwd: string, object: string, maxBytes: number): Promise<Buffer> {
    if (!/^[a-f0-9]{40,64}$/iu.test(object)) throw new Error("Invalid Git object")
    const resolvedCwd = await realpath(cwd)
    if (!(await stat(resolvedCwd)).isDirectory())
      throw new Error("Git working directory is invalid")
    await mkdir(this.#hooksDir, { recursive: true, mode: 0o700 })
    const args = [
      "-c",
      "safe.bareRepository=explicit",
      "-c",
      `core.hooksPath=${this.#hooksDir}`,
      "-c",
      "core.pager=cat",
      "cat-file",
      "blob",
      object,
    ]
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: resolvedCwd,
        encoding: "buffer",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LANGUAGE: "C",
          LC_MESSAGES: "C",
        },
        maxBuffer: maxBytes + 1024,
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      })
      return stdout
    } catch (error) {
      const failure = error as Error & { stderr?: Buffer; stdout?: Buffer }
      throw new GitCommandError(
        ["cat-file", "blob", object],
        failure.stdout?.toString("utf8") ?? "",
        failure.stderr?.toString("utf8") ?? "",
        error
      )
    }
  }
}
