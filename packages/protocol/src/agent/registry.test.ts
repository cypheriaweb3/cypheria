import { describe, expect, it } from "vitest"

import { AgentRegistryDocumentSchema, AgentRegistryEntrySchema } from "./registry.js"

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
  })
})
