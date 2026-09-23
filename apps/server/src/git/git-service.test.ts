import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import type { AgentManager } from "../agent/agent-manager.js"
import type { ThreadManager } from "../thread/thread-manager.js"
import { GitExecutor } from "./git-executor.js"
import { GitService } from "./git-service.js"
import { GitWorktreeService } from "./git-worktree-service.js"

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
  it("reports the current branch, upstream, default branch, and ahead count", async () => {
    const root = await repository()
    const remote = await mkdtemp(join(tmpdir(), "cypheria-git-remote-"))
    created.push(remote)
    await run("git", ["init", "--bare", "-q", remote])
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "First commit")
    await run("git", ["-C", root, "branch", "-M", "main"])
    await run("git", ["-C", root, "remote", "add", "origin", remote])
    await run("git", ["-C", root, "push", "-u", "origin", "main"])
    expect(await service.branchContext(root)).toEqual({
      current: "main",
      upstream: "origin/main",
      defaultBranch: "origin/main",
      ahead: 0,
      behind: 0,
    })
    await writeFile(join(root, "file.txt"), "second\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Second commit")
    expect(await service.branchContext(root)).toMatchObject({ ahead: 1, behind: 0 })
  }, 20_000)

  it("searches local and remote branches and checks out a remote tracking branch", async () => {
    const root = await repository()
    const remote = await mkdtemp(join(tmpdir(), "cypheria-git-remote-"))
    created.push(remote)
    await run("git", ["init", "--bare", "-q", remote])
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    const head = await service.commit(root, "First commit")
    await run("git", ["-C", root, "branch", "-M", "main"])
    await run("git", ["-C", root, "remote", "add", "origin", remote])
    await run("git", ["-C", root, "branch", "feature/search"])
    await run("git", ["-C", root, "push", "origin", "main", "feature/search"])
    await run("git", ["-C", root, "branch", "-D", "feature/search"])
    expect(await service.searchBranches(root, "FEATURE", 10)).toEqual([
      { name: "origin/feature/search", scope: "remote", current: false, commit: head },
    ])
    expect((await service.searchBranches(root, "", 1)).length).toBe(1)
    expect(await service.searchBranches(root, "head", 20)).toEqual([])
    expect((await service.checkout(root, "refs/remotes/origin/feature/search")).branch).toBe(
      "feature/search"
    )
    expect((await service.branchContext(root)).upstream).toBe("origin/feature/search")
  }, 20_000)

  it("reviews committed branch changes from the merge base and rejects stale diffs", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await mkdir(join(root, "removed"))
    await writeFile(join(root, "removed", "file.txt"), "old\n")
    await service.stage(root, ["removed/file.txt"])
    await service.commit(root, "Base")
    await run("git", ["-C", root, "branch", "-M", "main"])
    await service.createBranch(root, "feature")
    await service.checkout(root, "feature")
    await rm(join(root, "removed"), { recursive: true })
    await service.stage(root, ["removed"])
    await writeFile(join(root, "added.txt"), "new\n")
    await service.stage(root, ["added.txt"])
    const head = await service.commit(root, "Feature")
    const review = await service.branchReview(root, "main")
    expect(review.head).toBe(head)
    expect(review.entries).toEqual([
      { code: "A", path: "added.txt" },
      { code: "D", path: "removed/file.txt" },
    ])
    expect(
      await service.branchReviewDiff(root, {
        base: review.base,
        expectedHead: review.head,
        path: "removed/file.txt",
      })
    ).toContain("-old")
    await expect(
      service.branchReviewDiff(root, {
        base: review.base,
        expectedHead: review.head,
        path: "../other",
      })
    ).rejects.toThrow("outside the repository")
    await writeFile(join(root, "added.txt"), "newer\n")
    await service.stage(root, ["added.txt"])
    await service.commit(root, "Advance")
    await expect(
      service.branchReviewDiff(root, {
        base: review.base,
        expectedHead: review.head,
        path: "added.txt",
      })
    ).rejects.toThrow("Branch changed")
  }, 20_000)

  it("reviews a selected commit against its first parent, including a root commit", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    const first = await service.commit(root, "First")
    await writeFile(join(root, "file.txt"), "second\n")
    await service.stage(root, ["file.txt"])
    const second = await service.commit(root, "Second")
    expect((await service.commitList(root)).map(({ id }) => id)).toEqual([second, first])
    const rootReview = await service.commitReview(root, first)
    expect(rootReview.entries).toEqual([{ code: "A", path: "file.txt" }])
    expect(
      await service.commitReviewDiff(root, {
        base: rootReview.base,
        commit: first,
        path: "file.txt",
      })
    ).toContain("+first")
    const review = await service.commitReview(root, second)
    expect(review).toMatchObject({
      base: first,
      head: second,
      entries: [{ code: "M", path: "file.txt" }],
    })
    expect(
      await service.commitReviewDiff(root, { base: first, commit: second, path: "file.txt" })
    ).toContain("+second")
    await expect(
      service.commitReviewDiff(root, { base: second, commit: second, path: "file.txt" })
    ).rejects.toThrow("Commit review changed")
  }, 20_000)

  it("pins last-turn changes without modifying the real index", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-git-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "file.txt"), "before\n")
    const capture = await service.turnCaptureStart("thread-test", root)
    await writeFile(join(root, "file.txt"), "after\n")
    await writeFile(join(root, "new.txt"), "created\n")
    await service.turnCaptureComplete(capture, "turn-test")
    expect(await service.diff(root, { staged: true })).toBe("")
    const review = await service.lastTurnReview(root, "thread-test")
    expect(review?.entries).toEqual([
      { code: "M", path: "file.txt" },
      { code: "A", path: "new.txt" },
    ])
    if (!review) throw new Error("Expected last-turn review")
    await writeFile(join(root, "file.txt"), "later\n")
    const restarted = new GitService(join(home, "cache"), home)
    expect(
      await restarted.lastTurnReviewDiff(root, {
        threadId: "thread-test",
        base: review.base,
        head: review.head,
        path: "file.txt",
      })
    ).toContain("+after")
    await expect(
      restarted.lastTurnReviewDiff(root, {
        threadId: "thread-test",
        base: review.head,
        head: review.head,
        path: "file.txt",
      })
    ).rejects.toThrow("snapshot changed")
  }, 30_000)

  it("applies individual review sections and rejects stale file revisions", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    const original = `${Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join("\n")}\n`
    await writeFile(join(root, "file.txt"), original)
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(
      join(root, "file.txt"),
      original.replace("line 1\n", "first changed\n").replace("line 24\n", "last changed\n")
    )
    const snapshot = await service.reviewFile(root, "unstaged", "file.txt")
    expect(snapshot.hunks).toHaveLength(2)
    await service.applyReviewSection(root, {
      source: "unstaged",
      path: "file.txt",
      revision: snapshot.revision,
      action: "stage",
      hunkIndex: 0,
    })
    expect(await service.diff(root, { staged: true })).toContain("+first changed")
    expect(await service.diff(root, { staged: true })).not.toContain("+last changed")
    await expect(
      service.applyReviewSection(root, {
        source: "unstaged",
        path: "file.txt",
        revision: snapshot.revision,
        action: "stage",
        hunkIndex: 1,
      })
    ).rejects.toThrow("File changed")
    const staged = await service.reviewFile(root, "staged", "file.txt")
    await service.applyReviewSection(root, {
      source: "staged",
      path: "file.txt",
      revision: staged.revision,
      action: "unstage",
      hunkIndex: 0,
    })
    expect(await service.diff(root, { staged: true })).toBe("")
    const untracked = join(root, "untracked.txt")
    await writeFile(untracked, "new\n")
    const newFile = await service.reviewFile(root, "unstaged", "untracked.txt")
    expect(newFile.hunks).toEqual([])
    await service.applyReviewSection(root, {
      source: "unstaged",
      path: "untracked.txt",
      revision: newFile.revision,
      action: "stage",
    })
    expect(await service.diff(root, { staged: true, paths: ["untracked.txt"] })).toContain("+new")
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]))
    const binary = await service.reviewFile(root, "unstaged", "binary.bin")
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 3]))
    await expect(
      service.applyReviewSection(root, {
        source: "unstaged",
        path: "binary.bin",
        revision: binary.revision,
        action: "stage",
      })
    ).rejects.toThrow("File changed")
  }, 20_000)

  it("reverts a review section and restores it after a service restart", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-git-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    const original = `${Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join("\n")}\n`
    await writeFile(join(root, "file.txt"), original)
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    const changed = original
      .replace("line 1\n", "first changed\n")
      .replace("line 24\n", "last changed\n")
    await writeFile(join(root, "file.txt"), changed)
    const snapshot = await service.reviewFile(root, "unstaged", "file.txt")
    const undoId = await service.applyReviewSection(root, {
      source: "unstaged",
      path: "file.txt",
      revision: snapshot.revision,
      action: "revert",
      hunkIndex: 0,
    })
    expect(undoId).toMatch(/^[a-f0-9-]{36}$/u)
    if (!undoId) throw new Error("Expected a Git review undo ID")
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
      changed.replace("first changed\n", "line 1\n")
    )
    const restarted = new GitService(join(home, "cache"), home)
    expect(await restarted.reviewUndoList(root)).toEqual([
      { id: undoId, path: "file.txt", createdAt: expect.any(String) },
    ])
    await restarted.undoReviewRevert(root, undoId)
    expect(await restarted.reviewUndoList(root)).toEqual([])
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe(changed)
  }, 20_000)

  it("restores a reverted untracked file and rejects undo after subsequent edits", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-git-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    const path = join(root, "binary.bin")
    const bytes = Buffer.from([0, 1, 2, 255])
    await writeFile(path, bytes)
    const snapshot = await service.reviewFile(root, "unstaged", "binary.bin")
    const undoId = await service.applyReviewSection(root, {
      source: "unstaged",
      path: "binary.bin",
      revision: snapshot.revision,
      action: "revert",
    })
    if (!undoId) throw new Error("Expected a Git review undo ID")
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" })
    await service.undoReviewRevert(root, undoId)
    expect(await readFile(path)).toEqual(bytes)
    const secondSnapshot = await service.reviewFile(root, "unstaged", "binary.bin")
    const secondUndoId = await service.applyReviewSection(root, {
      source: "unstaged",
      path: "binary.bin",
      revision: secondSnapshot.revision,
      action: "revert",
    })
    if (!secondUndoId) throw new Error("Expected a Git review undo ID")
    await writeFile(path, Buffer.from([8, 9]))
    await expect(service.undoReviewRevert(root, secondUndoId)).rejects.toThrow("File changed")
  }, 60_000)

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
    expect(await service.diff(root, { paths: ["src/file.txt"] })).toContain("+first")
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
    await expect(service.diff(root, { paths: ["outside"] })).rejects.toThrow("regular file")
    await expect(service.diff(root, { base: "--output=/tmp/unsafe" })).rejects.toThrow(
      "Invalid Git base"
    )
    await expect(service.push(root, { remote: "--mirror" })).rejects.toThrow("Invalid Git remote")
  })

  it("classifies the origin without exposing its credentials or URL", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    expect(await service.origin(root)).toEqual({ provider: "none" })
    await run("git", ["-C", root, "remote", "add", "origin", "git@gitlab.com:team/project.git"])
    expect(await service.origin(root)).toEqual({ provider: "gitlab" })
    await run("git", [
      "-C",
      root,
      "remote",
      "set-url",
      "origin",
      "https://token@github.com/team/project.git",
    ])
    expect(await service.origin(root)).toEqual({ provider: "github" })
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
    const owner = "01984de2-8f74-7c91-a3b2-5c5e937cf400"
    const manager = new GitWorktreeService(new GitExecutor(join(root, "cache")), join(root, "home"))
    expect(
      await manager.setOwner(await service.discover(root), worktree.path, owner)
    ).toMatchObject({
      ownerThreadId: owner,
    })
    expect(await service.worktrees(root)).toContainEqual({ ...worktree, ownerThreadId: owner })
    await expect(service.deleteWorktree(root, worktree.path)).rejects.toThrow(
      "Move the owner thread"
    )
    await manager.setOwner(await service.discover(root), worktree.path, null)
    await writeFile(join(worktree.path, "file.txt"), "dirty\n")
    await expect(service.deleteWorktree(root, worktree.path)).rejects.toThrow("uncommitted changes")
    await writeFile(join(worktree.path, "file.txt"), "first\n")
    await expect(service.deleteWorktree(root, root)).rejects.toThrow("managed Cypheria worktree")
    await expect(service.deleteWorktree(worktree.path, worktree.path)).rejects.toThrow(
      "current worktree"
    )
    await service.deleteWorktree(root, worktree.path)
    expect(await service.worktrees(root)).toContainEqual({ ...worktree, active: false })
    expect(await service.restoreWorktree(root, worktree.path)).toEqual(worktree)
    expect(await readFile(join(worktree.path, "file.txt"), "utf8")).toBe("first\n")
    await expect(service.restoreWorktree(root, worktree.path)).rejects.toThrow("already exists")
  }, 20_000)

  it("moves a local Codex thread into and out of a managed worktree", async () => {
    const root = await repository()
    const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf400"
    const thread = {
      id: threadId,
      agentId: "codex",
      agentSessionId: "native-thread",
      cwd: root,
      activeTurn: null as { id: string } | null,
      pendingInteractions: [] as unknown[],
    }
    const threads = {
      get: async () => thread,
      moveWorkingDirectory: async (_id: string, cwd: string) => {
        thread.cwd = cwd
        return thread
      },
    } as unknown as ThreadManager
    const service = new GitService(join(root, "cache"), join(root, "home"), {
      agents: {} as AgentManager,
      threads,
    })
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "First commit")
    const worktree = await service.createWorktree(root)
    await service.moveThreadToWorktree(root, worktree.path, threadId)
    expect(thread.cwd).toBe(worktree.path)
    expect(
      (await service.worktrees(root)).find((entry) => entry.path === worktree.path)?.ownerThreadId
    ).toBe(threadId)
    const records = new GitWorktreeService(new GitExecutor(join(root, "cache")), join(root, "home"))
    await records.setOwner(await service.discover(root), worktree.path, null)
    await service.moveThreadToWorktree(worktree.path, worktree.path, threadId)
    expect(
      (await service.worktrees(root)).find((entry) => entry.path === worktree.path)?.ownerThreadId
    ).toBe(threadId)
    await expect(service.deleteWorktree(root, worktree.path)).rejects.toThrow(
      "Move the owner thread"
    )
    thread.activeTurn = { id: "active" }
    await expect(service.moveThreadToWorktree(root, root, threadId)).rejects.toThrow(
      "Finish the current turn"
    )
    thread.activeTurn = null
    await service.moveThreadToWorktree(worktree.path, root, threadId)
    expect(thread.cwd).toBe(await realpath(root))
    expect(
      (await service.worktrees(root)).find((entry) => entry.path === worktree.path)?.ownerThreadId
    ).toBeNull()
    await service.deleteWorktree(root, worktree.path)
  }, 20_000)
})
