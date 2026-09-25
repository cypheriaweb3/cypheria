import { describe, expect, it } from "vitest"

import {
  chatFilePreviewHasSource,
  chatFilePreviewKind,
  parseChatDelimitedText,
  stripChatFrontmatter,
} from "./file-preview.js"

describe("chat file preview", () => {
  it("maps previewable extensions case-insensitively", () => {
    expect(chatFilePreviewKind("docs/README.md")).toBe("markdown")
    expect(chatFilePreviewKind("docs/guide.MDX")).toBe("markdown")
    expect(chatFilePreviewKind("assets/logo.svg")).toBe("svg")
    expect(chatFilePreviewKind("assets/photo.JPG")).toBe("image")
    expect(chatFilePreviewKind("data/audit.csv")).toBe("table")
    expect(chatFilePreviewKind("data/networks.tsv")).toBe("table")
    expect(chatFilePreviewKind("src/index.ts")).toBeNull()
    expect(chatFilePreviewKind("md")).toBeNull()
    expect(chatFilePreviewKind(".gitignore")).toBeNull()
  })

  it("offers a source view for everything except raster images", () => {
    expect(chatFilePreviewHasSource("image")).toBe(false)
    expect(chatFilePreviewHasSource("svg")).toBe(true)
    expect(chatFilePreviewHasSource("markdown")).toBe(true)
    expect(chatFilePreviewHasSource(null)).toBe(true)
  })

  it("parses quoted delimited text", () => {
    expect(parseChatDelimitedText('a,b\r\n"x, y","say ""hi"""\n1,\n', ",")).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", ""],
    ])
    expect(parseChatDelimitedText('name\tnote\nbase\t"two\nlines"', "\t")).toEqual([
      ["name", "note"],
      ["base", "two\nlines"],
    ])
    expect(parseChatDelimitedText("", ",")).toEqual([])
  })

  it("strips only a leading frontmatter block", () => {
    expect(stripChatFrontmatter("---\ntitle: A\n---\n\n# A\n")).toBe("# A\n")
    expect(stripChatFrontmatter("---\r\ntitle: A\r\n---\r\n# A")).toBe("# A")
    expect(stripChatFrontmatter("# A\n\n---\n\nB\n")).toBe("# A\n\n---\n\nB\n")
    expect(stripChatFrontmatter("---\nnot closed")).toBe("---\nnot closed")
  })
})
