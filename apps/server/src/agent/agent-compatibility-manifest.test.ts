import { describe, expect, it } from "vitest"

import {
  AGENT_COMPATIBILITY_RULES,
  agentCompatibilityRule,
} from "./agent-compatibility-manifest.js"

describe("agent compatibility manifest", () => {
  it("scopes upstream workarounds to an exact agent version", () => {
    expect(agentCompatibilityRule("minion-code", "0.1.44")).toMatchObject({
      additionalPythonPackages: ["agent-client-protocol==0.8.1"],
    })
    expect(agentCompatibilityRule("minion-code", "0.1.45")).toBeUndefined()
    expect(agentCompatibilityRule("fast-agent", "0.10.1")).toBeUndefined()
  })

  it("documents every compatibility rule", () => {
    expect(
      AGENT_COMPATIBILITY_RULES.every(
        ({ agentId, reason, version }) => agentId && version && reason.length > 20
      )
    ).toBe(true)
  })
})
