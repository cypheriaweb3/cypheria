import type {
  AgentId,
  IntegrationClientMessage,
  IntegrationServerMessage,
} from "@cypheria/protocol"
import { IntegrationIdSchema } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"
import { z } from "zod"
import type { AgentManager } from "./agent/agent-manager.js"
import { codexAppToolScope } from "./codex-app-tool-scope.js"
import { ClaudePluginProvider } from "./integration/claude-plugin-provider.js"
import { CodexPluginProvider } from "./integration/codex-plugin-provider.js"
import {
  InMemoryPluginMarketplaceRegistry,
  PluginHub,
  type PluginMarketplaceRegistry,
} from "./integration/plugin-hub.js"
import type { PluginProvider } from "./integration/plugin-provider.js"
import { webUrl } from "./integration/plugin-utils.js"

const mcpConfigSchema = z.record(
  z.string(),
  z.object({ enabled: z.boolean().optional() }).passthrough()
)

const unsupported = (agentId: string, feature: string): Error => {
  const error = new Error(`The ${agentId} adapter does not support plugin ${feature}`)
  error.name = "INTEGRATION_UNSUPPORTED"
  return error
}

export class IntegrationService {
  readonly #agents: AgentManager
  readonly #hub: PluginHub

  constructor(agents: AgentManager, options: { marketplaces?: PluginMarketplaceRegistry } = {}) {
    this.#agents = agents
    this.#hub = new PluginHub(
      new Map<AgentId, PluginProvider>([
        ["codex", new CodexPluginProvider(agents)],
        [
          "claude",
          new ClaudePluginProvider({
            enabled: () => agents.claudePluginsEnabled(),
            reload: () => agents.reloadClaudePlugins(),
            runner: { run: (args, runOptions) => agents.runClaudeCli(args, runOptions) },
          }),
        ],
      ]),
      options.marketplaces ?? new InMemoryPluginMarketplaceRegistry()
    )
  }

  #plugin(agentId: AgentId): PluginProvider {
    return this.#hub.provider(agentId)
  }

  async ensureBundledPlugin(agentId: AgentId): Promise<void> {
    await this.#plugin(agentId).ensureBundledPlugin?.()
  }

  listComposerSkills(cwd?: string) {
    return this.#listSkills(cwd)
  }
  listComposerApps() {
    return this.#listApps()
  }
  listComposerPlugins(cwd?: string, agentId: AgentId = "codex") {
    return this.#plugin(agentId).list({ cwd })
  }
  listComposerMcp() {
    return this.#listMcp()
  }
  async listComposerResources() {
    const statuses = await this.#pages<v2.McpServerStatus>((cursor) =>
      this.#call<v2.ListMcpServerStatusResponse>("mcpServerStatus/list", {
        cursor,
        detail: "full",
        limit: 100,
      })
    )
    return statuses.flatMap((status) =>
      status.resources.map((resource) => ({
        description: resource.description ?? null,
        server: status.name,
        title: resource.title ?? resource.name,
        uri: resource.uri,
      }))
    )
  }

  async handle(
    message: IntegrationClientMessage,
    send: (message: IntegrationServerMessage) => void
  ): Promise<boolean> {
    const respond = (value: unknown): void => {
      send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as IntegrationServerMessage)
    }
    try {
      switch (message.type) {
        case "integration.skill.list.request":
          this.#assertCodex(message.payload.agentId)
          respond(await this.#listSkills(message.payload.cwd, message.payload.forceRefresh))
          break
        case "integration.skill.set-enabled.request":
          this.#assertCodex(message.payload.agentId)
          await this.#call<v2.SkillsConfigWriteResponse>("skills/config/write", {
            enabled: message.payload.enabled,
            path: message.payload.id,
          })
          respond({ succeeded: true })
          break
        case "integration.mcp.list.request":
          this.#assertCodex(message.payload.agentId)
          respond(await this.#listMcp())
          break
        case "integration.mcp.add.request":
          this.#assertCodex(message.payload.agentId)
          await this.#addMcp(message.payload.name, message.payload.url)
          respond({ succeeded: true })
          break
        case "integration.mcp.set-enabled.request":
          this.#assertCodex(message.payload.agentId)
          await this.#setMcpEnabled(message.payload.id, message.payload.enabled)
          respond({ succeeded: true })
          break
        case "integration.mcp.login.request":
          this.#assertCodex(message.payload.agentId)
          respond(await this.#loginMcp(message.payload.id))
          break
        case "integration.plugin.list.request":
          respond(await this.#plugin(message.payload.agentId).list(message.payload))
          break
        case "integration.plugin.read.request":
          respond(await this.#plugin(message.payload.agentId).read(message.payload))
          break
        case "integration.plugin.install.request":
          respond({ results: await this.#hub.install(message.payload) })
          break
        case "integration.plugin.uninstall.request":
          respond({
            agentIds: await this.#hub.uninstall(message.payload),
            succeeded: true,
          })
          break
        case "integration.plugin.set-enabled.request":
          respond(await this.#hub.setEnabled(message.payload))
          break
        case "integration.plugin.set-global-enabled.request":
          await this.#plugin(message.payload.agentId).setGlobalEnabled(message.payload.enabled)
          respond({ succeeded: true })
          break
        case "integration.plugin.agents.request":
          respond({ agents: await this.#hub.agents(message.payload) })
          break
        case "integration.plugin.config.read.request": {
          const provider = this.#plugin(message.payload.agentId)
          if (!provider.readConfig) throw unsupported(message.payload.agentId, "configuration")
          respond(await provider.readConfig(message.payload.id))
          break
        }
        case "integration.plugin.config.write.request": {
          const provider = this.#plugin(message.payload.agentId)
          if (!provider.writeConfig) throw unsupported(message.payload.agentId, "configuration")
          respond(await provider.writeConfig(message.payload.id, message.payload.values))
          break
        }
        case "integration.marketplace.add.request":
          respond({ ...(await this.#hub.addMarketplace(message.payload)), succeeded: true })
          break
        case "integration.marketplace.upgrade.request":
          respond({
            ...(await this.#hub.upgradeMarketplace(message.payload.marketplaceName)),
            succeeded: true,
          })
          break
        case "integration.marketplace.remove.request":
          respond(
            await this.#hub.removeMarketplace({
              confirmUninstall: message.payload.confirmUninstall,
              name: message.payload.marketplaceName,
            })
          )
          break
        case "integration.codex.app.list.request":
          respond(await this.#listApps(message.payload.forceRefresh))
          break
        case "integration.codex.app.set-enabled.request":
          await this.#setAppEnabled(message.payload.appId, message.payload.enabled)
          respond({ succeeded: true })
          break
        case "integration.codex.app.connect.request":
          respond(await this.#connectApp(message.payload.appId))
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      send({
        payload: {
          error: { code: failure.name || "INTEGRATION_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as IntegrationServerMessage)
    }
    return true
  }

  #assertCodex(agentId: string): void {
    if (agentId !== "codex") {
      const error = new Error(`The ${agentId} integration adapter is not available yet`)
      error.name = "INTEGRATION_UNSUPPORTED"
      throw error
    }
  }

  async #call<Result>(
    method: Parameters<AgentManager["callCodex"]>[0],
    params?: Record<string, unknown>
  ): Promise<Result> {
    return (await this.#agents.callCodex(method, params)) as Result
  }

  async #pages<T>(
    fetch: (cursor: string | null) => Promise<{ data: T[]; nextCursor: string | null }>
  ): Promise<T[]> {
    let cursor: string | null = null
    const seen = new Set<string>()
    const items: T[] = []
    for (let page = 0; page < 100; page += 1) {
      const response = await fetch(cursor)
      items.push(...response.data)
      if (!response.nextCursor) return items
      if (seen.has(response.nextCursor)) throw new Error("Harness returned a repeated cursor")
      seen.add(response.nextCursor)
      cursor = response.nextCursor
    }
    throw new Error("Harness catalog exceeded the page limit")
  }

  async #listApps(forceRefresh = false) {
    const [entries, runtime] = await Promise.all([
      this.#pages<v2.AppInfo>((cursor) =>
        this.#call<v2.AppsListResponse>("app/list", {
          cursor,
          forceRefetch: forceRefresh && cursor === null,
          limit: 100,
        })
      ),
      this.#call<v2.AppsInstalledResponse>("app/installed", { forceRefresh })
        .then((value) => ({ error: null, value }))
        .catch(() => ({
          error: "Runtime availability could not be checked. Refresh to retry.",
          value: null,
        })),
    ])
    const states = new Map(runtime.value?.apps.map((app) => [app.id, app]))
    return {
      apps: [...new Map(entries.map((app) => [app.id, app])).values()].map((app) => ({
        accessible: app.isAccessible,
        callable: states.get(app.id)?.callable ?? null,
        description: app.description,
        effectiveEnabled: states.get(app.id)?.enabled ?? null,
        enabled: app.isEnabled,
        id: app.id,
        installUrl: webUrl(app.installUrl),
        logoUrl: webUrl(app.logoUrl),
        name: app.name,
        pluginNames: app.pluginDisplayNames,
      })),
      runtimeError: runtime.error,
    }
  }

  async #setAppEnabled(appId: string, enabled: boolean): Promise<void> {
    IntegrationIdSchema.parse(appId)
    const app = (await this.#listApps()).apps.find((candidate) => candidate.id === appId)
    if (!app?.accessible) throw new Error("This app is not available to the current account")
    await this.#writeConfig(`apps.${appId}.enabled`, enabled)
  }

  async #connectApp(appId: string): Promise<{ url: string }> {
    const app = (await this.#listApps()).apps.find((candidate) => candidate.id === appId)
    if (!app?.installUrl) throw new Error("No connection page is available for this app")
    return { url: app.installUrl }
  }

  async #configuredMcp() {
    const result = await this.#call<v2.ConfigReadResponse>("config/read", { includeLayers: false })
    return mcpConfigSchema.parse(result.config.mcp_servers ?? {})
  }

  async #listMcp() {
    const [entries, config] = await Promise.all([
      this.#pages<v2.McpServerStatus>((cursor) =>
        this.#call<v2.ListMcpServerStatusResponse>("mcpServerStatus/list", {
          cursor,
          detail: "full",
          limit: 100,
        })
      ),
      this.#configuredMcp(),
    ])
    const servers = [...new Map(entries.map((server) => [server.name, server])).values()].map(
      (server) => ({
        authStatus: server.authStatus,
        compatibility: ["codex" as const],
        configurable:
          !server.pluginId &&
          Object.hasOwn(config, server.name) &&
          IntegrationIdSchema.safeParse(server.name).success,
        enabled: Object.hasOwn(config, server.name) ? config[server.name]?.enabled !== false : null,
        name: server.name,
        pluginId: server.pluginId,
        harness: { agentId: "codex" as const, nativeId: server.name },
        resourceCount: server.resources.length + server.resourceTemplates.length,
        runtimeStatus: server.runtimeStatus,
        tools: Object.entries(server.tools).flatMap(([name, tool]) =>
          tool
            ? [
                {
                  description: tool.description ?? null,
                  name,
                  appScope:
                    server.name === "codex_apps" ? codexAppToolScope(name, tool._meta) : null,
                },
              ]
            : []
        ),
      })
    )
    for (const [name, entry] of Object.entries(config)) {
      if (servers.some((server) => server.name === name)) continue
      servers.push({
        authStatus: "unknown",
        compatibility: ["codex"],
        configurable: IntegrationIdSchema.safeParse(name).success,
        enabled: entry.enabled !== false,
        name,
        pluginId: null,
        harness: { agentId: "codex", nativeId: name },
        resourceCount: 0,
        runtimeStatus: entry.enabled === false ? "disabled" : null,
        tools: [],
      })
    }
    return { servers }
  }

  async #addMcp(name: string, url: string): Promise<void> {
    IntegrationIdSchema.parse(name)
    if ((await this.#listMcp()).servers.some((server) => server.name === name)) {
      throw new Error("An MCP server with this name already exists")
    }
    await this.#writeConfig(`mcp_servers.${name}`, { enabled: true, url })
    await this.#call("config/mcpServer/reload")
  }

  async #setMcpEnabled(name: string, enabled: boolean): Promise<void> {
    IntegrationIdSchema.parse(name)
    const server = (await this.#listMcp()).servers.find((candidate) => candidate.name === name)
    if (!server?.configurable) throw new Error("Manage this MCP server through its owning plugin")
    await this.#writeConfig(`mcp_servers.${name}.enabled`, enabled)
    await this.#call("config/mcpServer/reload")
  }

  async #loginMcp(name: string): Promise<{ authorizationUrl: string }> {
    const server = (await this.#listMcp()).servers.find((candidate) => candidate.name === name)
    if (
      !server ||
      server.enabled === false ||
      ["unsupported", "bearerToken"].includes(server.authStatus)
    ) {
      throw new Error("OAuth login is not available for this MCP server")
    }
    const result = await this.#call<v2.McpServerOauthLoginResponse>("mcpServer/oauth/login", {
      name,
    })
    const authorizationUrl = webUrl(result.authorizationUrl)
    if (!authorizationUrl) throw new Error("Harness returned an invalid authorization URL")
    return { authorizationUrl }
  }

  async #listSkills(cwd?: string, forceReload = false) {
    const response = await this.#call<v2.SkillsListResponse>("skills/list", {
      cwds: cwd ? [cwd] : [],
      forceReload,
    })
    return {
      errors: response.data.flatMap((entry) =>
        entry.errors.map((error) => ({ message: error.message, path: error.path ?? null }))
      ),
      skills: response.data.flatMap((entry) =>
        entry.skills.map((skill) => ({
          brandColor: skill.interface?.brandColor ?? null,
          compatibility: ["codex" as const],
          cwd: entry.cwd,
          dependencyCount: skill.dependencies?.tools.length ?? 0,
          description:
            skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
          displayName: skill.interface?.displayName ?? skill.name,
          enabled: skill.enabled,
          iconUrl: skill.interface?.iconLargeUrl ?? skill.interface?.iconSmallUrl ?? null,
          name: skill.name,
          path: skill.path,
          pluginId: skill.pluginId,
          harness: { agentId: "codex" as const, nativeId: skill.path },
          scope: skill.scope,
        }))
      ),
    }
  }

  async #writeConfig(keyPath: string, value: unknown): Promise<void> {
    await this.#call("config/value/write", { keyPath, mergeStrategy: "upsert", value })
  }
}
