import { describe, expect, it } from "vitest"

import {
  applyChatFileTreeMutation,
  chatFileBaseName,
  chatFileParentPath,
  isChatFilePathRemoved,
  moveChatFilePath,
  uniqueChatFilePath,
} from "./file-paths.js"

describe("chat file paths", () => {
  it("derives names and parents for files and directories", () => {
    expect(chatFileBaseName("src/lib/")).toBe("lib")
    expect(chatFileBaseName("README.md")).toBe("README.md")
    expect(chatFileParentPath("src/lib/index.ts")).toBe("src/lib/")
    expect(chatFileParentPath("src/lib/")).toBe("src/")
    expect(chatFileParentPath("README.md")).toBe("")
  })

  it("moves a directory together with its descendants only", () => {
    expect(moveChatFilePath("src/lib/", "src/lib/", "lib/")).toBe("lib/")
    expect(moveChatFilePath("src/lib/a.ts", "src/lib/", "lib/")).toBe("lib/a.ts")
    expect(moveChatFilePath("src/library.ts", "src/lib/", "lib/")).toBe("src/library.ts")
    expect(moveChatFilePath("src/lib.ts", "src/lib", "lib")).toBe("src/lib.ts")
  })

  it("removes a directory recursively without touching sibling prefixes", () => {
    expect(isChatFilePathRemoved("src/lib/a.ts", "src/lib/")).toBe(true)
    expect(isChatFilePathRemoved("src/library.ts", "src/lib/")).toBe(false)
    expect(isChatFilePathRemoved("src/lib/a.ts", "src/lib")).toBe(false)
  })

  it("applies tree mutations to a path list", () => {
    const paths = ["src/", "src/a.ts", "src/lib/b.ts", "README.md"]
    const moved = applyChatFileTreeMutation(paths, { from: "src/lib/", to: "lib/", type: "move" })
    expect(moved).toEqual(["src/", "src/a.ts", "lib/b.ts", "README.md"])
    const added = applyChatFileTreeMutation(moved, { path: "docs/", type: "add" })
    expect(added).toContain("docs/")
    expect(applyChatFileTreeMutation(added, { path: "docs/", type: "add" })).toEqual(added)
    expect(applyChatFileTreeMutation(added, { path: "src/", type: "remove" })).toEqual([
      "lib/b.ts",
      "README.md",
      "docs/",
    ])
  })

  it("picks collision-free names for new entries", () => {
    const paths = ["src/untitled.txt", "src/untitled-2.txt", "src/new-folder/"]
    expect(uniqueChatFilePath(paths, "src/", "untitled.txt", "file")).toBe("src/untitled-3.txt")
    expect(uniqueChatFilePath(paths, "src/", "new-folder", "directory")).toBe("src/new-folder-2/")
    expect(uniqueChatFilePath(paths, "", "untitled.txt", "file")).toBe("untitled.txt")
  })
})
