import { execFile } from "node:child_process"
import { mkdtemp, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises"
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
