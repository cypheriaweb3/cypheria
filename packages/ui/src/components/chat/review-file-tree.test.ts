import { describe, expect, it } from "vitest"

import { directoriesOf, reviewRowDecoration } from "./review-file-tree.js"

describe("directoriesOf", () => {
  it("lists every ancestor directory once, in the tree's form", () => {
    expect(directoriesOf(["src/a/b.ts", "src/c.ts", "README.md"])).toEqual(["src/", "src/a/"])
  })
})

describe("reviewRowDecoration", () => {
  it("shows added and removed lines and the comment count", () => {
    const decoration = reviewRowDecoration(
      { additions: 3, comments: 2, deletions: 1, path: "a.ts", status: "modified" },
      "a.ts summary"
    )
    expect(decoration?.title).toBe("a.ts summary")
    expect(decoration?.parts.map((part) => part.text)).toEqual(["+3", " -1", "  💬 2"])
  })

  it("draws nothing for a file without counts", () => {
    expect(reviewRowDecoration({ path: "a.ts", status: "modified" }, "")).toBeNull()
    expect(reviewRowDecoration(undefined, "")).toBeNull()
  })
})
