import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { describe, expect, it } from "vitest"
import { GitCommandError, resolveExecutable } from "./git-executor.js"

describe("GitCommandError", () => {
  it.each([
    ["fatal: Authentication failed", "authentication"],
    ["! [rejected] main -> main (non-fast-forward)", "rejected"],
    ["fatal: The current branch has no upstream branch", "missing-upstream"],
    ["nothing to commit, working tree clean", "nothing-to-commit"],
    ["error: Your local changes would be overwritten by checkout", "conflict"],
  ] as const)("classifies %s", (stderr, kind) => {
    expect(new GitCommandError(["push"], "", stderr, new Error(stderr)).kind).toBe(kind)
  })
})

describe("resolveExecutable", () => {
  it.skipIf(process.platform === "win32")(
    "returns the first executable on PATH and leaves paths alone",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cypheria-exec-"))
      try {
        const first = join(root, "first")
        const second = join(root, "second")
        await mkdir(first)
        await mkdir(second)
        await writeFile(join(first, "tool"), "not executable")
        await writeFile(join(second, "tool"), "#!/bin/sh\n")
        await chmod(join(second, "tool"), 0o755)
        const path = ["relative", first, second].join(delimiter)
        expect(resolveExecutable("tool", path)).toBe(join(second, "tool"))
        expect(resolveExecutable("missing-tool", path)).toBe("missing-tool")
        expect(resolveExecutable("/usr/bin/env", path)).toBe("/usr/bin/env")
      } finally {
        await rm(root, { force: true, recursive: true })
      }
    }
  )
})
