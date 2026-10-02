import { describe, expect, it } from "vitest"

import { fileSections } from "./diff.js"

describe("fileSections", () => {
  it("splits a unified diff into one section per file", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/c.ts",
      "rename from src/b.ts",
      "rename to src/c.ts",
      "",
    ].join("\n")
    const sections = fileSections(patch)
    expect(sections.map((section) => section.path)).toEqual(["src/a.ts", "src/c.ts"])
    expect(sections[0]?.text).toContain("+new")
    expect(sections[0]?.text).not.toContain("rename from")
  })

  it("names deleted files by their header path", () => {
    const patch = [
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n")
    expect(fileSections(patch).map((section) => section.path)).toEqual(["gone.ts"])
  })

  it("ignores text before the first file header", () => {
    expect(fileSections("no diff here")).toEqual([])
  })
})
