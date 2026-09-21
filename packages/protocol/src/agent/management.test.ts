import { describe, expect, it } from "vitest"

import {
  AgentCatalogEntrySchema,
  AgentDescriptorSchema,
  AgentRemoveRequestSchema,
  AgentRemoveResponseSchema,
  AgentViewSchema,
} from "./management.js"
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
      "installation",
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

  it("includes an installable version in every catalog entry", () => {
    expect(
      AgentCatalogEntrySchema.parse({
        description: "Agent",
        icon: null,
        id: "codex",
        name: "Codex",
        native: true,
        version: "1.2.3",
      }).version
    ).toBe("1.2.3")
    expect(
      AgentCatalogEntrySchema.safeParse({
        description: "Agent",
        icon: null,
        id: "codex",
        name: "Codex",
        native: true,
      }).success
    ).toBe(false)
  })

  it("supports removing an uninstalled harness registration separately from uninstalling", () => {
    expect(
      AgentRemoveRequestSchema.parse({
        payload: { agentId: "codex" },
        requestId: "remove-codex",
        type: "agent.remove.request",
      }).payload.agentId
    ).toBe("codex")
    expect(
      AgentRemoveResponseSchema.parse({
        payload: { ok: true, value: { agentId: "codex" } },
        requestId: "remove-codex",
        type: "agent.remove.response",
      }).payload
    ).toEqual({ ok: true, value: { agentId: "codex" } })
  })
})
