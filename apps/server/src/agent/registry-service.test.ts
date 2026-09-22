import { ACP_AGENT_REGISTRY } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { AgentRegistryService } from "./registry-service.js"

describe("AgentRegistryService", () => {
  it("serves only the ACP agents pinned in the release snapshot", () => {
    const service = new AgentRegistryService()

    expect(ACP_AGENT_REGISTRY.version).toBe("1.0.0")
    expect(service.entries.length).toBeGreaterThan(0)
    expect(service.get("gemini")?.id).toBe("gemini")
    expect(service.get("future-agent")).toBeUndefined()
    expect(service.get("codex-acp")).toBeUndefined()
  })
})
