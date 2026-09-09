import { describe, expect, it } from "vitest"
import { generatedImageResourceUrl } from "./generated-image-url.js"

describe("generatedImageResourceUrl", () => {
  it("maps generated image paths without exposing their Cypheria home", () => {
    expect(
      generatedImageResourceUrl(
        "/Users/test/Custom Home/codex/generated_images/thread id/image name.png"
      )
    ).toBe("cypheria://media/generated-images/thread%20id/image%20name.png")
    expect(
      generatedImageResourceUrl(
        "file:///Users/test/.cypheria/codex/generated_images/thread-1/result.webp"
      )
    ).toBe("cypheria://media/generated-images/thread-1/result.webp")
  })

  it("leaves unrelated and unsafe paths untouched", () => {
    expect(generatedImageResourceUrl("https://example.com/image.png")).toBeNull()
    expect(generatedImageResourceUrl("/tmp/generated_images/../secret.png")).toBeNull()
    expect(generatedImageResourceUrl("/tmp/generated_images/thread/metadata.json")).toBeNull()
    expect(generatedImageResourceUrl("/tmp/generated_images/thread/active.svg")).toBeNull()
  })
})
