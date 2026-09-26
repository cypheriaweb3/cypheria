import { randomUUID } from "node:crypto"
import { constants, realpathSync } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
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
  syncedBranch?: { branch: string; expectedHead: string; lastSyncedTreeRef: string }
  syncBackupRef?: string | null
  shellEnvironment?: { [key: string]: string }
}

const inside = (root: string, path: string): boolean => {
  const part = relative(root, path)
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}
const shellEnvironmentKeys = new Set([
  "PATH",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "PYENV_VERSION",
  "NPM_CONFIG_PREFIX",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "GOPATH",
])

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

  async has(id: string): Promise<boolean> {
    if (!/^[a-f0-9-]{36}$/u.test(id)) return false
    const record = await readFile(join(this.#root, ".metadata", `${id}.json`), "utf8").then(
      (value) => JSON.parse(value) as Partial<Record>,
      () => null
    )
    return Boolean(
      record &&
        record.version === 1 &&
        record.snapshotRef === `refs/cypheria/worktrees/${id}` &&
        typeof record.path === "string" &&
        basename(record.path).endsWith(`-${id}`)
    )
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
      const id = record?.snapshotRef.split("/").at(-1) ?? null
      result.push({
        id,
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
          id: record.snapshotRef.split("/").at(-1) ?? null,
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

  async restoreIfArchived(path: string): Promise<GitWorktree | null> {
    const metadata = join(this.#root, ".metadata")
    const files = await readdir(metadata).catch(() => [])
    for (const file of files) {
      if (!/^[a-f0-9-]{36}\.json$/u.test(file)) continue
      const record = await readFile(join(metadata, file), "utf8").then(
        (value) => JSON.parse(value) as Partial<Record>,
        () => null
      )
      if (
        !record?.path ||
        (record.path !== path && !inside(record.path, path)) ||
        !record.sourceRoot ||
        !record.commonGitDir
      )
        continue
      const repository = { root: record.sourceRoot, commonGitDir: record.commonGitDir }
      if (
        await stat(record.path).then(
          () => true,
          () => false
        )
      )
        return null
      return this.restore(repository, record.path)
    }
    return null
  }

  async create(
    repository: Repository,
    startPoint?: string,
    options: { includeChanges?: boolean; signal?: AbortSignal } = {}
  ): Promise<GitWorktree> {
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
    let changes: { staged: string; unstaged: string; untracked: string[] } | null = null
    if (options.includeChanges) {
      const sourceHead = (
        await this.#executor.run(repository.root, ["rev-parse", "HEAD"], {
          readOnly: true,
          signal: options.signal,
        })
      ).stdout.trim()
      if (sourceHead !== commit)
        throw new Error("Local changes require the current HEAD as the worktree start point")
      changes = await this.#captureLocalChanges(repository.root, options.signal)
    }
    const id = randomUUID()
    const path = join(this.#root, `${basename(repository.root)}-${id}`)
    const snapshotRef = `refs/cypheria/worktrees/${id}`
    const selectedBranch =
      startPoint && !startPoint.startsWith("refs/remotes/")
        ? startPoint.replace(/^refs\/heads\//u, "")
        : null
    const isLocalBranch = selectedBranch
      ? await this.#executor
          .run(
            repository.root,
            ["show-ref", "--verify", "--quiet", `refs/heads/${selectedBranch}`],
            {
              readOnly: true,
            }
          )
          .then(
            () => true,
            () => false
          )
      : false
    const currentBranch = (
      await this.#executor.run(repository.root, ["branch", "--show-current"], {
        readOnly: true,
      })
    ).stdout.trim()
    const syncedBranch =
      isLocalBranch && selectedBranch && selectedBranch !== currentBranch
        ? {
            branch: selectedBranch,
            expectedHead: commit,
            lastSyncedTreeRef: (
              await this.#executor.run(repository.root, ["rev-parse", `${commit}^{tree}`], {
                readOnly: true,
              })
            ).stdout.trim(),
          }
        : undefined
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    try {
      await this.#executor.run(repository.root, ["worktree", "add", "--detach", path, commit], {
        signal: options.signal,
      })
    } catch (error) {
      await this.#executor
        .run(repository.root, ["worktree", "remove", "--force", "--", path])
        .catch(() => {})
      await rm(path, { recursive: true, force: true })
      throw error
    }
    try {
      if (changes) await this.#applyLocalChanges(repository.root, path, changes, options.signal)
      options.signal?.throwIfAborted()
      await this.#copyWorktreeResources(repository.root, path)
      options.signal?.throwIfAborted()
      await this.#writeRecord({
        version: 1,
        commonGitDir: repository.commonGitDir,
        sourceRoot: repository.root,
        path,
        snapshotRef,
        ownerThreadId: null,
        syncedBranch,
      })
      if (syncedBranch) await this.#writeSyncedBranch(repository, path, syncedBranch)
    } catch (error) {
      await this.#executor.run(repository.root, ["worktree", "remove", "--force", "--", path])
      throw error
    }
    return {
      id,
      path,
      head: commit,
      branch: null,
      managed: true,
      active: true,
      ownerThreadId: null,
    }
  }

  async copyLocalChanges(source: string, target: string): Promise<boolean> {
    if (source === target) return false
    const [sourceHead, targetHead, targetStatus] = await Promise.all([
      this.#executor.run(source, ["rev-parse", "HEAD"], { readOnly: true }),
      this.#executor.run(target, ["rev-parse", "HEAD"], { readOnly: true }),
      this.#executor.run(target, ["status", "--porcelain=v1", "-z"], { readOnly: true }),
    ])
    if (sourceHead.stdout.trim() !== targetHead.stdout.trim())
      throw new Error("Local changes require the source and target to have the same HEAD")
    if (targetStatus.stdout) throw new Error("Target worktree must be clean before copying changes")
    const changes = await this.#captureLocalChanges(source)
    if (!changes.staged && !changes.unstaged && changes.untracked.length === 0) return false
    try {
      await this.#applyLocalChanges(source, target, changes)
    } catch (error) {
      const failures: unknown[] = []
      await this.#executor
        .run(target, ["reset", "--hard", "HEAD"])
        .catch((cause) => failures.push(cause))
      await this.#executor.run(target, ["clean", "-fd"]).catch((cause) => failures.push(cause))
      if (failures.length)
        throw new AggregateError([error, ...failures], "Copying Git changes and rollback failed")
      throw error
    }
    return true
  }

  async writeShellEnvironment(
    repository: Repository,
    worktree: string,
    values: { [key: string]: string }
  ): Promise<void> {
    await this.#record(repository, worktree)
    if (
      Object.entries(values).some(
        ([key, value]) =>
          !shellEnvironmentKeys.has(key) ||
          typeof value !== "string" ||
          value.length > 10_000 ||
          value.includes("\0")
      )
    ) {
      throw new Error("Invalid managed worktree shell environment")
    }
    const gitDir = await realpath(
      (
        await this.#executor.run(worktree, ["rev-parse", "--absolute-git-dir"], {
          readOnly: true,
        })
      ).stdout.trim()
    )
    if (!inside(repository.commonGitDir, gitDir))
      throw new Error("Managed worktree Git directory is outside the repository")
    const target = join(gitDir, "codex-shell-environment.json")
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, set: values, exclude: [] })}\n`, {
        mode: 0o600,
      })
      await rename(temporary, target)
      const record = await this.#record(repository, worktree)
      await this.#writeRecord({ ...record, shellEnvironment: values }, true)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async shellEnvironment(
    repository: Repository,
    worktree: string
  ): Promise<{ [key: string]: string } | null> {
    const record = await this.#record(repository, worktree).catch(() => null)
    return record?.shellEnvironment ?? null
  }

  async syncedBranchState(
    repository: Repository,
    worktree: string
  ): Promise<{
    branch: string
    expectedHead: string
    branchHead: string
    worktreeHead: string
    sourceDirty: boolean
    worktreeDirty: boolean
    backupRef: string | null
  } | null> {
    const record = await this.#record(repository, worktree)
    if (!record.syncedBranch) return null
    const sourceCommonGitDir = await realpath(
      (
        await this.#executor.run(
          record.sourceRoot,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          { readOnly: true }
        )
      ).stdout.trim()
    )
    if (sourceCommonGitDir !== repository.commonGitDir)
      throw new Error("Synced branch source belongs to another repository")
    const { branch, expectedHead } = record.syncedBranch
    const worktreeList = (
      await this.#executor.run(repository.root, ["worktree", "list", "--porcelain"], {
        readOnly: true,
      })
    ).stdout
    for (const block of worktreeList.split("\n\n")) {
      if (!block.split("\n").includes(`branch refs/heads/${branch}`)) continue
      const checkedOutPath = block
        .split("\n")
        .find((line) => line.startsWith("worktree "))
        ?.slice("worktree ".length)
      if (
        checkedOutPath &&
        (await realpath(checkedOutPath)) !== (await realpath(record.sourceRoot))
      ) {
        throw new Error("Synced branch is checked out in another worktree")
      }
    }
    const branchHead = (
      await this.#executor.run(repository.root, ["rev-parse", `refs/heads/${branch}`], {
        readOnly: true,
      })
    ).stdout.trim()
    const worktreeHead = (
      await this.#executor.run(worktree, ["rev-parse", "HEAD"], { readOnly: true })
    ).stdout.trim()
    const sourceBranch = (
      await this.#executor.run(record.sourceRoot, ["branch", "--show-current"], {
        readOnly: true,
      })
    ).stdout.trim()
    const sourceDirty =
      sourceBranch === branch &&
      Boolean(
        (
          await this.#executor.run(record.sourceRoot, ["status", "--porcelain=v1", "-z"], {
            readOnly: true,
          })
        ).stdout
      )
    const worktreeDirty = Boolean(
      (
        await this.#executor.run(worktree, ["status", "--porcelain=v1", "-z"], {
          readOnly: true,
        })
      ).stdout
    )
    return {
      branch,
      expectedHead,
      branchHead,
      worktreeHead,
      sourceDirty,
      worktreeDirty,
      backupRef: record.syncBackupRef ?? null,
    }
  }

  async syncBranch(
    repository: Repository,
    worktree: string,
    expectedBranchHead: string,
    expectedWorktreeHead: string
  ): Promise<string> {
    const record = await this.#record(repository, worktree)
    const state = await this.syncedBranchState(repository, worktree)
    if (!record.syncedBranch || !state) throw new Error("Worktree has no synced branch")
    if (
      state.branchHead !== expectedBranchHead ||
      state.worktreeHead !== expectedWorktreeHead ||
      state.branchHead !== state.expectedHead
    ) {
      throw new Error("Synced branch changed; refresh before syncing")
    }
    if (state.sourceDirty)
      throw new Error("Move local changes out of the branch checkout before syncing")
    if (state.branchHead === state.worktreeHead && !state.worktreeDirty) return state.branchHead
    const worktreeSnapshot = state.worktreeDirty
      ? await this.#snapshotWorkingTree(worktree, state.worktreeHead)
      : null
    if (worktreeSnapshot?.tree === record.syncedBranch.lastSyncedTreeRef) return state.branchHead
    const targetHead = worktreeSnapshot?.commit ?? state.worktreeHead
    const backupRef = `refs/cypheria/worktree-sync/${randomUUID()}`
    await this.#executor.run(repository.root, ["update-ref", backupRef, state.branchHead])
    const sourceBranch = (
      await this.#executor.run(record.sourceRoot, ["branch", "--show-current"], {
        readOnly: true,
      })
    ).stdout.trim()
    await this.#executor.run(repository.root, [
      "update-ref",
      `refs/heads/${state.branch}`,
      targetHead,
      state.branchHead,
    ])
    try {
      if (sourceBranch === state.branch)
        await this.#executor.run(record.sourceRoot, ["reset", "--hard", targetHead])
      const updated = {
        branch: state.branch,
        expectedHead: targetHead,
        lastSyncedTreeRef:
          worktreeSnapshot?.tree ??
          (
            await this.#executor.run(worktree, ["rev-parse", "HEAD^{tree}"], { readOnly: true })
          ).stdout.trim(),
      }
      await this.#writeSyncedBranch(repository, worktree, updated)
      await this.#writeRecord({ ...record, syncedBranch: updated, syncBackupRef: backupRef }, true)
    } catch (error) {
      const failures: unknown[] = []
      await this.#executor
        .run(repository.root, [
          "update-ref",
          `refs/heads/${state.branch}`,
          state.branchHead,
          targetHead,
        ])
        .catch((cause) => failures.push(cause))
      if (sourceBranch === state.branch)
        await this.#executor
          .run(record.sourceRoot, ["reset", "--hard", state.branchHead])
          .catch((cause) => failures.push(cause))
      await this.#writeRecord(record, true).catch((cause) => failures.push(cause))
      await this.#writeSyncedBranch(repository, worktree, record.syncedBranch).catch((cause) =>
        failures.push(cause)
      )
      if (failures.length)
        throw new AggregateError([error, ...failures], "Synced branch update and rollback failed")
      throw error
    }
    return backupRef
  }

  async undoSync(repository: Repository, worktree: string): Promise<void> {
    const record = await this.#record(repository, worktree)
    const state = await this.syncedBranchState(repository, worktree)
    if (!state || !record.syncedBranch || !state.backupRef)
      throw new Error("No synced branch backup is available")
    if (state.branchHead !== state.expectedHead || state.sourceDirty)
      throw new Error("Synced branch changed; undo would overwrite newer changes")
    const oldHead = (
      await this.#executor.run(repository.root, ["rev-parse", "--verify", state.backupRef], {
        readOnly: true,
      })
    ).stdout.trim()
    const sourceBranch = (
      await this.#executor.run(record.sourceRoot, ["branch", "--show-current"], {
        readOnly: true,
      })
    ).stdout.trim()
    await this.#executor.run(repository.root, [
      "update-ref",
      `refs/heads/${state.branch}`,
      oldHead,
      state.branchHead,
    ])
    try {
      if (sourceBranch === state.branch)
        await this.#executor.run(record.sourceRoot, ["reset", "--hard", oldHead])
      const updated = {
        branch: state.branch,
        expectedHead: oldHead,
        lastSyncedTreeRef: (
          await this.#executor.run(repository.root, ["rev-parse", `${oldHead}^{tree}`], {
            readOnly: true,
          })
        ).stdout.trim(),
      }
      await this.#writeSyncedBranch(repository, worktree, updated)
      await this.#writeRecord({ ...record, syncedBranch: updated, syncBackupRef: null }, true)
    } catch (error) {
      const failures: unknown[] = []
      await this.#executor
        .run(repository.root, [
          "update-ref",
          `refs/heads/${state.branch}`,
          state.branchHead,
          oldHead,
        ])
        .catch((cause) => failures.push(cause))
      if (sourceBranch === state.branch)
        await this.#executor
          .run(record.sourceRoot, ["reset", "--hard", state.branchHead])
          .catch((cause) => failures.push(cause))
      await this.#writeRecord(record, true).catch((cause) => failures.push(cause))
      await this.#writeSyncedBranch(repository, worktree, record.syncedBranch).catch((cause) =>
        failures.push(cause)
      )
      if (failures.length)
        throw new AggregateError([error, ...failures], "Synced branch undo and rollback failed")
      throw error
    }
  }

  async #writeSyncedBranch(
    repository: Repository,
    worktree: string,
    value: { branch: string; lastSyncedTreeRef: string }
  ): Promise<void> {
    const gitDir = await realpath(
      (
        await this.#executor.run(worktree, ["rev-parse", "--absolute-git-dir"], {
          readOnly: true,
        })
      ).stdout.trim()
    )
    if (!inside(repository.commonGitDir, gitDir))
      throw new Error("Managed worktree Git directory is outside the repository")
    await writeFile(
      join(gitDir, "codex-synced-branch.json"),
      `${JSON.stringify({ branch: value.branch, lastSyncedTreeRef: value.lastSyncedTreeRef })}\n`,
      { mode: 0o600 }
    )
  }

  async #snapshotWorkingTree(
    worktree: string,
    parent: string
  ): Promise<{ commit: string; tree: string }> {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-git-sync-"))
    try {
      const env = { GIT_INDEX_FILE: join(directory, "index") }
      await this.#executor.run(worktree, ["read-tree", parent], { env })
      await this.#executor.run(worktree, ["add", "-A"], { env })
      const tree = (
        await this.#executor.run(worktree, ["write-tree"], { env, readOnly: true })
      ).stdout.trim()
      const commit = (
        await this.#executor.run(
          worktree,
          ["commit-tree", tree, "-p", parent, "-m", "Cypheria worktree sync snapshot"],
          {
            env: {
              GIT_AUTHOR_NAME: "Cypheria",
              GIT_AUTHOR_EMAIL: "git-sync@cypheria.local",
              GIT_COMMITTER_NAME: "Cypheria",
              GIT_COMMITTER_EMAIL: "git-sync@cypheria.local",
            },
          }
        )
      ).stdout.trim()
      return { commit, tree }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async #captureLocalChanges(
    source: string,
    signal?: AbortSignal
  ): Promise<{ staged: string; unstaged: string; untracked: string[] }> {
    const staged = (
      await this.#executor.run(
        source,
        ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"],
        {
          readOnly: true,
          signal,
        }
      )
    ).stdout
    const unstaged = (
      await this.#executor.run(source, ["diff", "--binary", "--no-ext-diff", "--no-textconv"], {
        readOnly: true,
        signal,
      })
    ).stdout
    const untracked = (
      await this.#executor.run(source, ["ls-files", "--others", "--exclude-standard", "-z"], {
        readOnly: true,
        signal,
      })
    ).stdout
      .split("\0")
      .filter(Boolean)
    return { staged, unstaged, untracked }
  }

  async #applyLocalChanges(
    source: string,
    target: string,
    changes: { staged: string; unstaged: string; untracked: string[] },
    signal?: AbortSignal
  ): Promise<void> {
    const temporary = await mkdtemp(join(tmpdir(), "cypheria-worktree-patch-"))
    try {
      for (const [name, patch, args] of [
        ["staged", changes.staged, ["--index"]],
        ["unstaged", changes.unstaged, []],
      ] as const) {
        if (!patch) continue
        signal?.throwIfAborted()
        const file = join(temporary, `${name}.patch`)
        await writeFile(file, patch, { mode: 0o600 })
        await this.#executor.run(target, ["apply", "--binary", ...args, "--", file], { signal })
      }
      for (const path of changes.untracked) {
        signal?.throwIfAborted()
        if (!path || isAbsolute(path) || path.split(/[\\/]/u).includes(".."))
          throw new Error("Invalid untracked worktree path")
        const from = join(source, path)
        const to = join(target, path)
        if (!inside(source, from) || !inside(target, to))
          throw new Error("Untracked path leaves repository")
        if (!(await lstat(from)).isFile())
          throw new Error("Untracked worktree resource is not a regular file")
        await this.#copyRegularFile(source, target, path)
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async #copyRegularFile(source: string, target: string, path: string): Promise<void> {
    const from = join(source, path)
    const to = join(target, path)
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

  async copyEnvironmentConfig(
    repository: Repository,
    worktreePath: string,
    sourcePath: string
  ): Promise<string> {
    await this.#record(repository, worktreePath)
    const sourceFile = await realpath(sourcePath)
    if (!inside(repository.root, sourceFile) || !(await stat(sourceFile)).isFile()) {
      throw new Error("Environment config must be a regular file inside the repository")
    }
    const path = relative(repository.root, sourceFile)
    await this.#copyRegularFile(repository.root, worktreePath, path)
    return join(worktreePath, path)
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
      await this.#copyRegularFile(source, target, path)
    }
  }

  async cleanup(
    repository: Repository,
    keepCount: number,
    protectedPaths: readonly string[],
    protectedOwnerThreadIds?: readonly string[]
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
        (entry.ownerThreadId &&
          (!protectedOwnerThreadIds || protectedOwnerThreadIds.includes(entry.ownerThreadId))) ||
        entry.path === repository.root ||
        modified > Date.now() - 10 * 60_000 ||
        protectedRoots.some((path) => path === entry.path || inside(entry.path, path))
      )
        continue
      try {
        await this.delete(
          repository,
          entry.path,
          Boolean(entry.ownerThreadId && protectedOwnerThreadIds)
        )
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

  async delete(repository: Repository, path: string, allowArchivedOwner = false): Promise<void> {
    const record = await this.#record(repository, path)
    if (record.ownerThreadId && !allowArchivedOwner)
      throw new Error("Move the owner thread before deleting this worktree")
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
    if (record.syncedBranch)
      await this.#writeSyncedBranch(repository, record.path, record.syncedBranch)
    if (record.shellEnvironment)
      await this.writeShellEnvironment(repository, record.path, record.shellEnvironment)
    return {
      id: record.snapshotRef.split("/").at(-1) ?? null,
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
    if (parsed.syncedBranch) {
      const sync = parsed.syncedBranch
      if (
        typeof sync.branch !== "string" ||
        !sync.branch ||
        typeof sync.expectedHead !== "string" ||
        !/^[a-f0-9]{40,64}$/iu.test(sync.expectedHead) ||
        typeof sync.lastSyncedTreeRef !== "string" ||
        !/^[a-f0-9]{40,64}$/iu.test(sync.lastSyncedTreeRef)
      ) {
        throw new Error("Invalid managed worktree synced branch")
      }
      await this.#executor.run(repository.root, ["check-ref-format", `refs/heads/${sync.branch}`], {
        readOnly: true,
      })
    }
    if (
      parsed.syncBackupRef != null &&
      !/^refs\/cypheria\/worktree-sync\/[a-f0-9-]{36}$/u.test(parsed.syncBackupRef)
    ) {
      throw new Error("Invalid managed worktree sync backup")
    }
    if (
      parsed.shellEnvironment &&
      (typeof parsed.shellEnvironment !== "object" ||
        Array.isArray(parsed.shellEnvironment) ||
        Object.entries(parsed.shellEnvironment).some(
          ([key, value]) =>
            !shellEnvironmentKeys.has(key) ||
            typeof value !== "string" ||
            value.length > 10_000 ||
            value.includes("\0")
        ))
    ) {
      throw new Error("Invalid managed worktree shell environment")
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
