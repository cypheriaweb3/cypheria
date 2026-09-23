import { DEFAULT_GIT_SETTINGS } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"
import { codexGitInstructions } from "./codex-git-instructions.js"

describe("codexGitInstructions", () => {
  it("includes the branch prefix and configured commit and PR instructions", () => {
    const instructions = codexGitInstructions({
      ...DEFAULT_GIT_SETTINGS,
      branchPrefix: "feature/",
      commitInstructions: "Use an imperative subject.",
      prInstructions: "Mention the test plan.",
    })
    expect(instructions).toContain('start its name with "feature/"')
    expect(instructions).toContain("Git commit instructions:\nUse an imperative subject.")
    expect(instructions).toContain("Pull request instructions:\nMention the test plan.")
  })

  it("omits empty settings", () => {
    expect(codexGitInstructions({ ...DEFAULT_GIT_SETTINGS, branchPrefix: "" })).toBeUndefined()
  })
})
