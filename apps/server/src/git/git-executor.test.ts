import { describe, expect, it } from "vitest"
import { GitCommandError } from "./git-executor.js"

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
