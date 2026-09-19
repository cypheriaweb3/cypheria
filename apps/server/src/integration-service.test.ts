import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { IntegrationService } from "./integration-service.js"

describe("IntegrationService", () => {
  it("projects Codex skills with compatibility and harness provenance", async () => {
    const callCodex = vi.fn(async () => ({
      data: [
        {
          cwd: "/workspace",
          errors: [],
          skills: [
            {
              dependencies: { tools: ["git"] },
              description: "Review changes",
              enabled: true,
              interface: null,
              name: "review",
              path: "/skills/review/SKILL.md",
              pluginId: null,
              scope: "user",
              shortDescription: "Review changes",
            },
          ],
        },
      ],
    }))
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()

    await service.handle(
      {
        payload: { agentId: "codex", cwd: "/workspace" },
        requestId: "req_skills",
        type: "integration.skill.list.request",
      },
      send
    )

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          ok: true,
          value: expect.objectContaining({
            skills: [
              expect.objectContaining({
                compatibility: ["codex"],
                harness: { agentId: "codex", nativeId: "/skills/review/SKILL.md" },
              }),
            ],
          }),
        },
        requestId: "req_skills",
        type: "integration.skill.list.response",
      })
    )
  })

  it("rejects unsupported harness adapters without falling back to Codex", async () => {
    const callCodex = vi.fn()
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "pi" },
        requestId: "req_pi",
        type: "integration.skill.list.request",
      },
      send
    )
    expect(callCodex).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          error: expect.objectContaining({ code: "INTEGRATION_UNSUPPORTED" }),
          ok: false,
        }),
      })
    )
  })
})
