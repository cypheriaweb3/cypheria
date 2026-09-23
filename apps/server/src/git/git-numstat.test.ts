import { describe, expect, it } from "vitest"
import { combineGitNumstats, parseGitNumstat } from "./git-numstat.js"

describe("Git numstat", () => {
  it("parses plain, renamed, and binary paths", () => {
    expect(
      parseGitNumstat("2\t1\tplain.txt\0" + "3\t0\t\0old.txt\0new.txt\0" + "-\t-\tbinary.bin\0")
    ).toEqual([
      { path: "plain.txt", additions: 2, deletions: 1 },
      { path: "new.txt", additions: 3, deletions: 0 },
      { path: "binary.bin", additions: null, deletions: null },
    ])
  })

  it("adds staged and unstaged counts for the same path", () => {
    expect(
      combineGitNumstats([
        [{ path: "file.txt", additions: 1, deletions: 0 }],
        [{ path: "file.txt", additions: 2, deletions: 1 }],
      ])
    ).toEqual([{ path: "file.txt", additions: 3, deletions: 1 }])
  })
})
