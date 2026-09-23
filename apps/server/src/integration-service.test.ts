import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { IntegrationService } from "./integration-service.js"

describe("IntegrationService", () => {
  it("updates Codex's process-wide plugins feature", async () => {
    const callCodex = vi.fn(async () => ({ enablement: { plugins: false } }))
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "codex", enabled: false },
        requestId: "req_plugins_global",
        type: "integration.plugin.set-global-enabled.request",
      },
      send
    )
    expect(callCodex).toHaveBeenCalledWith("experimentalFeature/enablement/set", {
      enablement: { plugins: false },
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { ok: true, value: { succeeded: true } },
        type: "integration.plugin.set-global-enabled.response",
      })
    )
  })

  it("registers and installs the bundled Git tools when plugins are enabled", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "marketplace/add")
        return {
          installedRoot: "/bundled/marketplace",
          marketplaceName: "cypheria-bundled",
          alreadyAdded: false,
        }
      if (method === "plugin/installed")
        return {
          marketplaces: [
            {
              name: "cypheria-bundled",
              plugins: [{ name: "cypheria-app-tools", installed: false }],
            },
            {
              name: "cypheria-curated",
              plugins: [
                {
                  id: "cypheria-app-tools@cypheria-curated",
                  name: "cypheria-app-tools",
                  installed: true,
                },
              ],
            },
          ],
        }
      if (method === "plugin/install") return { appsNeedingAuth: [] }
      return { enablement: { plugins: true } }
    })
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "codex", enabled: true },
        requestId: "req_plugins_enable",
        type: "integration.plugin.set-global-enabled.request",
      },
      send
    )
    expect(callCodex).toHaveBeenCalledWith(
      "marketplace/add",
      expect.objectContaining({ source: expect.stringContaining("plugins/marketplace") })
    )
    expect(callCodex).toHaveBeenCalledWith(
      "plugin/install",
      expect.objectContaining({
        pluginName: "cypheria-app-tools",
        marketplacePath: "/bundled/marketplace/.agents/plugins/marketplace.json",
      })
    )
    expect(callCodex).toHaveBeenCalledWith("plugin/uninstall", {
      pluginId: "cypheria-app-tools@cypheria-curated",
    })
    expect(callCodex).toHaveBeenCalledWith("marketplace/remove", {
      marketplaceName: "cypheria-curated",
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { ok: true, value: { succeeded: true } } })
    )
  })

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
