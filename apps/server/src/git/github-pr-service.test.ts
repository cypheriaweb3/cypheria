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
else if (args[0] === "api") process.stdout.write("tester\\n")
else if (args[0] === "repo") process.stdout.write("org/repo\\n")
else if (args[1] === "list") process.stdout.write(args.includes("--head") && !args.includes("existing") ? "[]" : ${JSON.stringify(JSON.stringify([pr]))})
else if (args[1] === "create") process.stdout.write("https://github.com/org/repo/pull/42\\n")
else if (args[1] === "checks") { process.stdout.write(JSON.stringify([{ bucket: "pending", completedAt: null, link: "https://github.com/org/repo/actions/runs/1", name: "build", startedAt: "2026-09-23T00:00:00Z", state: "IN_PROGRESS", workflow: "CI" }])); process.exit(8) }
else if (args[1] === "diff") process.stdout.write("diff --git a/file.txt b/file.txt\\n+new\\n")
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
    expect(await service.read(cwd, 42)).toEqual(pr)
    expect(await service.diff(cwd, 42, pr.headRefOid)).toContain("+new")
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
    await service.comment(cwd, 42, pr.headRefOid, "Please check this")
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
})
