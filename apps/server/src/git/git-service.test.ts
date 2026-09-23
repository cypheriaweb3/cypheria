import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

import { GitService } from "./git-service.js"

const run = promisify(execFile)
const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), "cypheria-git-test-"))
  created.push(root)
  await run("git", ["init", "-q", root])
  await run("git", ["-C", root, "config", "user.name", "Git Test"])
  await run("git", ["-C", root, "config", "user.email", "git-test@example.invalid"])
  await run("git", ["-C", root, "config", "commit.gpgsign", "false"])
  return root
}

describe("GitService", () => {
  it("initializes a directory and creates and checks out branches with stash recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "cypheria-git-init-"))
    created.push(root)
    const service = new GitService(join(root, "cache"), join(root, "home"))
    expect((await service.init(root)).root).toBe(await realpath(root))
    await run("git", ["-C", root, "config", "user.name", "Git Test"])
    await run("git", ["-C", root, "config", "user.email", "git-test@example.invalid"])
    await run("git", ["-C", root, "config", "commit.gpgsign", "false"])
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "First commit")
    await expect(service.createBranch(root, "--force")).rejects.toThrow("Invalid Git branch")
    expect(await service.createBranch(root, "feature")).toBe("feature")
    expect((await service.checkout(root, "feature")).branch).toBe("feature")
    await writeFile(join(root, "file.txt"), "changed\n")
    await expect(service.checkout(root, "main")).rejects.toThrow("Working tree has changes")
    await expect(service.checkout(root, "missing", true)).rejects.toThrow()
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("changed\n")
    expect((await service.checkout(root, "main", true)).branch).toBe("main")
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("changed\n")
  }, 20_000)

  it("discovers nested workspaces and performs status, stage, diff, commit, and branches", async () => {
    const root = await repository()
    const nested = join(root, "src")
    await mkdir(nested)
    await writeFile(join(nested, "file.txt"), "first\n")
    const service = new GitService(join(root, "cache"), join(root, "home"))
    expect((await service.discover(nested)).root).toBe(await realpath(root))
    expect((await service.status(root)).entries).toContainEqual({
      code: "??",
      path: "src/file.txt",
    })
    await service.stage(root, ["src/file.txt"])
    expect(await service.diff(root, { staged: true })).toContain("+first")
    const head = await service.commit(root, "First commit")
    expect(head).toMatch(/^[a-f0-9]{40,64}$/u)
    expect((await service.status(root)).entries).toEqual([])
    expect(await service.branches(root)).toContainEqual({
      name: expect.any(String),
      current: true,
      commit: head,
    })
    await writeFile(join(nested, "file.txt"), "second\n")
    await service.stage(root, ["src/file.txt"])
    await service.unstage(root, ["src/file.txt"])
    expect((await service.status(root)).entries).toContainEqual({
      code: " M",
      path: "src/file.txt",
    })
  }, 20_000)

  it("rejects paths outside the repository, symlink parent escapes, and option-like refs", async () => {
    const root = await repository()
    const external = await mkdtemp(join(tmpdir(), "cypheria-git-external-"))
    created.push(external)
    const { symlink } = await import("node:fs/promises")
    await symlink(external, join(root, "outside"))
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await expect(service.stage(root, ["../outside.txt"])).rejects.toThrow("outside the repository")
    await expect(service.stage(root, ["outside/file.txt"])).rejects.toThrow("resolves outside")
    await expect(service.diff(root, { base: "--output=/tmp/unsafe" })).rejects.toThrow(
      "Invalid Git base"
    )
    await expect(service.push(root, { remote: "--mirror" })).rejects.toThrow("Invalid Git remote")
  })

  it("creates, snapshots, deletes, and restores only clean managed worktrees", async () => {
    const root = await repository()
    await writeFile(join(root, "file.txt"), "first\n")
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await service.stage(root, ["file.txt"])
    const first = await service.commit(root, "First commit")
    const worktree = await service.createWorktree(root)
    expect(worktree).toMatchObject({ head: first, managed: true, branch: null })
    expect(await service.worktrees(root)).toContainEqual(worktree)
    await writeFile(join(worktree.path, "file.txt"), "dirty\n")
    await expect(service.deleteWorktree(root, worktree.path)).rejects.toThrow("uncommitted changes")
    await writeFile(join(worktree.path, "file.txt"), "first\n")
    await expect(service.deleteWorktree(root, root)).rejects.toThrow("managed Cypheria worktree")
    await service.deleteWorktree(root, worktree.path)
    expect((await service.worktrees(root)).some((entry) => entry.path === worktree.path)).toBe(
      false
    )
    expect(await service.restoreWorktree(root, worktree.path)).toEqual(worktree)
    expect(await readFile(join(worktree.path, "file.txt"), "utf8")).toBe("first\n")
    await expect(service.restoreWorktree(root, worktree.path)).rejects.toThrow("already exists")
  }, 20_000)
})
