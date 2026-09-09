import { describe, expect, it } from "vitest"
import { resolveGeneratedImageProtocolPath } from "./renderer-protocol.js"

describe("resolveGeneratedImageProtocolPath", () => {
  const root = "/Users/test/.cypheria/codex/generated_images"

  it("resolves encoded generated image paths below the managed root", () => {
    expect(
      resolveGeneratedImageProtocolPath(
        "cypheria://media/generated-images/thread%20id/image%20name.png",
        root
      )
    ).toBe("/Users/test/.cypheria/codex/generated_images/thread id/image name.png")
  })

  it("rejects other hosts, traversal, and non-image files", () => {
    expect(
      resolveGeneratedImageProtocolPath("cypheria://app/generated-images/a.png", root)
    ).toBeNull()
    expect(
      resolveGeneratedImageProtocolPath("cypheria://media/generated-images/%2E%2E/secret.png", root)
    ).toBeNull()
    expect(
      resolveGeneratedImageProtocolPath(
        "cypheria://media/generated-images/thread/metadata.json",
        root
      )
    ).toBeNull()
    expect(
      resolveGeneratedImageProtocolPath("cypheria://media/generated-images/thread/active.svg", root)
    ).toBeNull()
  })
})
