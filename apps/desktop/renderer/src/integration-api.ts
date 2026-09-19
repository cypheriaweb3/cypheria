import type {
  CodexAppListResult,
  CodexMcpListResult,
  CodexPluginDetailView,
  CodexPluginInstallResult,
  CodexPluginListResult,
  CodexPluginLocator,
  CodexSkillListResult,
} from "../../ipc/src/index.js"
import { ensureCypheriaClient } from "./cypheria-client.js"

const codex = "codex" as const

export const integrationApi = {
  apps: {
    connect: async (appId: string) => {
      const { url } = await (await ensureCypheriaClient()).harnesses.codex.apps.connect(appId)
      if (!window.cypheria) throw new Error("Opening external links requires Cypheria Desktop.")
      await window.cypheria.app.openExternal(url)
    },
    list: async (forceRefresh = false): Promise<CodexAppListResult> =>
      (await ensureCypheriaClient()).harnesses.codex.apps.list(forceRefresh),
    setEnabled: async (appId: string, enabled: boolean) =>
      (await ensureCypheriaClient()).harnesses.codex.apps.setEnabled(appId, enabled),
  },
  marketplaces: {
    add: async (input: { refName?: string; source: string; sparsePaths?: string[] }) =>
      (await ensureCypheriaClient()).integrations.marketplaces.add({ agentId: codex, ...input }),
    remove: async (marketplaceName: string) =>
      (await ensureCypheriaClient()).integrations.marketplaces.remove({
        agentId: codex,
        marketplaceName,
      }),
    upgrade: async (marketplaceName?: string) =>
      (await ensureCypheriaClient()).integrations.marketplaces.upgrade({
        agentId: codex,
        ...(marketplaceName ? { marketplaceName } : {}),
      }),
  },
  mcp: {
    add: async (input: { name: string; url: string }) =>
      (await ensureCypheriaClient()).integrations.mcp.add({ agentId: codex, ...input }),
    list: async (): Promise<CodexMcpListResult> =>
      (await ensureCypheriaClient()).integrations.mcp.list({ agentId: codex }),
    login: async (name: string) => {
      const { authorizationUrl } = await (await ensureCypheriaClient()).integrations.mcp.login({
        agentId: codex,
        id: name,
      })
      if (!window.cypheria) throw new Error("Opening external links requires Cypheria Desktop.")
      await window.cypheria.app.openExternal(authorizationUrl)
    },
    setEnabled: async (name: string, enabled: boolean) =>
      (await ensureCypheriaClient()).integrations.mcp.setEnabled({
        agentId: codex,
        enabled,
        id: name,
      }),
  },
  plugins: {
    install: async (locator: CodexPluginLocator): Promise<CodexPluginInstallResult> =>
      (await ensureCypheriaClient()).integrations.plugins.install({
        agentId: codex,
        ...locator,
      }),
    list: async (
      options: { cwd?: string; forceRefetch?: boolean } = {}
    ): Promise<CodexPluginListResult> => {
      const result = await (await ensureCypheriaClient()).integrations.plugins.list({
        agentId: codex,
        cwd: options.cwd,
        forceRefresh: options.forceRefetch,
      })
      return {
        errors: result.errors,
        marketplaces: result.marketplaces.map(({ sourceKind, ...marketplace }) => ({
          ...marketplace,
          catalog:
            sourceKind === "cypheria" ? "public" : sourceKind === "openai" ? "openai" : "personal",
          plugins: marketplace.plugins.map(
            ({
              compatibility: _compatibility,
              ecosystem: _ecosystem,
              harness: _harness,
              ...plugin
            }) => plugin
          ),
        })),
      }
    },
    read: async (locator: CodexPluginLocator): Promise<CodexPluginDetailView> =>
      (await ensureCypheriaClient()).integrations.plugins.read({ agentId: codex, ...locator }),
    setEnabled: async (id: string, enabled: boolean) =>
      (await ensureCypheriaClient()).integrations.plugins.setEnabled({
        agentId: codex,
        enabled,
        id,
      }),
    uninstall: async (id: string) =>
      (await ensureCypheriaClient()).integrations.plugins.uninstall({ agentId: codex, id }),
  },
  skills: {
    list: async (
      options: { cwd?: string; forceReload?: boolean } = {}
    ): Promise<CodexSkillListResult> => {
      const result = await (await ensureCypheriaClient()).integrations.skills.list({
        agentId: codex,
        cwd: options.cwd,
        forceRefresh: options.forceReload,
      })
      return {
        errors: result.errors,
        skills: result.skills.map(
          ({ compatibility: _compatibility, harness: _harness, ...skill }) => skill
        ),
      }
    },
    setEnabled: async (path: string, enabled: boolean) =>
      (await ensureCypheriaClient()).integrations.skills.setEnabled({
        agentId: codex,
        enabled,
        id: path,
      }),
  },
}
