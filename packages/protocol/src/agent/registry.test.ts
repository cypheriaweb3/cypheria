import { describe, expect, it } from "vitest"

import {
  ACP_AGENT_REGISTRY,
  AgentIdSchema,
  AgentRegistryDocumentSchema,
  AgentRegistryEntrySchema,
  isRegistryAgentId,
} from "./registry.js"

const agent = {
  description: "An ACP agent",
  distribution: { npx: { package: "example-agent@1.2.3" } },
  id: "example-agent",
  license_url: "https://example.com/license",
  name: "Example Agent",
  version: "1.2.3",
}

describe("ACP Registry schemas", () => {
  it("matches the upstream required fields and stable version rules", () => {
    expect(AgentRegistryEntrySchema.safeParse(agent).success).toBe(true)
    expect(AgentRegistryEntrySchema.safeParse({ ...agent, id: "Example_Agent" }).success).toBe(
      false
    )
    expect(AgentRegistryEntrySchema.safeParse({ ...agent, version: "1.2.3-rc.1" }).success).toBe(
      false
    )
    expect(AgentRegistryEntrySchema.safeParse({ ...agent, license_url: undefined }).success).toBe(
      false
    )
  })

  it("enforces non-empty known distributions and their closed shapes", () => {
    expect(AgentRegistryEntrySchema.safeParse({ ...agent, distribution: {} }).success).toBe(false)
    expect(
      AgentRegistryEntrySchema.safeParse({ ...agent, distribution: { binary: {} } }).success
    ).toBe(false)
    expect(
      AgentRegistryEntrySchema.safeParse({
        ...agent,
        distribution: { npx: { package: "agent", unexpected: true } },
      }).success
    ).toBe(false)
  })

  it("supports the dimcode license exception and legal extensible entry fields", () => {
    expect(
      AgentRegistryEntrySchema.safeParse({
        ...agent,
        custom_metadata: { channel: "stable" },
        icon: "icon.svg",
        id: "dimcode",
        license_url: undefined,
      }).success
    ).toBe(true)
  })

  it("validates the published registry document and rejects duplicate ids", () => {
    expect(
      AgentRegistryDocumentSchema.safeParse({ agents: [agent], extensions: [], version: "1.0.0" })
        .success
    ).toBe(true)
    expect(
      AgentRegistryDocumentSchema.safeParse({
        agents: [agent, agent],
        extensions: [],
        version: "1.0.0",
      }).success
    ).toBe(false)
    expect(
      AgentRegistryDocumentSchema.safeParse({
        agents: [agent],
        extensions: [],
        version: "1.0.0-trailing",
      }).success
    ).toBe(false)
  })

  it("accepts only ids in the committed registry snapshot", () => {
    expect(AgentIdSchema.safeParse("gemini").success).toBe(true)
    expect(isRegistryAgentId("gemini")).toBe(true)
    expect(AgentIdSchema.safeParse("future-agent").success).toBe(false)
    expect(isRegistryAgentId("future-agent")).toBe(false)
    expect(isRegistryAgentId("codex")).toBe(false)
  })

  it("keeps every usable snapshot entry in the generated id allowlist", () => {
    const usableIds = ACP_AGENT_REGISTRY.agents
      .map(({ id }) => id)
      .filter((id) => !["codex-acp", "claude-acp", "pi-acp", "opencode"].includes(id))

    expect(usableIds.every((id) => isRegistryAgentId(id))).toBe(true)
  })

  it("rejects source manifests containing a preview channel", () => {
    expect(
      AgentRegistryEntrySchema.safeParse({
        ...agent,
        preview: {
          distribution: { npx: { package: "example-agent@1.3.0-preview.1" } },
          version: "1.3.0-preview.1",
        },
      }).success
    ).toBe(false)
  })
})
