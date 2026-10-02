import type { CypheriaApi } from "@cypheria/client"
import { describe, expect, it, vi } from "vitest"

import { commitChanges, hasCommittableChanges, parseCoAuthors } from "./git-commit-actions.js"

const fakeGit = (push = vi.fn(async () => "")) => {
  const git = {
    commit: vi.fn(async () => ({})),
    generateText: vi.fn(async () => ({ title: "Generated title" })),
    push,
  }
  return { git, typed: git as unknown as CypheriaApi["git"] }
}

describe("hasCommittableChanges", () => {
  const entries = [{ code: " M" }, { code: "??" }]
  it("takes staged changes only unless unstaged ones are included", () => {
    expect(hasCommittableChanges(entries, false)).toBe(false)
    expect(hasCommittableChanges([...entries, { code: "A " }], false)).toBe(true)
    expect(hasCommittableChanges(entries, true)).toBe(true)
    expect(hasCommittableChanges([], true)).toBe(false)
  })
})

describe("parseCoAuthors", () => {
  it("splits on semicolons and drops blanks", () => {
    expect(parseCoAuthors(" A <a@x> ;; B <b@x> ;")).toEqual(["A <a@x>", "B <b@x>"])
  })
})

describe("commitChanges", () => {
  it("commits with the typed message and does not push", async () => {
    const { git, typed } = fakeGit()
    await commitChanges(typed, "/repo", { includeUnstaged: true, message: " Fix it ", push: false })
    expect(git.commit).toHaveBeenCalledWith("/repo", {
      coAuthors: [],
      includeUnstaged: true,
      message: "Fix it",
    })
    expect(git.generateText).not.toHaveBeenCalled()
    expect(git.push).not.toHaveBeenCalled()
  })

  it("asks the Server to write a blank message, then pushes", async () => {
    const { git, typed } = fakeGit()
    await commitChanges(typed, "/repo", { includeUnstaged: false, message: "  ", push: true })
    expect(git.generateText).toHaveBeenCalledWith("/repo", "commit")
    expect(git.commit).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ message: "Generated title" })
    )
    expect(git.push).toHaveBeenCalledWith("/repo")
  })

  it("says the commit stays when only the push fails", async () => {
    const { typed } = fakeGit(
      vi.fn(async () => {
        throw new Error("rejected")
      })
    )
    await expect(
      commitChanges(typed, "/repo", { includeUnstaged: false, message: "m", push: true })
    ).rejects.toThrow(/Commit succeeded; push failed.*rejected/u)
  })
})
