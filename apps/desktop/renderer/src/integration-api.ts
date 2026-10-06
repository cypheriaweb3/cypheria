import type { AgentId } from "@cypheria/protocol"
import type {
  CodexAppListResult,
  CodexMcpListResult,
  CodexPluginDetailView,
  CodexPluginListResult,
  CodexPluginLocator,
  CodexSkillListResult,
} from "../../ipc/src/index.js"
import { ensureCypheriaClient } from "./cypheria-client.js"

const codex = "codex" as const

export type PluginAgent = "claude" | "codex"
/** Agents whose MCP servers Cypheria manages. */
export type McpAgent = "codex" | "pi"
export type PluginIdentity = { marketplaceName: string; pluginName: string }

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
      (await ensureCypheriaClient()).integrations.marketplaces.add(input),
    remove: async (marketplaceName: string, confirmUninstall = false) =>
      (await ensureCypheriaClient()).integrations.marketplaces.remove({
        ...(confirmUninstall ? { confirmUninstall } : {}),
        marketplaceName,
      }),
    upgrade: async (marketplaceName?: string) =>
      (await ensureCypheriaClient()).integrations.marketplaces.upgrade({
        ...(marketplaceName ? { marketplaceName } : {}),
      }),
  },
  mcp: {
    add: async (input: { name: string; url: string }, agentId: McpAgent = codex) =>
      (await ensureCypheriaClient()).integrations.mcp.add({ agentId, ...input }),
    list: async (agentId: McpAgent = codex): Promise<CodexMcpListResult> =>
      (await ensureCypheriaClient()).integrations.mcp.list({ agentId }),
    login: async (name: string, agentId: McpAgent = codex) => {
      const { authorizationUrl } = await (await ensureCypheriaClient()).integrations.mcp.login({
        agentId,
        id: name,
      })
      if (!window.cypheria) throw new Error("Opening external links requires Cypheria Desktop.")
      await window.cypheria.app.openExternal(authorizationUrl)
    },
    setEnabled: async (name: string, enabled: boolean, agentId: McpAgent = codex) =>
      (await ensureCypheriaClient()).integrations.mcp.setEnabled({
        agentId,
        enabled,
        id: name,
      }),
  },
  plugins: {
    agents: async (identity: PluginIdentity) =>
      (await ensureCypheriaClient()).integrations.plugins.agents(identity),
    /** Installs for every Agent whose marketplace lists the plugin, enabled in each. */
    install: async (
      identity: PluginIdentity,
      options: { acceptCommands?: Record<string, string>; agentIds?: PluginAgent[] } = {}
    ) => (await ensureCypheriaClient()).integrations.plugins.install({ ...identity, ...options }),
    list: async (
      agentId: PluginAgent,
      options: { cwd?: string; forceRefetch?: boolean } = {}
    ): Promise<CodexPluginListResult> => {
      const result = await (await ensureCypheriaClient()).integrations.plugins.list({
        agentId,
        cwd: options.cwd,
        forceRefresh: options.forceRefetch,
      })
      return {
        capabilities: result.capabilities,
        errors: result.errors,
        marketplaces: result.marketplaces.map(({ sourceKind, ...marketplace }) => ({
          ...marketplace,
          catalog:
            sourceKind === "cypheria" || sourceKind === "claude"
              ? "public"
              : sourceKind === "openai"
                ? "openai"
                : "personal",
          plugins: marketplace.plugins.map(
            ({ ecosystem: _ecosystem, harness: _harness, ...plugin }) => plugin
          ),
        })),
      }
    },
    read: async (
      agentId: PluginAgent,
      locator: CodexPluginLocator
    ): Promise<CodexPluginDetailView> =>
      (await ensureCypheriaClient()).integrations.plugins.read({ agentId, ...locator }),
    readConfig: async (agentId: PluginAgent, id: string) =>
      (await ensureCypheriaClient()).integrations.plugins.readConfig({ agentId, id }),
    /** Installs a Git repository, npm package, or local directory as a standalone plugin. */
    installStandalone: async (input: { source: string; sourceType: "git" | "local" | "npm" }) =>
      (await ensureCypheriaClient()).integrations.plugins.installStandalone(input),
    /**
     * Enables or disables one Agent's copy. Enabling installs it there first; an Agent that reads
     * none of the plugin's formats does not support it.
     */
    setEnabled: async (
      agentId: AgentId,
      identity: PluginIdentity,
      enabled: boolean,
      options: { acceptCommandSha256?: string } = {}
    ) =>
      (await ensureCypheriaClient()).integrations.plugins.setEnabled({
        agentId,
        enabled,
        ...identity,
        ...options,
      }),
    uninstall: async (identity: PluginIdentity) =>
      (await ensureCypheriaClient()).integrations.plugins.uninstall(identity),
    writeConfig: async (agentId: PluginAgent, id: string, values: Record<string, string>) =>
      (await ensureCypheriaClient()).integrations.plugins.writeConfig({ agentId, id, values }),
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
