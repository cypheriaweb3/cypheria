import type { v2 } from "@cypheria/protocol/codex-types"
import { describe, expect, it } from "vitest"
import { codexGeneratedImageData } from "./image-generation.js"

const imageItem = (
  result: string,
  savedPath?: string
): Extract<v2.ThreadItem, { type: "imageGeneration" }> => ({
  failure: null,
  id: "image-1",
  result,
  revisedPrompt: null,
  savedPath,
  status: "completed",
  type: "imageGeneration",
})

describe("Codex generated image data", () => {
  it("turns App Server raw PNG base64 into a browser-loadable data URL", () => {
    expect(codexGeneratedImageData(imageItem("iVBORw0KGgoAAA"))).toEqual({
      base64: "iVBORw0KGgoAAA",
      mediaType: "image/png",
      url: "data:image/png;base64,iVBORw0KGgoAAA",
    })
  })

  it("preserves a complete data URL and detects non-PNG saved formats", () => {
    expect(codexGeneratedImageData(imageItem("data:image/jpeg;base64,/9j/test"))).toEqual({
      base64: "/9j/test",
      mediaType: "image/jpeg",
      url: "data:image/jpeg;base64,/9j/test",
    })
    expect(codexGeneratedImageData(imageItem("unknown", "/tmp/generated.webp"))).toMatchObject({
      mediaType: "image/webp",
      url: "data:image/webp;base64,unknown",
    })
  })

  it("does not expose failed image payloads", () => {
    expect(
      codexGeneratedImageData({
        ...imageItem("iVBORw0KGgoAAA"),
        failure: { limitId: "image_generation", resetsAt: null, type: "usageLimitExceeded" },
      })
    ).toBeUndefined()
  })
})
