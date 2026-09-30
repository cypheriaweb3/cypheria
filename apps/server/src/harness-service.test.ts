import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import type { CodexHarnessService } from "./codex-harness-service.js"
import { HarnessService } from "./harness-service.js"
import type { TerminalManager } from "./terminal/terminal-manager.js"

const claudeService = () => {
  let pluginsEnabled = true
  const update = vi.fn(async (patch: { pluginsEnabled?: boolean }) => {
    if (patch.pluginsEnabled !== undefined) pluginsEnabled = patch.pluginsEnabled
  })
  const agents = {
    getClaudeCatalog: async () => ({ account: {}, models: [] }),
  } as unknown as AgentManager
  const service = new HarnessService(agents, {} as CodexHarnessService, {} as TerminalManager, {
    get: () => ({ pluginsEnabled }),
    update,
  })
  return { service, update }
}

describe("Claude harness settings", () => {
  it("offers Cypheria's own plugins switch because Claude has no native one", async () => {
    const { service } = claudeService()
    const snapshot = await service.catalog.get("claude")
    expect(snapshot.settingSections).toEqual([
      expect.objectContaining({
        id: "settings",
        settings: [expect.objectContaining({ id: "pluginsEnabled", type: "boolean", value: true })],
      }),
    ])
  })

  it("stores the switch in Cypheria's configuration instead of Claude's", async () => {
    const { service, update } = claudeService()
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "claude", values: { pluginsEnabled: false } },
        requestId: "req_claude_plugins",
        type: "harness.settings.update.request",
      },
      "session",
      send
    )
    expect(update).toHaveBeenCalledWith({ pluginsEnabled: false })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ ok: true }) })
    )
  })
})
