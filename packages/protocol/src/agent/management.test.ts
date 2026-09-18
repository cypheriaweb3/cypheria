import { describe, expect, it } from "vitest"

import { AgentDescriptorSchema, AgentViewSchema } from "./management.js"
import { compatibilityTagForAgent } from "./registry.js"

describe("agent management protocol", () => {
  it("keeps AgentView fields in domain order with a required version", () => {
    expect(Object.keys(AgentViewSchema.shape)).toEqual([
      "id",
      "name",
      "version",
      "description",
      "repository",
      "website",
      "icon",
      "native",
      "installed",
      "enabled",
      "available",
      "availableVersion",
      "runtimeScope",
      "runtimeState",
      "integrity",
    ])
    expect(AgentViewSchema.shape.version.safeParse(null).success).toBe(false)
    expect(AgentViewSchema.shape.version.safeParse("").success).toBe(false)
  })

  it("describes shared capabilities without erasing ACP provenance", () => {
    expect(
      AgentDescriptorSchema.parse({
        capabilities: { apps: true, mcp: true, plugins: true, skills: true, threads: true },
        description: "OpenAI Codex",
        icon: null,
        id: "codex",
        name: "Codex",
        native: true,
      }).capabilities.apps
    ).toBe(true)
    expect(compatibilityTagForAgent("codex")).toBe("codex")
    expect(compatibilityTagForAgent("gemini")).toBe("acp")
  })
})
