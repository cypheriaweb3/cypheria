import { describe, expect, it, vi } from "vitest"

import { createIntegrationActions } from "./integration.js"
import type { ServerClient } from "./server-client.js"

describe("integration actions", () => {
  it("maps provider-aware operations to the shared protocol", async () => {
    const requestIntegration = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value: type.endsWith("list.request") ? { skills: [], errors: [] } : { succeeded: true },
      },
      requestId: "test",
      type: type.replace(/\.request$/u, ".response"),
    }))
    const actions = createIntegrationActions({ requestIntegration } as unknown as ServerClient)

    await actions.skills.list({ agentId: "codex", cwd: "/workspace" })
    await actions.plugins.setEnabled({ agentId: "codex", enabled: false, id: "review@team" })

    expect(requestIntegration.mock.calls).toEqual([
      ["integration.skill.list.request", { agentId: "codex", cwd: "/workspace" }, undefined],
      [
        "integration.plugin.set-enabled.request",
        { agentId: "codex", enabled: false, id: "review@team" },
        undefined,
      ],
    ])
  })

  it("normalizes provider errors", async () => {
    const requestIntegration = vi.fn(async () => ({
      payload: {
        error: { code: "INTEGRATION_UNSUPPORTED", message: "Pi adapter is unavailable" },
        ok: false as const,
      },
      requestId: "test",
      type: "integration.skill.list.response" as const,
    }))
    const actions = createIntegrationActions({ requestIntegration } as unknown as ServerClient)
    await expect(actions.skills.list({ agentId: "pi" })).rejects.toMatchObject({
      message: "Pi adapter is unavailable",
      name: "INTEGRATION_UNSUPPORTED",
    })
  })
})
