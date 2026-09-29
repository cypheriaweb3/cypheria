import { describe, expect, it } from "vitest"

import {
  AGENT_COMPATIBILITY_RULES,
  agentCompatibilityRule,
} from "./agent-compatibility-manifest.js"

describe("agent compatibility manifest", () => {
  it("has no workarounds for the approved ACP agents", () => {
    expect(agentCompatibilityRule("gemini", "0.61.0")).toBeUndefined()
    expect(AGENT_COMPATIBILITY_RULES).toEqual([])
  })

  it("documents every compatibility rule", () => {
    expect(
      AGENT_COMPATIBILITY_RULES.every(
        ({ agentId, reason, version }) => agentId && version && reason.length > 20
      )
    ).toBe(true)
  })
})
