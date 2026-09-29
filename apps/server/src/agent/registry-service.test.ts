import { ACP_AGENT_REGISTRY } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { AgentRegistryService } from "./registry-service.js"

describe("AgentRegistryService", () => {
  it("serves only the reviewed ACP subset pinned by the release", () => {
    const service = new AgentRegistryService()

    expect(ACP_AGENT_REGISTRY.version).toBe("1.0.0")
    expect(service.entries.map(({ id }) => id)).toEqual([
      "antigravity-acp",
      "cline",
      "cursor",
      "devin",
      "gemini",
      "github-copilot-cli",
      "goose",
      "grok-build",
    ])
    expect(service.get("gemini")?.id).toBe("gemini")
    expect(service.get("qwen-code")).toBeUndefined()
    expect(service.get("future-agent")).toBeUndefined()
    expect(service.get("codex-acp")).toBeUndefined()
  })
})
