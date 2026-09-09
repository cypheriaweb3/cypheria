import { describe, expect, it } from "vitest"
import { composerMediaCapabilities } from "./chat-composer.js"

describe("composerMediaCapabilities", () => {
  it("enables only media types advertised by the selected Codex model", () => {
    expect(composerMediaCapabilities(["text", "image"])).toEqual({
      accept: "image/*",
      audio: false,
      canAttach: true,
      image: true,
    })

    const audio = composerMediaCapabilities(["text", "audio"])
    expect(audio).toMatchObject({ audio: true, canAttach: true, image: false })
    expect(audio.accept).toContain("audio/mpeg")
    expect(audio.accept).not.toContain("image/*")
  })

  it("rejects dropped files when the model is text-only", () => {
    expect(composerMediaCapabilities(["text"])).toEqual({
      accept: "application/x-cypheria-no-media-input",
      audio: false,
      canAttach: false,
      image: false,
    })
  })
})
