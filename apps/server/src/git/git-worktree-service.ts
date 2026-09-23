import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { GitWorktree } from "@cypheria/protocol"

import type { GitExecutor } from "./git-executor.js"

type Repository = { root: string; commonGitDir: string }
type Record = {
  version: 1
  commonGitDir: string
  sourceRoot: string
  path: string
  snapshotRef: string
}

const inside = (root: string, path: string): boolean => {
  const part = relative(root, path)
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export class GitWorktreeService {
  readonly #executor: GitExecutor
  readonly #root: string

  constructor(executor: GitExecutor, cypheriaHome: string) {
    this.#executor = executor
    let home: string
    try {
      home = realpathSync(cypheriaHome)
    } catch {
      home = join(realpathSync(dirname(cypheriaHome)), basename(cypheriaHome))
    }
    this.#root = join(home, "worktrees")
  }

  async list(repository: Repository): Promise<GitWorktree[]> {
    const { stdout } = await this.#executor.run(
      repository.root,
      ["worktree", "list", "--porcelain"],
      {
        readOnly: true,
      }
    )
    const result: GitWorktree[] = []
    for (const block of stdout.trim().split("\n\n")) {
      if (!block) continue
      const lines = block.split("\n")
      const path = lines.find((line) => line.startsWith("worktree "))?.slice(9)
      if (!path) continue
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice(5) ?? null
      const branch =
        lines
          .find((line) => line.startsWith("branch "))
          ?.slice(7)
          .replace(/^refs\/heads\//u, "") ?? null
      result.push({ path, head, branch, managed: await this.#isManaged(repository, path) })
    }
    return result
  }

  async create(repository: Repository, startPoint?: string): Promise<GitWorktree> {
    const ref = startPoint ?? "HEAD"
    if (!ref || ref.startsWith("-") || /[\0\n]/u.test(ref))
      throw new Error("Invalid Git start point")
    const commit = (
      await this.#executor.run(
        repository.root,
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        { readOnly: true }
      )
    ).stdout.trim()
    const id = randomUUID()
    const path = join(this.#root, `${basename(repository.root)}-${id}`)
    const snapshotRef = `refs/cypheria/worktrees/${id}`
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    await this.#executor.run(repository.root, ["worktree", "add", "--detach", path, commit])
    try {
      await this.#writeRecord({
        version: 1,
        commonGitDir: repository.commonGitDir,
        sourceRoot: repository.root,
        path,
        snapshotRef,
      })
    } catch (error) {
      await this.#executor.run(repository.root, ["worktree", "remove", "--", path])
      throw error
    }
    return { path, head: commit, branch: null, managed: true }
  }

  async delete(repository: Repository, path: string): Promise<void> {
    const record = await this.#record(repository, path)
    const worktree = await realpath(record.path)
    if (worktree !== record.path) throw new Error("Managed worktree path changed")
    const dirty = (
      await this.#executor.run(worktree, ["status", "--porcelain=v1", "--untracked-files=all"], {
        readOnly: true,
      })
    ).stdout
    if (dirty) throw new Error("Worktree has uncommitted changes")
    const head = (
      await this.#executor.run(worktree, ["rev-parse", "HEAD"], { readOnly: true })
    ).stdout.trim()
    await this.#executor.run(repository.root, ["update-ref", record.snapshotRef, head])
    await this.#executor.run(repository.root, ["worktree", "remove", "--", worktree])
  }

  async restore(repository: Repository, path: string): Promise<GitWorktree> {
    const record = await this.#record(repository, path)
    if (
      await stat(record.path).then(
        () => true,
        () => false
      )
    )
      throw new Error("Worktree path already exists")
    const head = (
      await this.#executor.run(repository.root, ["rev-parse", "--verify", record.snapshotRef], {
        readOnly: true,
      })
    ).stdout.trim()
    await this.#executor.run(repository.root, ["worktree", "add", "--detach", record.path, head])
    return { path: record.path, head, branch: null, managed: true }
  }

  async #isManaged(repository: Repository, path: string): Promise<boolean> {
    return this.#record(repository, path).then(
      () => true,
      () => false
    )
  }

  async #record(repository: Repository, path: string): Promise<Record> {
    const resolved = resolve(path)
    if (!isAbsolute(path) || !inside(this.#root, resolved) || dirname(resolved) !== this.#root) {
      throw new Error("Path is not a managed Cypheria worktree")
    }
    const id = basename(resolved).match(/-([a-f0-9-]{36})$/u)?.[1]
    if (!id) throw new Error("Invalid managed worktree path")
    const parsed = JSON.parse(
      await readFile(join(this.#root, ".metadata", `${id}.json`), "utf8")
    ) as Record
    if (
      parsed.version !== 1 ||
      parsed.path !== resolved ||
      parsed.commonGitDir !== repository.commonGitDir ||
      parsed.snapshotRef !== `refs/cypheria/worktrees/${id}`
    ) {
      throw new Error("Managed worktree repository identity mismatch")
    }
    return parsed
  }

  async #writeRecord(record: Record): Promise<void> {
    const metadata = join(this.#root, ".metadata")
    await mkdir(metadata, { recursive: true, mode: 0o700 })
    const id = record.snapshotRef.split("/").at(-1)
    const target = join(metadata, `${id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" })
    await rename(temporary, target)
  }
}
