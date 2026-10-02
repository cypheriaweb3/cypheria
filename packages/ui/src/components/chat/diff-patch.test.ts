import { describe, expect, it } from "vitest"

import {
  chatDiffFileSections,
  chatHideImportOnlyHunks,
  isChatImportLine,
  isLikelyGeneratedPath,
} from "./diff-patch.js"

const section = (name: string, body: string) =>
  `diff --git a/${name} b/${name}\nindex 1..2 100644\n--- a/${name}\n+++ b/${name}\n${body}`

describe("chatDiffFileSections", () => {
  it("splits a patch into per-file sections in order", () => {
    const patch =
      section("a.ts", "@@ -1 +1 @@\n-x\n+y\n") + section("src/b.ts", "@@ -1 +1 @@\n-1\n+2\n")
    const sections = chatDiffFileSections(patch)
    expect(sections.map((entry) => entry.path)).toEqual(["a.ts", "src/b.ts"])
    expect(sections.map((entry) => entry.text).join("")).toBe(patch)
  })

  it("returns nothing for text without a file header", () => {
    expect(chatDiffFileSections("")).toEqual([])
  })
})

describe("chatHideImportOnlyHunks", () => {
  it("drops hunks that only change imports and files left empty", () => {
    const patch =
      section(
        "a.ts",
        '@@ -1,2 +1,2 @@\n-import { x } from "x"\n+import { x, y } from "x"\n const a = 1\n@@ -10 +10 @@\n-const b = 1\n+const b = 2\n'
      ) + section("b.py", "@@ -1 +1,2 @@\n import os\n+from pathlib import Path\n")
    expect(chatHideImportOnlyHunks(patch)).toBe(
      section("a.ts", "@@ -10 +10 @@\n-const b = 1\n+const b = 2\n")
    )
  })

  it("keeps a hunk with any non-import change", () => {
    const patch = section("a.rs", "@@ -1 +1,2 @@\n-use std::io;\n+use std::fs;\n+fn main() {}\n")
    expect(chatHideImportOnlyHunks(patch)).toBe(patch)
  })

  it("recognizes common import forms", () => {
    for (const line of [
      'import React from "react"',
      "from a.b import c",
      'export { a } from "./a"',
      'const fs = require("fs")',
      "use crate::x::{a, b};",
      "#include <stdio.h>",
      "",
    ])
      expect(isChatImportLine(line)).toBe(true)
    expect(isChatImportLine("const imported = 1")).toBe(false)
  })
})

describe("isLikelyGeneratedPath", () => {
  it("matches lock files, minified bundles, maps, and snapshots", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "web/package-lock.json",
      "dist/app.min.js",
      "app.js.map",
      "src/__snapshots__/a.test.ts.snap",
    ])
      expect(isLikelyGeneratedPath(path)).toBe(true)
    expect(isLikelyGeneratedPath("src/lock.ts")).toBe(false)
  })
})
