import { describe, expect, it } from "vitest"
import { websiteDocsUrl } from "./src/lib/docs-links"

describe("documentation links", () => {
  it("maps English and Chinese Markdown links to Website routes", () => {
    expect(websiteDocsUrl("architecture.md")).toBe("/docs/architecture")
    expect(websiteDocsUrl("architecture.zh-CN.md#system-model")).toBe(
      "/zh-CN/docs/architecture#system-model"
    )
    expect(websiteDocsUrl("README.md")).toBe("/docs")
  })

  it("resolves links relative to the linking document", () => {
    expect(websiteDocsUrl("protocol.md#transport", "server/runtime.md")).toBe(
      "/docs/server/protocol#transport"
    )
    expect(websiteDocsUrl("../features/git.zh-CN.md", "server/protocol.zh-CN.md")).toBe(
      "/zh-CN/docs/features/git"
    )
    expect(websiteDocsUrl("../architecture.md", "server/runtime.md")).toBe("/docs/architecture")
    expect(websiteDocsUrl("../README.md", "design/brand.md")).toBe("/docs")
    expect(websiteDocsUrl("../../AGENTS.md", "server/runtime.md")).toBe("../../AGENTS.md")
  })

  it("leaves external and anchor links unchanged", () => {
    expect(websiteDocsUrl("https://example.com/doc.md")).toBe("https://example.com/doc.md")
    expect(websiteDocsUrl("#trust-boundaries")).toBe("#trust-boundaries")
  })
})
