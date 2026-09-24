import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { GitExecutor } from "./git-executor.js"
import { GitWorktreeService } from "./git-worktree-service.js"

const run = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("GitWorktreeService cleanup", () => {
  it("syncs a clean detached worktree to its selected local branch and can undo it", async () => {
    const root = await mkdtemp(join(tmpdir(), "cypheria-worktree-sync-"))
    directories.push(root)
    await run("git", ["init", "-q", root])
    await run("git", ["-C", root, "config", "user.name", "Git Test"])
    await run("git", ["-C", root, "config", "user.email", "git-test@example.invalid"])
    await run("git", ["-C", root, "config", "commit.gpgsign", "false"])
    await writeFile(join(root, "file.txt"), "base\n")
    await run("git", ["-C", root, "add", "file.txt"])
    await run("git", ["-C", root, "commit", "-qm", "Base"])
    await run("git", ["-C", root, "branch", "feature"])
    const commonGitDir = await realpath(join(root, ".git"))
    const home = await mkdtemp(join(tmpdir(), "cypheria-worktree-sync-home-"))
    directories.push(home)
    const worktrees = new GitWorktreeService(new GitExecutor(join(home, "cache")), home)
    const repository = { root: await realpath(root), commonGitDir }
    const worktree = await worktrees.create(repository, "feature")
    await run("git", ["-C", root, "checkout", "-q", "feature"])
    await writeFile(join(worktree.path, "file.txt"), "updated\n")
    await run("git", ["-C", worktree.path, "add", "file.txt"])
    await run("git", ["-C", worktree.path, "commit", "-qm", "Update"])
    const before = await worktrees.syncedBranchState(repository, worktree.path)
    expect(before).toMatchObject({ branch: "feature", sourceDirty: false, worktreeDirty: false })
    if (!before) throw new Error("Missing synced branch")
    await writeFile(join(root, "file.txt"), "uncommitted\n")
    await expect(
      worktrees.syncBranch(repository, worktree.path, before.branchHead, before.worktreeHead)
    ).rejects.toThrow("Commit or move local changes")
    await run("git", ["-C", root, "restore", "file.txt"])
    await expect(
      worktrees.syncBranch(repository, worktree.path, before.branchHead, before.worktreeHead)
    ).resolves.toMatch(/^refs\/cypheria\/worktree-sync\//u)
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("updated\n")
    await worktrees.undoSync(repository, worktree.path)
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("base\n")
  }, 30_000)

  it("protects owned and thread-used worktrees and snapshots a clean older worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "cypheria-worktree-cleanup-"))
    directories.push(root)
    await run("git", ["init", "-q", root])
    await run("git", ["-C", root, "config", "user.name", "Git Test"])
    await run("git", ["-C", root, "config", "user.email", "git-test@example.invalid"])
    await run("git", ["-C", root, "config", "commit.gpgsign", "false"])
    await writeFile(join(root, "file.txt"), "base\n")
    await run("git", ["-C", root, "add", "file.txt"])
    await run("git", ["-C", root, "commit", "-qm", "Base"])
    const commonGitDir = await realpath(join(root, ".git"))
    const repository = { root: await realpath(root), commonGitDir }
    const home = join(root, "home")
    const worktrees = new GitWorktreeService(new GitExecutor(join(root, "cache")), home)
    const owned = await worktrees.create(repository)
    const used = await worktrees.create(repository)
    const removable = await worktrees.create(repository)
    await worktrees.setOwner(repository, owned.path, "thread-owner")
    const metadata = join(home, "worktrees", ".metadata")
    for (const file of await readdir(metadata)) {
      const old = new Date(Date.now() - 20 * 60_000)
      await utimes(join(metadata, file), old, old)
    }
    expect(await worktrees.cleanup(repository, 0, [join(used.path, "nested")])).toEqual([
      removable.path,
    ])
    expect(
      (await worktrees.list(repository)).find((entry) => entry.path === removable.path)?.active
    ).toBe(false)
    expect(await worktrees.restore(repository, removable.path)).toMatchObject({ active: true })
  }, 30_000)
})
