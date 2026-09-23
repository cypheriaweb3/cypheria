import { describe, expect, it, vi } from "vitest"

import type { AgentManager } from "./agent/agent-manager.js"
import { IntegrationService } from "./integration-service.js"

describe("IntegrationService", () => {
  it("updates an already installed bundled plugin when listing after an app update", async () => {
    let listed = 0
    const callCodex = vi.fn(async (method: string) => {
      if (method === "plugin/list") {
        listed += 1
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces:
            listed === 1
              ? [
                  {
                    name: "cypheria-bundled",
                    path: "/bundled/marketplace.json",
                    plugins: [{ name: "cypheria-app-tools", installed: true }],
                  },
                ]
              : [],
        }
      }
      if (method === "marketplace/add")
        return { installedRoot: "/bundled", marketplaceName: "cypheria-bundled" }
      if (method === "plugin/installed")
        return {
          marketplaces: [
            {
              name: "cypheria-bundled",
              plugins: [
                {
                  name: "cypheria-app-tools",
                  installed: true,
                  localVersion: "0.3.1",
                  version: "0.3.2",
                },
              ],
            },
          ],
        }
      if (method === "plugin/install") return { appsNeedingAuth: [] }
      throw new Error(`Unexpected call: ${method}`)
    })
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "codex" },
        requestId: "req_bundled_update",
        type: "integration.plugin.list.request",
      },
      send
    )
    expect(callCodex).toHaveBeenCalledWith(
      "plugin/install",
      expect.objectContaining({ pluginName: "cypheria-app-tools" })
    )
    expect(listed).toBe(2)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { ok: true, value: { errors: [], marketplaces: [] } } })
    )
  })

  it("refreshes the Codex App directory once before reading later pages", async () => {
    const callCodex = vi.fn(async (method: string, params: { cursor?: string | null } = {}) => {
      if (method === "app/installed") return { apps: [] }
      if (method === "app/list")
        return { data: [], nextCursor: params.cursor === null ? "next-page" : null }
      throw new Error(`Unexpected call: ${method}`)
    })
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    await service.handle(
      {
        payload: { forceRefresh: true },
        requestId: "req_apps_refresh",
        type: "integration.codex.app.list.request",
      },
      vi.fn()
    )
    expect(callCodex).toHaveBeenCalledWith("app/list", {
      cursor: null,
      forceRefetch: true,
      limit: 100,
    })
    expect(callCodex).toHaveBeenCalledWith("app/list", {
      cursor: "next-page",
      forceRefetch: false,
      limit: 100,
    })
  })

  it("installs remote plugins by catalog ID rather than display name", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "plugin/list")
        return {
          marketplaces: [
            {
              name: "openai-curated-remote",
              path: null,
              plugins: [
                {
                  name: "gitlab",
                  remotePluginId: "plugin_connector_1p_gitlab",
                },
              ],
            },
          ],
        }
      if (method === "plugin/install") return { appsNeedingAuth: [] }
      throw new Error(`Unexpected call: ${method}`)
    })
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: {
          agentId: "codex",
          marketplaceName: "openai-curated-remote",
          marketplacePath: null,
          pluginName: "gitlab",
        },
        requestId: "req_remote_install",
        type: "integration.plugin.install.request",
      },
      send
    )
    expect(callCodex).toHaveBeenCalledWith("plugin/list", { cwds: null, forceRefetch: true })
    expect(callCodex).toHaveBeenCalledWith(
      "plugin/install",
      expect.objectContaining({
        pluginName: "plugin_connector_1p_gitlab",
        remoteMarketplaceName: "openai-curated-remote",
      })
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { ok: true, value: { appsNeedingAuth: [], installed: true } },
      })
    )
  })

  it("projects account-bound Codex App tool scopes without exposing raw metadata", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "config/read") return { config: { mcp_servers: {} } }
      if (method === "mcpServerStatus/list")
        return {
          data: [
            {
              name: "codex_apps",
              authStatus: "authenticated",
              pluginId: null,
              resources: [],
              resourceTemplates: [],
              runtimeStatus: "running",
              tools: {
                "gitlab.get_project": {
                  description: "Get project",
                  _meta: {
                    connectorId: "connector_gitlab",
                    link_id: "link-1",
                    _codex_apps: {
                      resource_uri: "/connector_gitlab/link-1/get_project",
                    },
                  },
                },
              },
            },
          ],
          nextCursor: null,
        }
      throw new Error(`Unexpected call: ${method}`)
    })
    const service = new IntegrationService({ callCodex } as unknown as AgentManager)
    const send = vi.fn()
    await service.handle(
      {
        payload: { agentId: "codex" },
        requestId: "req_mcp",
        type: "integration.mcp.list.request",
      },
      send
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          ok: true,
          value: {
            servers: [
              expect.objectContaining({
                tools: [
                  {
                    name: "gitlab.get_project",
                    description: "Get project",
                    appScope: {
                      connectorId: "connector_gitlab",
                      accountLinkId: "link-1",
                      resourceUri: "/connector_gitlab/link-1/get_project",
                    },
                  },
                ],
              }),
            ],
          },
        },
      })
    )
  })

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
