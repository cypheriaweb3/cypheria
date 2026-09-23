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
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n")
if (args[0] === "--version") process.stdout.write("gh version 1\\n")
else if (args[0] === "api") process.stdout.write("tester\\n")
else if (args[0] === "repo") process.stdout.write("org/repo\\n")
else if (args[1] === "list") process.stdout.write(${JSON.stringify(JSON.stringify([pr]))})
else process.stdout.write(${JSON.stringify(JSON.stringify(pr))})
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
    expect(await service.read(cwd, 42)).toEqual(pr)
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
    expect(calls).toContainEqual(["pr", "view", "42", "--json", expect.any(String)])
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
