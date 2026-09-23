import { realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import type { GitClientMessage, GitServerMessage } from "@cypheria/protocol"

import { GitCommandError, GitExecutor } from "./git-executor.js"

export type GitRepository = {
  readonly commonGitDir: string
  readonly root: string
}

export type GitStatus = {
  readonly branch: string | null
  readonly entries: readonly { readonly code: string; readonly path: string }[]
  readonly head: string | null
  readonly repository: GitRepository
}

const trimmed = (value: string): string => value.trimEnd()
const validateOperand = (value: string, name: string): string => {
  if (!value || value.startsWith("-") || value.includes("\0") || value.includes("\n")) {
    throw new Error(`Invalid Git ${name}`)
  }
  return value
}

export class GitService {
  readonly #executor: GitExecutor

  constructor(cacheDir: string) {
    this.#executor = new GitExecutor(cacheDir)
  }

  async handle(
    message: GitClientMessage,
    send: (message: GitServerMessage) => void
  ): Promise<boolean> {
    const type = message.type.replace(/\.request$/u, ".response") as GitServerMessage["type"]
    try {
      let value: unknown
      switch (message.type) {
        case "git.discover.request":
          value = await this.discover(message.payload.cwd)
          break
        case "git.status.request":
          value = await this.status(message.payload.cwd)
          break
        case "git.branches.request":
          value = await this.branches(message.payload.cwd)
          break
        case "git.init.request":
          value = await this.init(message.payload.cwd)
          break
        case "git.branch-create.request":
          value = {
            name: await this.createBranch(
              message.payload.cwd,
              message.payload.name,
              message.payload.startPoint
            ),
          }
          break
        case "git.checkout.request":
          value = await this.checkout(
            message.payload.cwd,
            message.payload.target,
            message.payload.stashChanges
          )
          break
        case "git.diff.request":
          value = { diff: await this.diff(message.payload.cwd, message.payload) }
          break
        case "git.stage.request":
          await this.stage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.unstage.request":
          await this.unstage(message.payload.cwd, message.payload.paths)
          value = { succeeded: true }
          break
        case "git.commit.request":
          value = { commit: await this.commit(message.payload.cwd, message.payload.message) }
          break
        case "git.push.request":
          value = { output: await this.push(message.payload.cwd, message.payload) }
          break
      }
      send({ type, requestId: message.requestId, payload: { ok: true, value } } as GitServerMessage)
    } catch (error) {
      send({
        type,
        requestId: message.requestId,
        payload: {
          ok: false,
          error: {
            code: error instanceof GitCommandError ? "GIT_COMMAND_FAILED" : "GIT_INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      } as GitServerMessage)
    }
    return true
  }

  async discover(cwd: string): Promise<GitRepository> {
    const root = trimmed(
      (await this.#executor.run(cwd, ["rev-parse", "--show-toplevel"], { readOnly: true })).stdout
    )
    const commonGitDir = trimmed(
      (
        await this.#executor.run(
          root,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          {
            readOnly: true,
          }
        )
      ).stdout
    )
    return { commonGitDir: await realpath(commonGitDir), root: await realpath(root) }
  }

  async init(cwd: string): Promise<GitRepository> {
    const existing = await this.discover(cwd).catch(() => null)
    if (existing) throw new Error(`Directory is already in Git repository ${existing.root}`)
    await this.#executor.run(cwd, ["init", "--initial-branch=main"])
    return this.discover(cwd)
  }

  async createBranch(cwd: string, name: string, startPoint?: string): Promise<string> {
    const repository = await this.discover(cwd)
    const branch = validateOperand(name, "branch")
    await this.#executor.run(repository.root, ["check-ref-format", "--branch", branch], {
      readOnly: true,
    })
    let start: string | undefined
    if (startPoint) {
      const ref = validateOperand(startPoint, "start point")
      start = (
        await this.#executor.run(
          repository.root,
          ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
          { readOnly: true }
        )
      ).stdout.trim()
    }
    await this.#executor.run(repository.root, ["branch", "--", branch, ...(start ? [start] : [])])
    return branch
  }

  async checkout(cwd: string, target: string, stashChanges = false): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const ref = validateOperand(target, "checkout target")
    const previous = await this.status(repository.root)
    if (previous.entries.length > 0 && !stashChanges) {
      throw new Error("Working tree has changes; choose stashChanges to preserve them")
    }
    const stashBefore = stashChanges ? await this.#stashHead(repository.root) : null
    if (stashChanges && previous.entries.length > 0) {
      await this.#executor.run(repository.root, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        "Cypheria branch checkout",
      ])
    }
    const stashAfter = stashChanges ? await this.#stashHead(repository.root) : null
    const createdStash = stashAfter !== null && stashAfter !== stashBefore
    try {
      const local = await this.#executor
        .run(repository.root, ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`], {
          readOnly: true,
        })
        .then(
          () => true,
          () => false
        )
      if (local) {
        await this.#executor.run(repository.root, ["switch", "--", ref])
      } else if (/^[a-f0-9]{40,64}$/iu.test(ref)) {
        await this.#executor.run(repository.root, ["switch", "--detach", ref])
      } else {
        await this.#executor.run(repository.root, ["switch", "--guess", "--", ref])
      }
    } catch (error) {
      if (createdStash) {
        try {
          await this.#executor.run(repository.root, ["stash", "pop", "--index"])
        } catch (restoreError) {
          throw new Error(
            `Checkout failed and saved changes need recovery from stash ${stashAfter}: ${String(restoreError)}`,
            { cause: error }
          )
        }
      }
      throw error
    }
    if (createdStash) {
      try {
        await this.#executor.run(repository.root, ["stash", "pop", "--index"])
      } catch (error) {
        throw new Error(
          `Branch changed, but saved changes need recovery from stash ${stashAfter}: ${String(error)}`,
          { cause: error }
        )
      }
    }
    return this.status(repository.root)
  }

  async #stashHead(root: string): Promise<string | null> {
    return this.#executor
      .run(root, ["rev-parse", "--verify", "refs/stash"], { readOnly: true })
      .then(
        ({ stdout }) => stdout.trim(),
        () => null
      )
  }

  async status(cwd: string): Promise<GitStatus> {
    const repository = await this.discover(cwd)
    const [porcelain, head, branch] = await Promise.all([
      this.#executor.run(
        repository.root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        {
          readOnly: true,
        }
      ),
      this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true }).then(
        ({ stdout }) => stdout.trim(),
        () => null
      ),
      this.#executor
        .run(repository.root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { readOnly: true })
        .then(
          ({ stdout }) => stdout.trim(),
          () => null
        ),
    ])
    const records = porcelain.stdout.split("\0")
    const entries: { code: string; path: string }[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record) continue
      const code = record.slice(0, 2)
      const path = record.slice(3)
      if (!path) continue
      entries.push({ code, path })
      if (code.includes("R") || code.includes("C")) index += 1
    }
    return { branch, entries, head, repository }
  }

  async diff(
    cwd: string,
    input: { staged?: boolean; base?: string; paths?: readonly string[] } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    const args = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ]
    if (input.staged) args.push("--cached")
    if (input.base) args.push(validateOperand(input.base, "base"))
    if (input.paths?.length) args.push("--", ...(await this.#paths(repository.root, input.paths)))
    return (await this.#executor.run(repository.root, args, { readOnly: true })).stdout
  }

  async stage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "add",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<void> {
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, [
      "restore",
      "--staged",
      "--",
      ...(await this.#paths(repository.root, paths)),
    ])
  }

  async commit(cwd: string, message: string): Promise<string> {
    if (!message.trim()) throw new Error("Commit message is required")
    const repository = await this.discover(cwd)
    await this.#executor.run(repository.root, ["commit", "-m", message])
    return trimmed(
      (await this.#executor.run(repository.root, ["rev-parse", "HEAD"], { readOnly: true })).stdout
    )
  }

  async push(
    cwd: string,
    input: {
      remote?: string
      branch?: string
      setUpstream?: boolean
      forceWithLease?: boolean
    } = {}
  ): Promise<string> {
    const repository = await this.discover(cwd)
    const args = ["push", "--porcelain"]
    if (input.forceWithLease) args.push("--force-with-lease")
    if (input.setUpstream) args.push("-u")
    if (input.remote) args.push(validateOperand(input.remote, "remote"))
    if (input.branch) args.push(validateOperand(input.branch, "branch"))
    return (await this.#executor.run(repository.root, args, { timeoutMs: 120_000 })).stdout
  }

  async branches(
    cwd: string
  ): Promise<readonly { name: string; current: boolean; commit: string }[]> {
    const repository = await this.discover(cwd)
    const { stdout } = await this.#executor.run(
      repository.root,
      ["for-each-ref", "--format=%(HEAD)%00%(refname:short)%00%(objectname)%00", "refs/heads"],
      { readOnly: true }
    )
    const branches: { name: string; current: boolean; commit: string }[] = []
    for (const line of stdout.split("\n")) {
      const [head, name, commit] = line.split("\0")
      if (!name) continue
      branches.push({ current: head?.trim() === "*", name, commit: commit ?? "" })
    }
    return branches
  }

  async #paths(root: string, paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) throw new Error("At least one path is required")
    return await Promise.all(
      paths.map(async (path) => {
        if (!path || path.includes("\0")) throw new Error("Invalid Git path")
        const absolute = resolve(root, path)
        const relativePath = relative(root, absolute)
        if (
          relativePath === ".." ||
          relativePath.startsWith(`..${sep}`) ||
          isAbsolute(relativePath)
        ) {
          throw new Error("Git path is outside the repository")
        }
        const parent = dirname(absolute)
        const parentInfo = await stat(parent).catch(() => null)
        if (!parentInfo?.isDirectory()) throw new Error("Git path parent is unavailable")
        const actualParent = await realpath(parent)
        const actualRelative = relative(root, actualParent)
        if (
          actualRelative === ".." ||
          actualRelative.startsWith(`..${sep}`) ||
          isAbsolute(actualRelative)
        ) {
          throw new Error("Git path resolves outside the repository")
        }
        return relativePath || "."
      })
    )
  }
}
