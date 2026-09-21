import type { AgentView } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { isAgentUpdateAvailable } from "./agent-manager.js"

const agent = (overrides: Partial<AgentView> = {}): AgentView => ({
  id: "codex",
  name: "Codex",
  version: "1.9.0",
  description: "Agent",
  repository: null,
  website: null,
  icon: null,
  native: true,
  installed: true,
  enabled: false,
  available: true,
  availableVersion: "1.10.0",
  runtimeScope: "shared",
  runtimeState: "stopped",
  integrity: "not-applicable",
  installation: { kind: "npx", source: "@openai/codex@1.9.0" },
  ...overrides,
})

describe("isAgentUpdateAvailable", () => {
  it("uses semantic-version precedence instead of lexical comparison", () => {
    expect(isAgentUpdateAvailable(agent())).toBe(true)
    expect(isAgentUpdateAvailable(agent({ availableVersion: "1.9.0", version: "1.10.0" }))).toBe(
      false
    )
  })

  it("does not offer an update for the same version or an uninstalled agent", () => {
    expect(isAgentUpdateAvailable(agent({ availableVersion: "1.9.0" }))).toBe(false)
    expect(isAgentUpdateAvailable(agent({ installed: false }))).toBe(false)
  })

  it("returns false when no valid available semantic version exists", () => {
    expect(isAgentUpdateAvailable(agent({ availableVersion: null }))).toBe(false)
    expect(isAgentUpdateAvailable(agent({ availableVersion: "latest" }))).toBe(false)
  })
})
