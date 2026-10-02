import { describe, expect, it } from "vitest"

import { formatReviewComments, hunkAnchor } from "./review-comments.js"

describe("hunkAnchor", () => {
  it("anchors on the first new line, or the first old line of a pure deletion", () => {
    expect(hunkAnchor("@@ -10,3 +12,5 @@ function a()")).toEqual({
      lineNumber: 12,
      side: "additions",
    })
    expect(hunkAnchor("@@ -7 +7 @@")).toEqual({ lineNumber: 7, side: "additions" })
    expect(hunkAnchor("@@ -20,4 +19,0 @@")).toEqual({ lineNumber: 20, side: "deletions" })
    expect(hunkAnchor("@@ -0,0 +1,3 @@")).toEqual({ lineNumber: 1, side: "additions" })
    expect(hunkAnchor("not a hunk")).toBeNull()
  })
})

describe("formatReviewComments", () => {
  it("lists each comment with its absolute path and line", () => {
    expect(
      formatReviewComments("/repo/", [
        {
          body: "Use a constant",
          id: "1",
          lineNumber: 3,
          path: "src/a.ts",
          side: "additions",
          source: "unstaged",
        },
        {
          body: "Why remove\nthis?",
          id: "2",
          lineNumber: 9,
          path: "b.ts",
          side: "deletions",
          source: "unstaged",
        },
      ])
    ).toBe(
      [
        "Please address these review comments on the changes in /repo:",
        "",
        "1. /repo/src/a.ts:3",
        "   Use a constant",
        "2. /repo/b.ts:9 (removed line)",
        "   Why remove",
        "   this?",
      ].join("\n")
    )
  })

  it("names a commented range by its first and last line", () => {
    expect(
      formatReviewComments("/repo", [
        {
          body: "Extract this",
          id: "1",
          lineNumber: 8,
          path: "a.ts",
          side: "additions",
          source: "branch",
          startLineNumber: 4,
        },
      ])
    ).toContain("1. /repo/a.ts:4-8\n   Extract this")
  })
})
