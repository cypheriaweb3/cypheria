import { describe, expect, it } from "vitest"

import { codeReviewPrompt } from "./code-review-prompt.js"

describe("codeReviewPrompt", () => {
  it("asks for a review of uncommitted changes with code comment directives", () => {
    const prompt = codeReviewPrompt({ mode: "uncommitted" })
    expect(prompt.startsWith("Please review my uncommitted changes.")).toBe(true)
    expect(prompt).toContain("::code-comment{...}")
    expect(prompt).toContain("git diff HEAD")
  })

  it("pins a branch review to its merge base", () => {
    const prompt = codeReviewPrompt({
      baseBranch: "main",
      mergeBase: "a".repeat(40),
      mode: "branch",
      sourceBranch: "feature",
    })
    expect(prompt.startsWith("Please review changes on feature against main.")).toBe(true)
    expect(prompt).toContain(`git diff ${"a".repeat(40)}`)
  })
})
