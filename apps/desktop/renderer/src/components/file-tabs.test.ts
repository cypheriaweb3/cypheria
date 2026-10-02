import { describe, expect, it } from "vitest"

import { fileTabId, parseFileTabId, withOpenedTab } from "./file-tabs.js"

describe("file tab ids", () => {
  it("round-trips roots and paths that contain separators", () => {
    const file = { path: "src/a:b.ts", root: "/Users/me/my repo" }
    expect(parseFileTabId(fileTabId(file))).toEqual(file)
    expect(parseFileTabId(fileTabId({ path: "a.ts", root: "C:\\work" }))).toEqual({
      path: "a.ts",
      root: "C:\\work",
    })
  })

  it("ignores other tabs and malformed ids", () => {
    expect(parseFileTabId("review")).toBeNull()
    expect(parseFileTabId("file:only-root")).toBeNull()
    expect(parseFileTabId("file:%E0:a")).toBeNull()
  })
})

describe("withOpenedTab", () => {
  it("inserts after the given tab, appends otherwise, and keeps an open tab in place", () => {
    expect(withOpenedTab(["a", "b"], "x", "a")).toEqual(["a", "x", "b"])
    expect(withOpenedTab(["a", "b"], "x")).toEqual(["a", "b", "x"])
    expect(withOpenedTab(["a", "x"], "x", "a")).toEqual(["a", "x"])
  })
})
