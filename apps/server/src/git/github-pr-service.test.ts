import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { GitHubPrService } from "./github-pr-service.js"

const created: string[] = []
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("GitHubPrService", () => {
  it("checks account and repository access and parses PR data using fixed gh arguments", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-test-"))
    created.push(cwd)
    const binary = join(cwd, "gh")
    const log = join(cwd, "calls.jsonl")
    const stateFile = join(cwd, "pr-state.json")
    const pr = {
      number: 42,
      title: "Review change",
      body: "Body",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      headRefOid: "a".repeat(40),
      baseRefName: "main",
      updatedAt: "2026-09-23T00:00:00Z",
      author: { login: "tester" },
    }
    await writeFile(stateFile, JSON.stringify(pr))
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n")
const bodyFile = args.indexOf("--body-file")
if (bodyFile >= 0) fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ body: fs.readFileSync(args[bodyFile + 1], "utf8") }) + "\\n")
if (args[0] === "--version") process.stdout.write("gh version 1\\n")
else if (args[0] === "api" && args[1] === "graphql") {
  const request = JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1], "utf8"))
  if (request.query.includes("reviewThreads")) process.stdout.write(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: "THREAD_1", path: "file.txt", line: 2, isResolved: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [{ id: "COMMENT_1", body: "Please fix", createdAt: "2026-09-23T00:00:00Z", author: { login: "reviewer" } }], pageInfo: { hasNextPage: false } } }], pageInfo: { hasNextPage: false } } } } } }))
  else if (request.query.includes("addPullRequestReviewThreadReply")) process.stdout.write(JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: "COMMENT_2" } } } }))
  else if (request.query.includes("resolveReviewThread")) process.stdout.write(JSON.stringify({ data: { resolveReviewThread: { thread: { id: "THREAD_1" } } } }))
  else if (request.query.includes("updateIssueComment")) process.stdout.write(JSON.stringify({ data: { updateIssueComment: { issueComment: { id: "C1" } } } }))
  else if (request.query.includes("deleteIssueComment")) process.stdout.write(JSON.stringify({ data: { deleteIssueComment: { clientMutationId: null } } }))
}
else if (args[0] === "api" && args.includes("--method")) process.stdout.write(JSON.stringify({ id: 1 }))
else if (args[0] === "api") process.stdout.write("tester\\n")
else if (args[0] === "repo") process.stdout.write("org/repo\\n")
else if (args[1] === "list") process.stdout.write(args.includes("--head") && (args[args.indexOf("--head") + 1] === "other" || args.includes("open") && !args.includes("existing")) ? "[]" : ${JSON.stringify(JSON.stringify([pr]))})
else if (args[1] === "create") process.stdout.write("https://github.com/org/repo/pull/42\\n")
else if (args[1] === "checks") { process.stdout.write(JSON.stringify([{ bucket: "pending", completedAt: null, link: "https://github.com/org/repo/actions/runs/1", name: "build", startedAt: "2026-09-23T00:00:00Z", state: "IN_PROGRESS", workflow: "CI" }])); process.exit(8) }
else if (args[1] === "diff") process.stdout.write("diff --git a/file.txt b/file.txt\\n+new\\n")
else if (args[1] === "view" && args.includes("autoMergeRequest")) process.stdout.write(JSON.stringify({ autoMergeRequest: null }))
else if (args[1] === "view" && args.includes("comments,reviews")) process.stdout.write(JSON.stringify({ comments: [{ id: "C1", body: "Looks good", createdAt: "2026-09-23T00:00:00Z", author: { login: "tester" } }], reviews: [{ id: "R1", body: "Approved", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", author: { login: "reviewer" } }] }))
else if (args[1] === "edit" || args[1] === "merge") process.stdout.write("")
else process.stdout.write(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"))
`
    )
    await chmod(binary, 0o755)
    const service = new GitHubPrService(binary)
    expect(await service.availability(cwd)).toEqual({
      installed: true,
      authenticated: true,
      account: "tester",
      repository: "org/repo",
      error: null,
    })
    expect(await service.list(cwd, "all", 5)).toEqual([pr])
    expect(await service.list(cwd, "closed", 10, "bug fix")).toEqual([pr])
    expect(await service.list(cwd, "open", 200, "review-requested:@me")).toEqual([pr])
    expect(await service.forBranch(cwd, "feature")).toEqual(pr)
    expect(await service.forBranch(cwd, "tester:feature")).toEqual(pr)
    expect(await service.forBranch(cwd, "other")).toBeNull()
    expect(
      (await readFile(log, "utf8")).split("\n").some((line) => line.includes('"--author"'))
    ).toBe(false)
    expect(await service.read(cwd, 42)).toEqual(pr)
    expect(await service.diff(cwd, 42, pr.headRefOid)).toContain("+new")
    expect(await service.autoMergeEnabled(cwd, 42)).toBe(false)
    expect(await service.checks(cwd, 42)).toEqual([
      {
        bucket: "pending",
        completedAt: null,
        link: "https://github.com/org/repo/actions/runs/1",
        name: "build",
        startedAt: "2026-09-23T00:00:00Z",
        state: "IN_PROGRESS",
        workflow: "CI",
      },
    ])
    expect(await service.activity(cwd, 42)).toEqual({
      comments: [
        { id: "C1", body: "Looks good", author: "tester", createdAt: "2026-09-23T00:00:00Z" },
      ],
      reviews: [
        {
          id: "R1",
          body: "Approved",
          author: "reviewer",
          state: "APPROVED",
          submittedAt: "2026-09-23T00:00:00Z",
        },
      ],
    })
    expect(await service.threads(cwd, 42, pr.headRefOid)).toEqual({
      threads: [
        {
          id: "THREAD_1",
          path: "file.txt",
          line: 2,
          isResolved: false,
          canResolve: true,
          canUnresolve: false,
          comments: [
            {
              id: "COMMENT_1",
              body: "Please fix",
              author: "reviewer",
              createdAt: "2026-09-23T00:00:00Z",
            },
          ],
        },
      ],
      truncated: false,
    })
    await service.threadAction(cwd, {
      number: 42,
      expectedHead: pr.headRefOid,
      action: "reply",
      threadId: "THREAD_1",
      body: "Fixed",
    })
    await service.threadAction(cwd, {
      number: 42,
      expectedHead: pr.headRefOid,
      action: "resolve",
      threadId: "THREAD_1",
    })
    await service.threadAction(cwd, {
      number: 42,
      expectedHead: pr.headRefOid,
      action: "inline",
      path: "file.txt",
      line: 2,
      side: "RIGHT",
      body: "Please fix",
    })
    await expect(
      service.threadAction(cwd, {
        number: 42,
        expectedHead: pr.headRefOid,
        action: "reply",
        threadId: "OTHER",
        body: "Wrong",
      })
    ).rejects.toThrow("unavailable")
    await expect(
      service.threadAction(cwd, {
        number: 42,
        expectedHead: "b".repeat(40),
        action: "resolve",
        threadId: "THREAD_1",
      })
    ).rejects.toThrow("head changed")
    await service.comment(cwd, 42, pr.headRefOid, "Please check this")
    await service.commentAction(cwd, {
      number: 42,
      expectedHead: pr.headRefOid,
      nodeId: "C1",
      commentType: "comment",
      action: "update",
      body: "Revised comment",
    })
    await service.commentAction(cwd, {
      number: 42,
      expectedHead: pr.headRefOid,
      nodeId: "C1",
      commentType: "comment",
      action: "delete",
    })
    await expect(
      service.commentAction(cwd, {
        number: 42,
        expectedHead: pr.headRefOid,
        nodeId: "COMMENT_1",
        commentType: "review_comment",
        action: "delete",
      })
    ).rejects.toThrow("unavailable for this account")
    await service.review(cwd, 42, pr.headRefOid, "approve", "Approved")
    expect(
      await service.create(cwd, {
        head: "feature",
        base: "main",
        title: "Review change",
        body: "Line 1\nLine 2",
        draft: true,
      })
    ).toEqual(pr)
    expect(
      await service.update(cwd, 42, {
        expectedHead: pr.headRefOid,
        title: "New title",
        body: "Updated body",
      })
    ).toEqual(pr)
    await service.reviewer(cwd, 42, pr.headRefOid, "reviewer", "add")
    await service.reviewer(cwd, 42, pr.headRefOid, "org/team", "remove")
    expect(await service.merge(cwd, 42, pr.headRefOid, "squash")).toEqual(pr)
    await service.toggleAutoMerge(cwd, 42, pr.headRefOid, true, "squash")
    await service.toggleAutoMerge(cwd, 42, pr.headRefOid, false, "merge")
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(calls).toContainEqual([
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "5",
      "--json",
      expect.any(String),
    ])
    expect(calls).toContainEqual([
      "pr",
      "list",
      "--state",
      "closed",
      "--limit",
      "10",
      "--search",
      "bug fix",
      "--json",
      expect.any(String),
    ])
    expect(calls).toContainEqual([
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--search",
      "review-requested:@me",
      "--json",
      expect.any(String),
    ])
    expect(calls).toContainEqual([
      "pr",
      "list",
      "--head",
      "feature",
      "--state",
      "all",
      "--limit",
      "100",
      "--json",
      expect.any(String),
    ])
    expect(calls).toContainEqual(["pr", "view", "42", "--json", expect.any(String)])
    expect(calls).toContainEqual(["pr", "diff", "42", "--patch"])
    expect(calls).toContainEqual(["pr", "checks", "42", "--json", expect.any(String)])
    expect(calls).toContainEqual(["pr", "view", "42", "--json", "comments,reviews"])
    expect(calls).toContainEqual(expect.arrayContaining(["pr", "comment", "42", "--body-file"]))
    expect(calls).toContainEqual(
      expect.arrayContaining(["pr", "review", "42", "--approve", "--body-file"])
    )
    expect(calls).toContainEqual(
      expect.arrayContaining(["pr", "create", "--head", "feature", "--base", "main", "--draft"])
    )
    expect(calls).toContainEqual({ body: "Line 1\nLine 2" })
    expect(calls).toContainEqual({ body: "Updated body" })
    expect(calls).toContainEqual(["pr", "edit", "42", "--add-reviewer", "reviewer"])
    expect(calls).toContainEqual(["pr", "edit", "42", "--remove-reviewer", "org/team"])
    expect(calls).toContainEqual([
      "pr",
      "merge",
      "42",
      "--squash",
      "--match-head-commit",
      pr.headRefOid,
    ])
    expect(calls).toContainEqual([
      "pr",
      "merge",
      "42",
      "--auto",
      "--squash",
      "--match-head-commit",
      pr.headRefOid,
    ])
    expect(calls).toContainEqual(["pr", "merge", "42", "--disable-auto"])
    await expect(
      service.create(cwd, { head: "--bad", base: "main", title: "Title", body: "" })
    ).rejects.toThrow("Invalid GitHub head")
    await expect(
      service.create(cwd, { head: "existing", base: "main", title: "Title", body: "" })
    ).rejects.toThrow("already exists")
    await expect(service.update(cwd, 42, { expectedHead: pr.headRefOid })).rejects.toThrow(
      "No GitHub PR changes"
    )
    await expect(
      service.update(cwd, 42, { expectedHead: "b".repeat(40), title: "Stale" })
    ).rejects.toThrow("head changed")
    await expect(service.reviewer(cwd, 42, pr.headRefOid, "../bad", "add")).rejects.toThrow(
      "Invalid GitHub reviewer"
    )
    await expect(service.reviewer(cwd, 42, "b".repeat(40), "reviewer", "add")).rejects.toThrow(
      "head changed"
    )
    await expect(service.merge(cwd, 42, "stale", "merge")).rejects.toThrow("Invalid expected")
    await expect(service.list(cwd, "open", 501)).rejects.toThrow("list limit")
    await expect(service.comment(cwd, 42, "b".repeat(40), "Stale")).rejects.toThrow("head changed")
    await expect(service.diff(cwd, 42, "b".repeat(40))).rejects.toThrow("head changed")
    await expect(service.review(cwd, 42, pr.headRefOid, "request_changes", " ")).rejects.toThrow(
      "body is required"
    )
    await service.setState(cwd, 42, pr.headRefOid, "close")
    await service.setState(cwd, 42, pr.headRefOid, "draft")
    await writeFile(stateFile, JSON.stringify({ ...pr, isDraft: true }))
    await service.setState(cwd, 42, pr.headRefOid, "ready")
    await writeFile(stateFile, JSON.stringify({ ...pr, state: "CLOSED" }))
    await service.setState(cwd, 42, pr.headRefOid, "reopen")
    await expect(service.setState(cwd, 42, "b".repeat(40), "reopen")).rejects.toThrow(
      "head changed"
    )
    const stateCalls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(stateCalls).toContainEqual(["pr", "close", "42"])
    expect(stateCalls).toContainEqual(["pr", "ready", "42", "--undo"])
    expect(stateCalls).toContainEqual(["pr", "ready", "42"])
    expect(stateCalls).toContainEqual(["pr", "reopen", "42"])
  })

  it("reports an unavailable CLI without treating it as an authenticated account", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-missing-"))
    created.push(cwd)
    expect(await new GitHubPrService(join(cwd, "missing-gh")).availability(cwd)).toMatchObject({
      installed: false,
      authenticated: false,
      repository: null,
    })
  })

  it("loads all review thread and comment pages before exposing the discussion", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-pages-"))
    created.push(cwd)
    const binary = join(cwd, "gh")
    const pr = {
      number: 42,
      title: "Paged",
      body: "",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      headRefOid: "a".repeat(40),
      baseRefName: "main",
      updatedAt: "2026-09-23T00:00:00Z",
      author: { login: "tester" },
    }
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
if (args[1] === "view") process.stdout.write(${JSON.stringify(JSON.stringify(pr))})
else {
  const request = JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1], "utf8"))
  const note = (id) => ({ id, body: id, createdAt: "2026-09-23T00:00:00Z", author: { login: "tester" } })
  const comments = (nodes, more, cursor) => ({ nodes, pageInfo: { hasNextPage: more, endCursor: cursor } })
  const thread = (id, notes) => ({ id, path: "file.txt", line: 1, isResolved: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: notes })
  let data
  if (request.query.includes("node(id:")) data = { node: { comments: comments([note("C2")], false, "note2") } }
  else if (request.variables.cursor === "thread1") data = { repository: { pullRequest: { reviewThreads: { nodes: [thread("T2", comments([note("C3")], false, "note3"))], pageInfo: { hasNextPage: false, endCursor: "thread2" } } } } }
  else data = { repository: { pullRequest: { reviewThreads: { nodes: [thread("T1", comments([note("C1")], true, "note1"))], pageInfo: { hasNextPage: true, endCursor: "thread1" } } } } }
  process.stdout.write(JSON.stringify({ data }))
}
`
    )
    await chmod(binary, 0o755)
    const result = await new GitHubPrService(binary).threads(cwd, 42, pr.headRefOid)
    expect(result.truncated).toBe(false)
    expect(result.threads.map((thread) => thread.id)).toEqual(["T1", "T2"])
    expect(result.threads[0]?.comments.map((comment) => comment.id)).toEqual(["C1", "C2"])
  })

  it("reads exact PR revisions and rejects stale or unsafe file requests", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-revisions-"))
    created.push(cwd)
    const binary = join(cwd, "gh")
    const head = "a".repeat(40)
    const base = "b".repeat(40)
    const mergeBase = "c".repeat(40)
    const pr = {
      number: 42,
      title: "Revisions",
      body: "",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      headRefOid: head,
      baseRefName: "main",
      updatedAt: "2026-09-23T00:00:00Z",
      author: { login: "tester" },
    }
    await writeFile(
      binary,
      `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[1] === "view") process.stdout.write(${JSON.stringify(JSON.stringify(pr))})
else if (args[1]?.includes("/pulls/42")) process.stdout.write(JSON.stringify({ base: { sha: ${JSON.stringify(base)} }, head: { sha: ${JSON.stringify(head)} } }))
else if (args.includes("--slurp")) process.stdout.write(JSON.stringify([{ merge_base_commit: { sha: ${JSON.stringify(mergeBase)} }, commits: [{ sha: ${JSON.stringify(head)}, parents: [{ sha: ${JSON.stringify(mergeBase)} }], commit: { message: "First line\\nBody" } }] }]))
else if (args[1]?.includes("/compare/")) process.stdout.write("diff --git a/file.txt b/file.txt\\n+new\\n")
else if (args[1]?.includes("/contents/")) process.stdout.write(JSON.stringify({ content: "SGVsbG8=", encoding: "base64", size: 5 }))
`
    )
    await chmod(binary, 0o755)
    const service = new GitHubPrService(binary)
    expect(await service.revisionSnapshot(cwd, 42, head)).toEqual({
      baseRevision: base,
      headRevision: head,
      mergeBaseRevision: mergeBase,
      commits: [{ sha: head, parentSha: mergeBase, title: "First line" }],
    })
    expect(await service.revisionDiff(cwd, 42, head, mergeBase, head)).toContain("+new")
    expect(await service.revisionFile(cwd, 42, head, mergeBase, head, null, "file.txt")).toEqual({
      status: "success",
      baseContent: "",
      headContent: "Hello",
    })
    await expect(
      service.revisionFile(cwd, 42, head, mergeBase, head, "../secret", "file.txt")
    ).rejects.toThrow("Invalid GitHub revision file path")
    await expect(service.revisionSnapshot(cwd, 42, "d".repeat(40))).rejects.toThrow("head changed")
  })

  it("reads PR metadata, paged review status, and account-scoped user suggestions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-insights-"))
    created.push(cwd)
    const binary = join(cwd, "gh")
    const head = "a".repeat(40)
    const pr = {
      number: 42,
      title: "Insights",
      body: "",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      headRefOid: head,
      baseRefName: "main",
      updatedAt: "2026-09-23T00:00:00Z",
      author: { login: "tester" },
    }
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
if (args[1] === "view") process.stdout.write(${JSON.stringify(JSON.stringify(pr))})
else {
  const request = JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1], "utf8"))
  let data
  if (request.query.includes("mergeCommitAllowed")) data = { viewer: { login: "tester" }, repository: { mergeCommitAllowed: true, squashMergeAllowed: true, pullRequest: { additions: 4, deletions: 2, changedFiles: 1, headRefOid: ${JSON.stringify(head)}, author: { login: "tester", avatarUrl: null }, createdAt: "2026-09-23T00:00:00Z", autoMergeRequest: null } } }
  else if (request.query.includes("reviewDecision")) data = { repository: { pullRequest: { reviewDecision: "REVIEW_REQUIRED", reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "reviewer" } }], pageInfo: { hasNextPage: false } }, reviews: request.variables.cursor ? { nodes: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-09-24T00:00:00Z" }], pageInfo: { hasNextPage: false, endCursor: "page2" } } : { nodes: [{ author: { login: "tester" }, state: "COMMENTED", submittedAt: "2026-09-23T00:00:00Z" }], pageInfo: { hasNextPage: true, endCursor: "page1" } } } } }
  else if (request.query.includes("collaborators")) data = { repository: { collaborators: { edges: [{ node: { login: "reviewer", avatarUrl: null } }] } } }
  else data = { repository: { mentionableUsers: { nodes: [{ login: "reviewer", avatarUrl: null }] }, pullRequest: { participants: { nodes: [{ login: "reviewer", avatarUrl: null }] } } } }
  process.stdout.write(JSON.stringify({ data }))
}
`
    )
    await chmod(binary, 0o755)
    const service = new GitHubPrService(binary)
    expect(await service.metadata(cwd, 42, head)).toMatchObject({
      additions: 4,
      deletions: 2,
      changedFiles: 1,
      isAuthor: true,
      allowedMergeMethods: ["squash", "merge"],
    })
    expect(await service.reviewStatus(cwd, 42, head)).toMatchObject({
      reviewDecision: "REVIEW_REQUIRED",
      truncated: false,
      reviewRequests: [{ type: "user", login: "reviewer" }],
      reviews: [{ state: "COMMENTED" }, { state: "APPROVED" }],
    })
    expect(await service.userSearch(cwd, 42, head, "rev", "collaborators")).toEqual([
      { login: "reviewer", avatarUrl: null },
    ])
    expect(await service.userSearch(cwd, 42, head, "rev", "mentions")).toEqual([
      { login: "reviewer", avatarUrl: null },
    ])
  })

  it("finds related PR branches and reads revision-bound attributes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cypheria-gh-stack-"))
    created.push(cwd)
    const binary = join(cwd, "gh")
    const head = "a".repeat(40)
    const pr = {
      number: 42,
      title: "First",
      body: "",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      headRefOid: head,
      baseRefName: "main",
      updatedAt: "2026-09-23T00:00:00Z",
      author: { login: "tester" },
    }
    const base = { ref: "main", repo: { id: 1, owner: { login: "org" } } }
    const first = {
      number: 42,
      title: "First",
      draft: false,
      state: "open",
      base,
      head: { ref: "feature", repo: base.repo },
    }
    const second = {
      number: 43,
      title: "Second",
      draft: true,
      state: "open",
      base: { ref: "feature", repo: base.repo },
      head: { ref: "next", repo: base.repo },
    }
    await writeFile(
      binary,
      `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[1] === "view") process.stdout.write(${JSON.stringify(JSON.stringify(pr))})
else if (args[1] === "graphql") process.stdout.write(JSON.stringify({ data: { repository: { f0: { text: "*.txt text", isTruncated: false }, f1: { text: "* text", isTruncated: false } } } }))
else if (args[1]?.includes("pulls/42")) process.stdout.write(${JSON.stringify(JSON.stringify(first))})
else if (args[1]?.includes("base=feature")) process.stdout.write(${JSON.stringify(JSON.stringify([second]))})
else if (args[1]?.includes("head=org%3Afeature")) process.stdout.write(${JSON.stringify(JSON.stringify([first]))})
else process.stdout.write("[]")
`
    )
    await chmod(binary, 0o755)
    const service = new GitHubPrService(binary)
    expect(await service.stack(cwd, 42, head)).toEqual([
      {
        number: 42,
        title: "First",
        isDraft: false,
        baseBranch: "main",
        headBranch: "feature",
        parentNumber: null,
      },
      {
        number: 43,
        title: "Second",
        isDraft: true,
        baseBranch: "feature",
        headBranch: "next",
        parentNumber: 42,
      },
    ])
    expect(await service.attributes(cwd, 42, head, ["src/file.txt"])).toEqual([
      { basePath: "src", contents: "*.txt text" },
      { basePath: "", contents: "* text" },
    ])
    await expect(service.attributes(cwd, 42, head, ["../secret"])).rejects.toThrow(
      "Invalid GitHub PR path"
    )
  })
})
