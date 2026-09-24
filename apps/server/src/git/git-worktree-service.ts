import { randomUUID } from "node:crypto"
import { constants, realpathSync } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
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
  ownerThreadId?: string | null
}

const inside = (root: string, path: string): boolean => {
  const part = relative(root, path)
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export class GitWorktreeService {
  readonly #executor: GitExecutor
  readonly #root: string

  constructor(executor: GitExecutor, cypheriaHome: string, configuredRoot: string | null = null) {
    this.#executor = executor
    let home: string
    try {
      home = realpathSync(cypheriaHome)
    } catch {
      home = join(realpathSync(dirname(cypheriaHome)), basename(cypheriaHome))
    }
    if (configuredRoot && !isAbsolute(configuredRoot))
      throw new Error("Git worktree root must be absolute")
    this.#root = configuredRoot ? resolve(configuredRoot) : join(home, "worktrees")
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
      const record = await this.#record(repository, path).catch(() => null)
      result.push({
        path,
        head,
        branch,
        managed: record !== null,
        active: true,
        ownerThreadId: record?.ownerThreadId ?? null,
      })
    }
    const metadata = join(this.#root, ".metadata")
    const files = await readdir(metadata).catch(() => [])
    for (const file of files) {
      if (!/^[a-f0-9-]{36}\.json$/u.test(file)) continue
      let record: Record
      try {
        record = JSON.parse(await readFile(join(metadata, file), "utf8")) as Record
        if (record.commonGitDir !== repository.commonGitDir) continue
        await this.#record(repository, record.path)
      } catch {
        continue
      }
      if (result.some((entry) => entry.path === record.path)) continue
      const head = await this.#executor
        .run(repository.root, ["rev-parse", "--verify", record.snapshotRef], { readOnly: true })
        .then(
          ({ stdout }) => stdout.trim(),
          () => null
        )
      if (head)
        result.push({
          path: record.path,
          head,
          branch: null,
          managed: true,
          active: false,
          ownerThreadId: record.ownerThreadId ?? null,
        })
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
      await this.#copyWorktreeResources(repository.root, path)
      await this.#writeRecord({
        version: 1,
        commonGitDir: repository.commonGitDir,
        sourceRoot: repository.root,
        path,
        snapshotRef,
        ownerThreadId: null,
      })
    } catch (error) {
      await this.#executor.run(repository.root, ["worktree", "remove", "--force", "--", path])
      throw error
    }
    return { path, head: commit, branch: null, managed: true, active: true, ownerThreadId: null }
  }

  async #copyWorktreeResources(source: string, target: string): Promise<void> {
    const ignored = new Set(
      (
        await this.#executor.run(
          source,
          ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
          { readOnly: true }
        )
      ).stdout
        .split("\0")
        .filter(Boolean)
    )
    const resources = new Set(
      [...ignored].filter(
        (path) => path === "AGENTS.override.md" || path.endsWith("/AGENTS.override.md")
      )
    )
    const include = join(source, ".worktreeinclude")
    if (
      await lstat(include).then(
        (entry) => entry.isFile(),
        () => false
      )
    ) {
      const selected = (
        await this.#executor.run(
          source,
          ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude", "-z"],
          { readOnly: true }
        )
      ).stdout.split("\0")
      for (const path of selected) if (ignored.has(path)) resources.add(path)
    }
    for (const path of resources) {
      if (!path || isAbsolute(path) || path.split(/[\\/]/u).includes("..")) continue
      const from = join(source, path)
      const to = join(target, path)
      if (!inside(source, from) || !inside(target, to)) continue
      if (
        !(await lstat(from).then(
          (entry) => entry.isFile(),
          () => false
        ))
      )
        continue
      const parent = dirname(to)
      let current = target
      for (const part of relative(target, parent).split(sep).filter(Boolean)) {
        current = join(current, part)
        const existing = await lstat(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null
          throw error
        })
        if (existing?.isSymbolicLink())
          throw new Error("Cannot copy worktree resource through a symlink")
        if (existing && !existing.isDirectory())
          throw new Error("Worktree resource parent is not a directory")
        if (!existing) await mkdir(current)
      }
      await copyFile(from, to, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
    }
  }

  async cleanup(
    repository: Repository,
    keepCount: number,
    protectedPaths: readonly string[]
  ): Promise<string[]> {
    if (!Number.isSafeInteger(keepCount) || keepCount < 0 || keepCount > 1000)
      throw new Error("Invalid worktree retention count")
    const protectedRoots = protectedPaths.map((path) => resolve(path))
    const active = (await this.list(repository)).filter((entry) => entry.managed && entry.active)
    const aged = await Promise.all(
      active.map(async (entry) => {
        const record = await this.#record(repository, entry.path)
        const id = record.snapshotRef.split("/").at(-1)
        const modified = (await stat(join(this.#root, ".metadata", `${id}.json`))).mtimeMs
        return { entry, modified }
      })
    )
    aged.sort((left, right) => right.modified - left.modified)
    const removed: string[] = []
    for (const { entry, modified } of aged.slice(keepCount)) {
      if (removed.length >= 5) break
      if (
        entry.ownerThreadId ||
        entry.path === repository.root ||
        modified > Date.now() - 10 * 60_000 ||
        protectedRoots.some((path) => path === entry.path || inside(entry.path, path))
      )
        continue
      try {
        await this.delete(repository, entry.path)
        removed.push(entry.path)
      } catch {
        // Dirty or changed worktrees remain available for an explicit user action.
      }
    }
    return removed
  }

  async setOwner(
    repository: Repository,
    path: string,
    threadId: string | null
  ): Promise<GitWorktree> {
    const record = await this.#record(repository, path)
    if (threadId !== null) {
      const files = await readdir(join(this.#root, ".metadata"))
      for (const file of files) {
        if (
          !/^[a-f0-9-]{36}\.json$/u.test(file) ||
          file === `${record.snapshotRef.split("/").at(-1)}.json`
        )
          continue
        const other = await readFile(join(this.#root, ".metadata", file), "utf8").then(
          (value) => JSON.parse(value) as Partial<Record>,
          () => null
        )
        if (other?.commonGitDir === repository.commonGitDir && other.ownerThreadId === threadId) {
          throw new Error("The thread already owns another worktree")
        }
      }
    }
    await this.#writeRecord({ ...record, ownerThreadId: threadId }, true)
    const updated = (await this.list(repository)).find((entry) => entry.path === record.path)
    if (!updated) throw new Error("Managed worktree is unavailable")
    return updated
  }

  async delete(repository: Repository, path: string): Promise<void> {
    const record = await this.#record(repository, path)
    if (record.ownerThreadId) throw new Error("Move the owner thread before deleting this worktree")
    if (repository.root === record.path) throw new Error("Cannot delete the current worktree")
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
    return {
      path: record.path,
      head,
      branch: null,
      managed: true,
      active: true,
      ownerThreadId: record.ownerThreadId ?? null,
    }
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
    if (
      parsed.ownerThreadId !== undefined &&
      parsed.ownerThreadId !== null &&
      typeof parsed.ownerThreadId !== "string"
    ) {
      throw new Error("Invalid managed worktree owner")
    }
    return parsed
  }

  async #writeRecord(record: Record, overwrite = false): Promise<void> {
    const metadata = join(this.#root, ".metadata")
    await mkdir(metadata, { recursive: true, mode: 0o700 })
    const id = record.snapshotRef.split("/").at(-1)
    const target = join(metadata, `${id}.json`)
    if (
      !overwrite &&
      (await stat(target).then(
        () => true,
        () => false
      ))
    ) {
      throw new Error("Managed worktree record already exists")
    }
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" })
    await rename(temporary, target)
  }
}
