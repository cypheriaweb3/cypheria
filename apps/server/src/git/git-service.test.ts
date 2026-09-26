import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { DEFAULT_GIT_SETTINGS } from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentManager } from "../agent/agent-manager.js"
import type { ThreadManager } from "../thread/thread-manager.js"
import { GitExecutor } from "./git-executor.js"
import { GitService as BaseGitService } from "./git-service.js"
import { GitWorktreeService } from "./git-worktree-service.js"

const run = promisify(execFile)
const created: string[] = []
const services: BaseGitService[] = []

class GitService extends BaseGitService {
  constructor(...args: ConstructorParameters<typeof BaseGitService>) {
    super(...args)
    services.push(this)
  }
}

afterEach(async () => {
  for (const service of services.splice(0)) service.stop()
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
  it("generates a commit title using saved instructions and the managed Codex home", async () => {
    const root = await repository()
    await writeFile(join(root, "file.txt"), "base\n")
    await run("git", ["-C", root, "add", "file.txt"])
    await run("git", ["-C", root, "commit", "-qm", "Base"])
    await writeFile(join(root, "file.txt"), "changed\n")
    const script = join(root, "fake-codex.cjs")
    await writeFile(
      script,
      `const fs=require('node:fs'); let prompt=''; process.stdin.on('data', c=>prompt+=c); process.stdin.on('end', ()=>{ fs.writeFileSync('received-prompt.txt', prompt); const i=process.argv.indexOf('--output-last-message'); fs.writeFileSync(process.argv[i+1], JSON.stringify({title:'Describe change',body:''})); });`
    )
    const agents = {
      authTerminalSpec: async (
        _agentId: string,
        args: string[],
        extraEnvironment: Record<string, string>
      ) => ({
        command: process.execPath,
        args: [script, ...args],
        cwd: root,
        env: { ...process.env, ...extraEnvironment } as Record<string, string>,
      }),
    } as unknown as AgentManager
    const service = new GitService(join(root, "cache"), join(root, "home"), { agents }, () => ({
      ...DEFAULT_GIT_SETTINGS,
      commitInstructions: "Use imperative mood.",
    }))
    expect(await service.generateText(root, "commit")).toEqual({
      title: "Describe change",
      body: "",
    })
    const prompt = await readFile(join(root, "received-prompt.txt"), "utf8")
    expect(prompt).toContain("Use imperative mood.")
    expect(prompt).toContain("+changed")
    service.stop()
  })

  it("reports Git availability and safe remote and branch queries", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    const commit = await service.commit(root, "Base")
    await service.createBranch(root, "feature")
    await run("git", [
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "https://secret@example.com/org/repo.git",
    ])
    expect(await service.availability(root)).toMatchObject({ available: true })
    expect(await service.remotes(root)).toEqual([
      { name: "origin", host: "example.com", repository: "org/repo" },
    ])
    expect(await service.branchExists(root, "feature", "local")).toBe(true)
    expect(await service.branchExists(root, "missing", "local")).toBe(false)
    expect(await service.branchCommits(root, "feature")).toMatchObject([
      { id: commit, subject: "Base" },
    ])
  }, 20_000)

  it("notifies clients when an external Git worktree change invalidates cached metadata", async () => {
    const root = await repository()
    const events: string[] = []
    const service = new GitService(join(root, "cache"), join(root, "home"), {
      publishChanged: (message) => events.push(message.payload.root),
    })
    try {
      await service.status(root)
      await writeFile(join(root, "external.txt"), "new\n")
      await expect.poll(() => events.length, { timeout: 3000 }).toBeGreaterThan(0)
      expect(events).toContain(await realpath(root))
    } finally {
      service.stop()
    }
  })

  it("applies a patch to the worktree without changing the real index", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "file.txt"), "updated\n")
    const diff = await service.diff(root)
    await run("git", ["-C", root, "restore", "--worktree", "--", "file.txt"])
    const result = await service.applyPatch(root, { diff, target: "unstaged" })
    expect(result).toMatchObject({ status: "success", appliedPaths: ["file.txt"] })
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("updated\n")
    expect((await service.status(root)).entries).toContainEqual({ code: " M", path: "file.txt" })
    const nested =
      "diff --git a/nested/new.txt b/nested/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/nested/new.txt\n@@ -0,0 +1 @@\n+hello\n"
    expect(
      await service.applyPatch(root, { diff: nested, target: "unstaged", atomic: true })
    ).toMatchObject({ status: "success" })
    expect(await readFile(join(root, "nested", "new.txt"), "utf8")).toBe("hello\n")
  }, 20_000)

  it("audits mutating requests without storing Git content", async () => {
    const root = await repository()
    const events: Array<{
      eventType: string
      correlationId?: string | null
      payloadSummary?: string | null
    }> = []
    const service = new GitService(join(root, "cache"), join(root, "home"), {
      audit: {
        append: async (input) => {
          events.push(input)
          return input as never
        },
      },
    })
    await writeFile(join(root, "file.txt"), "private content\n")
    const responses: unknown[] = []
    await service.handle(
      {
        type: "git.stage.request",
        requestId: "stage-1",
        payload: { cwd: root, paths: ["file.txt"] },
      },
      (response) => responses.push(response)
    )
    await service.handle(
      {
        type: "git.stage.request",
        requestId: "stage-2",
        payload: { cwd: root, paths: ["missing.txt"] },
      },
      (response) => responses.push(response)
    )
    expect(responses).toMatchObject([{ payload: { ok: true } }, { payload: { ok: false } }])
    expect(events.map((event) => [event.correlationId, event.eventType])).toEqual([
      ["stage-1", "git.stage.started"],
      ["stage-1", "git.stage.succeeded"],
      ["stage-2", "git.stage.started"],
      ["stage-2", "git.stage.failed"],
    ])
    expect(JSON.stringify(events)).not.toContain("private content")
    expect(JSON.stringify(events)).not.toContain(root)
    const unavailableAudit = new GitService(join(root, "cache"), join(root, "home"), {
      audit: {
        append: async () => {
          throw new Error("Audit unavailable")
        },
      },
    })
    await writeFile(join(root, "another.txt"), "local\n")
    const rejected: unknown[] = []
    await unavailableAudit.handle(
      {
        type: "git.stage.request",
        requestId: "stage-3",
        payload: { cwd: root, paths: ["another.txt"] },
      },
      (response) => rejected.push(response)
    )
    expect(rejected).toMatchObject([
      { payload: { ok: false, error: { code: "GIT_AUDIT_UNAVAILABLE" } } },
    ])
    expect(
      (await unavailableAudit.status(root)).entries.some(
        (entry) => entry.path === "another.txt" && entry.code === "??"
      )
    ).toBe(true)
  })

  it("can include unstaged files and record validated co-authors in a commit", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "staged.txt"), "staged\n")
    await service.stage(root, ["staged.txt"])
    await writeFile(join(root, "untracked.txt"), "untracked\n")
    await expect(
      service.commit(root, "Message", { includeUnstaged: true, coAuthors: ["Bad\nAuthor"] })
    ).rejects.toThrow("Invalid commit co-author")
    expect(
      (await service.status(root)).entries.some((entry) => entry.path === "untracked.txt")
    ).toBe(true)
    const commit = await service.commit(root, "Message", {
      includeUnstaged: true,
      coAuthors: ["Partner <partner@example.invalid>"],
    })
    expect(commit).toMatch(/^[a-f0-9]{40,64}$/u)
    const { stdout } = await run("git", ["-C", root, "show", "--pretty=full", "--stat", "HEAD"])
    expect(stdout).toContain("Co-authored-by: Partner <partner@example.invalid>")
    expect(stdout).toContain("untracked.txt")
  }, 20_000)

  it("ignores whitespace in review display without changing the mutation revision", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "one two\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "file.txt"), "one  two\n")
    const raw = await service.reviewFile(root, "unstaged", "file.txt")
    const filtered = await service.reviewFile(root, "unstaged", "file.txt", true)
    expect(raw.diff).toContain("+one  two")
    expect(filtered.diff).toBe("")
    expect(filtered.hunks).toEqual([])
    expect(filtered.revision).toBe(raw.revision)
    expect(
      await service.reviewLineCounts(root, { source: "unstaged", ignoreWhitespace: true })
    ).toEqual([])
  }, 20_000)

  it("counts staged, unstaged, and combined review lines", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "file.txt"), "first\nsecond\n")
    await service.stage(root, ["file.txt"])
    await writeFile(join(root, "file.txt"), "first\nsecond\nthird\n")
    expect(await service.reviewLineCounts(root, { source: "staged" })).toEqual([
      { path: "file.txt", additions: 1, deletions: 0 },
    ])
    expect(await service.reviewLineCounts(root, { source: "unstaged" })).toEqual([
      { path: "file.txt", additions: 1, deletions: 0 },
    ])
    expect(await service.reviewLineCounts(root, { source: "uncommitted" })).toEqual([
      { path: "file.txt", additions: 2, deletions: 0 },
    ])
  }, 20_000)
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

  it("compares diverged branches from their merge base using pinned commits", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "shared.txt"), "base\n")
    await service.stage(root, ["shared.txt"])
    const first = await service.commit(root, "Base")
    await run("git", ["-C", root, "branch", "-M", "main"])
    await service.createBranch(root, "feature")
    await writeFile(join(root, "main.txt"), "main\n")
    await service.stage(root, ["main.txt"])
    const main = await service.commit(root, "Main")
    await service.checkout(root, "feature")
    await writeFile(join(root, "feature.txt"), "one\ntwo\n")
    await service.stage(root, ["feature.txt"])
    const feature = await service.commit(root, "Feature")
    expect(await service.branchComparison(root, "main")).toEqual({
      base: main,
      head: feature,
      mergeBase: first,
      ahead: 1,
      behind: 1,
      files: [{ path: "feature.txt", additions: 2, deletions: 0 }],
    })
    await expect(service.branchComparison(root, "--bad")).rejects.toThrow("Invalid Git ref")
  }, 20_000)

  it("reads exact index entries and submodule gitlinks without opening their worktrees", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await mkdir(join(root, "src"))
    await writeFile(join(root, "src", "file.txt"), "content\n")
    await service.stage(root, ["src/file.txt"])
    const [entry] = await service.indexEntries(root, "src/file.txt")
    expect(entry).toMatchObject({ path: "src/file.txt", mode: "100644", stage: 0 })
    expect(entry?.objectId).toMatch(/^[a-f0-9]{40,64}$/u)
    expect(await service.indexEntries(root, "src")).toEqual([])
    await expect(service.indexEntries(root, "../outside")).rejects.toThrow("outside the repository")
    const head = await service.commit(root, "Base")
    await run("git", [
      "-C",
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      head,
      "vendor/lib",
    ])
    expect(await service.submodulePaths(root)).toEqual(["vendor/lib"])
    expect(await service.indexEntries(root, "vendor/lib")).toEqual([
      { path: "vendor/lib", mode: "160000", objectId: head, stage: 0 },
    ])
  }, 20_000)

  it("reports the worktree-local Git index modification time", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    expect(await service.indexInfo(root)).toEqual({ lastModified: 0 })
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    expect((await service.indexInfo(root)).lastModified).toBeGreaterThan(0)
  }, 20_000)

  it("resolves clone state and worktree refs and isolates worktree configuration", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    const commit = await service.commit(root, "Base")
    await service.createBranch(root, "feature")
    expect(await service.cloneState(root)).toEqual({
      shallow: false,
      partial: false,
      promisorRemote: null,
    })
    expect(await service.worktreeStartingRef(root, "feature")).toEqual({
      ref: "refs/heads/feature",
      commit,
    })
    await expect(service.worktreeStartingRef(root, "--bad")).rejects.toThrow(
      "Invalid Git start point"
    )
    const worktree = await service.createWorktree(root)
    expect(await service.configValue(worktree.path, "codex.localEnvironmentConfigPath")).toBeNull()
    await service.setConfigValue(
      worktree.path,
      "codex.localEnvironmentConfigPath",
      "/tmp/cypheria-env.json"
    )
    expect(await service.configValue(worktree.path, "codex.localEnvironmentConfigPath")).toBe(
      "/tmp/cypheria-env.json"
    )
    expect(await service.configValue(root, "codex.localEnvironmentConfigPath")).toBeNull()
    await service.setConfigValue(worktree.path, "codex.localEnvironmentConfigPath", null)
    expect(await service.configValue(worktree.path, "codex.localEnvironmentConfigPath")).toBeNull()
  }, 30_000)

  it("reports partial Review application without applying stale sections", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "first.txt"), "old\n")
    await writeFile(join(root, "second.txt"), "old\n")
    await service.stage(root, ["first.txt", "second.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "first.txt"), "new\n")
    await writeFile(join(root, "second.txt"), "new\n")
    const first = await service.reviewFile(root, "unstaged", "first.txt")
    const second = await service.reviewFile(root, "unstaged", "second.txt")
    await writeFile(join(root, "second.txt"), "newer\n")
    expect(
      await service.applyReviewSections(root, [
        { source: "unstaged", path: "first.txt", revision: first.revision, action: "stage" },
        { source: "unstaged", path: "second.txt", revision: second.revision, action: "stage" },
      ])
    ).toEqual([
      { path: "first.txt", status: "applied", undoId: null, error: null },
      {
        path: "second.txt",
        status: "stale",
        undoId: null,
        error: "File changed; refresh the review",
      },
    ])
    expect((await service.status(root)).entries).toEqual(
      expect.arrayContaining([
        { code: "M ", path: "first.txt" },
        { code: " M", path: "second.txt" },
      ])
    )
  }, 30_000)

  it("reads bounded UTF-8 blobs and blame metadata without exposing binary content", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "hello.txt"), "first\nsecond\n")
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 255, 1]))
    await service.stage(root, ["hello.txt", "binary.dat"])
    const commit = await service.commit(root, "Base")
    expect(await service.textBlob(root, commit, "hello.txt")).toEqual({
      status: "success",
      content: "first\nsecond\n",
    })
    expect(await service.textBlob(root, commit, "binary.dat")).toEqual({
      status: "unavailable",
    })
    await expect(service.textBlob(root, commit, "../outside")).rejects.toThrow(
      "outside the repository"
    )
    expect(await service.blameFile(root, "hello.txt")).toEqual([
      expect.objectContaining({ commitSha: commit, lineNumber: 1, author: "Git Test" }),
      expect.objectContaining({ commitSha: commit, lineNumber: 2, author: "Git Test" }),
    ])
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

  it("creates a detached worktree from a selected branch without switching the source", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    const first = await service.commit(root, "First")
    await service.createBranch(root, "base")
    await writeFile(join(root, "file.txt"), "second\n")
    await service.stage(root, ["file.txt"])
    const second = await service.commit(root, "Second")
    const worktree = await service.createWorktree(root, "base")
    expect(worktree.head).toBe(first)
    expect((await service.status(root)).head).toBe(second)
    expect(await readFile(join(worktree.path, "file.txt"), "utf8")).toBe("first\n")
  }, 20_000)

  it("copies ignored agent overrides and selected resources into a new worktree", async () => {
    const root = await repository()
    const service = new GitService(join(root, "cache"), join(root, "home"))
    await writeFile(join(root, ".gitignore"), "*.local\nAGENTS.override.md\n")
    await writeFile(join(root, "file.txt"), "tracked\n")
    await service.stage(root, [".gitignore", "file.txt"])
    await service.commit(root, "Base")
    await mkdir(join(root, "nested"))
    await writeFile(join(root, "nested", "AGENTS.override.md"), "agent instructions\n")
    await writeFile(join(root, "env.local"), "selected\n")
    await writeFile(join(root, "other.local"), "not selected\n")
    await writeFile(join(root, ".worktreeinclude"), "env.local\n")

    const worktree = await service.createWorktree(root)
    expect(await readFile(join(worktree.path, "nested", "AGENTS.override.md"), "utf8")).toBe(
      "agent instructions\n"
    )
    expect(await readFile(join(worktree.path, "env.local"), "utf8")).toBe("selected\n")
    await expect(readFile(join(worktree.path, "other.local"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  }, 20_000)

  it("transfers staged, unstaged, and untracked changes into a managed worktree", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-worktree-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, "file.txt"), "staged\n")
    await service.stage(root, ["file.txt"])
    await writeFile(join(root, "file.txt"), "unstaged\n")
    await writeFile(join(root, "new.txt"), "untracked\n")
    const worktree = await service.createWorktree(root, "HEAD", { includeChanges: true })
    expect(await readFile(join(worktree.path, "file.txt"), "utf8")).toBe("unstaged\n")
    expect(await readFile(join(worktree.path, "new.txt"), "utf8")).toBe("untracked\n")
    expect((await service.status(worktree.path)).entries).toEqual(
      expect.arrayContaining([
        { code: "MM", path: "file.txt" },
        { code: "??", path: "new.txt" },
      ])
    )
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("unstaged\n")
  }, 30_000)

  it("runs selected worktree setup and lets a failed setup be skipped", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-worktree-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(join(root, ".gitignore"), "environment.json\n")
    await service.stage(root, [".gitignore"])
    await service.commit(root, "Ignore environment")
    await writeFile(
      join(root, "environment.json"),
      JSON.stringify({
        version: 1,
        name: "Test",
        setup: { script: "export PATH=\"$PWD/tools:$PATH\"; printf 'ready' > setup.txt" },
      })
    )
    const waitForJob = async (id: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const job = service.worktreeJob(id)
        if (["ready", "failed", "cancelled"].includes(job.phase)) return job
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Worktree job did not finish")
    }
    const initial = await service.startWorktreeJob({
      cwd: root,
      environmentConfigPath: "environment.json",
    })
    const ready = await waitForJob(initial.id)
    expect(ready.phase).toBe("ready")
    if (!ready.path) throw new Error("Missing worktree path")
    expect(await readFile(join(ready.path, "setup.txt"), "utf8")).toBe("ready")
    expect(await service.configValue(ready.path, "codex.localEnvironmentConfigPath")).toBe(
      join(ready.path, "environment.json")
    )
    const gitDir = (
      await run("git", ["-C", ready.path, "rev-parse", "--absolute-git-dir"])
    ).stdout.trim()
    const shellEnvironment = JSON.parse(
      await readFile(join(gitDir, "codex-shell-environment.json"), "utf8")
    ) as { version: number; set: Record<string, string>; exclude: string[] }
    expect(shellEnvironment).toMatchObject({
      version: 1,
      set: { PATH: expect.stringContaining(`${ready.path}/tools:`) },
      exclude: [],
    })

    await writeFile(
      join(root, "environment.json"),
      JSON.stringify({ version: 1, name: "Test", setup: { script: "exit 7" } })
    )
    const failed = await service.startWorktreeJob({
      cwd: root,
      environmentConfigPath: "environment.json",
    })
    expect((await waitForJob(failed.id)).phase).toBe("failed")
    expect(["queued", "ready"]).toContain(service.retryWorktreeJob(failed.id, true).phase)
    expect((await waitForJob(failed.id)).phase).toBe("ready")
  }, 45_000)

  it("cancels a running worktree setup and permits skipping it", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-worktree-home-"))
    created.push(home)
    const service = new GitService(join(home, "cache"), home)
    await writeFile(join(root, "file.txt"), "base\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "Base")
    await writeFile(
      join(root, "environment.json"),
      JSON.stringify({ version: 1, name: "Slow", setup: { script: "exec sleep 5" } })
    )
    const job = await service.startWorktreeJob({
      cwd: root,
      environmentConfigPath: "environment.json",
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (service.worktreeJob(job.id).phase === "setting-up") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(service.worktreeJob(job.id).phase).toBe("setting-up")
    service.cancelWorktreeJob(job.id)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (service.worktreeJob(job.id).phase === "cancelled") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(service.worktreeJob(job.id).phase).toBe("cancelled")
    service.retryWorktreeJob(job.id, true)
    expect(service.worktreeJob(job.id).phase).toBe("ready")
  }, 20_000)

  it("moves any Agent Thread into and out of a managed worktree and syncs attachments", async () => {
    const root = await repository()
    const home = await mkdtemp(join(tmpdir(), "cypheria-git-handoff-"))
    created.push(home)
    const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf400"
    const thread = {
      id: threadId,
      agentId: "claude",
      agentSessionId: null,
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
    const threadAttachments = {
      attachPullRequest: vi.fn(),
      attachWorktree: vi.fn(),
      detachWorktree: vi.fn(),
    }
    const service = new GitService(join(home, "cache"), home, {
      agents: {} as AgentManager,
      threadAttachments,
      threads,
    })
    await writeFile(join(root, "file.txt"), "first\n")
    await service.stage(root, ["file.txt"])
    await service.commit(root, "First commit")
    const worktree = await service.createWorktree(root)
    await writeFile(join(root, "file.txt"), "first\nsecond\n")
    await service.stage(root, ["file.txt"])
    await writeFile(join(root, "untracked.txt"), "local\n")
    await service.moveThreadToWorktree(root, worktree.path, threadId, true)
    expect(thread.cwd).toBe(worktree.path)
    expect(await readFile(join(worktree.path, "file.txt"), "utf8")).toBe("first\nsecond\n")
    expect(await readFile(join(worktree.path, "untracked.txt"), "utf8")).toBe("local\n")
    expect(
      (await service.worktrees(root)).find((entry) => entry.path === worktree.path)?.ownerThreadId
    ).toBe(threadId)
    expect(threadAttachments.attachWorktree).toHaveBeenCalledWith(threadId, worktree.id)
    const records = new GitWorktreeService(new GitExecutor(join(home, "cache")), home)
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
    expect(threadAttachments.detachWorktree).toHaveBeenCalledWith(threadId, worktree.id)
    await run("git", ["-C", worktree.path, "reset", "--hard", "HEAD"])
    await run("git", ["-C", worktree.path, "clean", "-fd"])
    await service.deleteWorktree(root, worktree.path)
  }, 20_000)

  it("preserves a nested thread directory during worktree moves", async () => {
    const root = await repository()
    const nested = join(root, "packages", "app")
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, "file.txt"), "first\n")
    const threadId = "01984de2-8f74-7c91-a3b2-5c5e937cf401"
    const thread = {
      id: threadId,
      agentId: "codex",
      agentSessionId: "nested-thread",
      cwd: nested,
      activeTurn: null,
      pendingInteractions: [],
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
    await service.stage(root, ["packages/app/file.txt"])
    await service.commit(root, "Base")
    const worktree = await service.createWorktree(root)
    await service.moveThreadToWorktree(root, worktree.path, threadId)
    expect(thread.cwd).toBe(join(worktree.path, "packages", "app"))
    await service.moveThreadToWorktree(worktree.path, root, threadId)
    expect(thread.cwd).toBe(await realpath(nested))
  }, 20_000)
})
