import { randomUUID } from "node:crypto"
import { access, readFile, stat } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  IntegrationClientMessage,
  IntegrationServerMessage,
  MarketplaceSourceKind,
} from "@cypheria/protocol"
import { IntegrationIdSchema } from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"
import { z } from "zod"
import type { AgentManager } from "./agent/agent-manager.js"

const openAiMarketplaces = new Set([
  "openai-api-curated",
  "openai-bundled",
  "openai-curated",
  "openai-curated-remote",
  "openai-primary-runtime",
])
const cypheriaMarketplace = "cypheria-bundled"

const sourceKind = (name: string): MarketplaceSourceKind => {
  if (name === cypheriaMarketplace) return "cypheria"
  if (openAiMarketplaces.has(name)) return "openai"
  return "custom"
}

const webUrl = (value: string | null | undefined): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

const pluginImage = async (
  url: string | null | undefined,
  path: string | null | undefined
): Promise<string | null> => {
  if (url && /^https?:\/\//iu.test(url)) return url
  if (!path) return null
  const mime = (
    {
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    } as Record<string, string>
  )[extname(path).toLowerCase()]
  if (!mime) return null
  try {
    if ((await stat(path)).size > 2_000_000) return null
    return `data:${mime};base64,${(await readFile(path)).toString("base64")}`
  } catch {
    return null
  }
}

const mcpConfigSchema = z.record(
  z.string(),
  z.object({ enabled: z.boolean().optional() }).passthrough()
)

export class IntegrationService {
  readonly #agents: AgentManager
  #bundledPluginPromise: Promise<void> | undefined

  constructor(agents: AgentManager) {
    this.#agents = agents
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
          this.#assertCodex(message.payload.agentId)
          respond(await this.#listPlugins(message.payload.cwd, message.payload.forceRefresh))
          break
        case "integration.plugin.read.request":
          this.#assertCodex(message.payload.agentId)
          respond(await this.#readPlugin(message.payload))
          break
        case "integration.plugin.install.request":
          this.#assertCodex(message.payload.agentId)
          respond(await this.#installPlugin(message.payload))
          break
        case "integration.plugin.uninstall.request":
          this.#assertCodex(message.payload.agentId)
          await this.#call("plugin/uninstall", { pluginId: message.payload.id })
          respond({ succeeded: true })
          break
        case "integration.plugin.set-enabled.request":
          this.#assertCodex(message.payload.agentId)
          await this.#writeConfig(`plugins.${message.payload.id}.enabled`, message.payload.enabled)
          respond({ succeeded: true })
          break
        case "integration.plugin.set-global-enabled.request":
          this.#assertCodex(message.payload.agentId)
          await this.#call("experimentalFeature/enablement/set", {
            enablement: { plugins: message.payload.enabled },
          } satisfies v2.ExperimentalFeatureEnablementSetParams)
          if (message.payload.enabled) await this.#ensureBundledPlugin()
          respond({ succeeded: true })
          break
        case "integration.marketplace.add.request": {
          this.#assertCodex(message.payload.agentId)
          const result = await this.#call<v2.MarketplaceAddResponse>("marketplace/add", {
            refName: message.payload.refName ?? null,
            source: message.payload.source,
            sparsePaths: message.payload.sparsePaths ?? null,
          })
          respond({ marketplaceName: result.marketplaceName, succeeded: true })
          break
        }
        case "integration.marketplace.upgrade.request":
          this.#assertCodex(message.payload.agentId)
          await this.#call("marketplace/upgrade", {
            marketplaceName: message.payload.marketplaceName ?? null,
          })
          respond({ succeeded: true })
          break
        case "integration.marketplace.remove.request":
          this.#assertCodex(message.payload.agentId)
          await this.#removeMarketplace(message.payload.marketplaceName)
          respond({ succeeded: true })
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
          forceRefetch: forceRefresh,
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
          tool ? [{ description: tool.description ?? null, name }] : []
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

  async #listPlugins(cwd?: string, forceRefetch = false) {
    try {
      const response = await this.#call<v2.PluginListResponse>("plugin/list", {
        cwds: cwd ? [cwd] : null,
        forceRefetch,
      })
      const featured = new Set(response.featuredPluginIds)
      const marketplaces = await Promise.all(
        response.marketplaces.map(async (marketplace) => ({
          displayName: marketplace.interface?.displayName?.trim() || marketplace.name,
          name: marketplace.name,
          path: marketplace.path,
          plugins: await Promise.all(
            marketplace.plugins.map(async (plugin) => ({
              availability: plugin.availability,
              brandColor: plugin.interface?.brandColor ?? null,
              capabilities: plugin.interface?.capabilities ?? [],
              category: plugin.interface?.category ?? null,
              compatibility: ["codex" as const],
              description:
                plugin.interface?.shortDescription ?? plugin.interface?.longDescription ?? null,
              developerName: plugin.interface?.developerName ?? null,
              displayName: plugin.interface?.displayName ?? plugin.name,
              ecosystem: "openai" as const,
              enabled: plugin.enabled,
              featured: featured.has(plugin.id),
              id: plugin.id,
              installed: plugin.installed,
              installPolicy: plugin.installPolicy,
              logoUrl: await pluginImage(
                plugin.interface?.logoUrl ?? plugin.interface?.composerIconUrl,
                plugin.interface?.logo ?? plugin.interface?.composerIcon
              ),
              marketplaceName: marketplace.name,
              marketplacePath: marketplace.path,
              name: plugin.name,
              harness: { agentId: "codex" as const, nativeId: plugin.id },
              sourceType: plugin.source.type,
              version: plugin.localVersion ?? plugin.version,
            }))
          ),
          sourceKind: sourceKind(marketplace.name),
        }))
      )
      return {
        errors: response.marketplaceLoadErrors.map((error) => ({
          message: error.message,
          path: error.marketplacePath,
        })),
        marketplaces,
      }
    } catch (error) {
      return {
        errors: [
          {
            message: error instanceof Error ? error.message : "Unable to load plugin catalog",
            path: "catalog:app-server",
          },
        ],
        marketplaces: [],
      }
    }
  }

  async #readPlugin(locator: {
    marketplaceName: string
    marketplacePath: string | null
    pluginName: string
  }) {
    const { plugin } = await this.#call<v2.PluginReadResponse>("plugin/read", {
      marketplacePath: locator.marketplacePath,
      pluginName: locator.pluginName,
      remoteMarketplaceName: locator.marketplacePath ? null : locator.marketplaceName,
    })
    const ui = plugin.summary.interface
    return {
      apps: plugin.apps.map((app) => ({
        category: app.category,
        description: app.description,
        id: app.id,
        installUrl: webUrl(app.installUrl),
        name: app.name,
      })),
      description: plugin.description ?? ui?.longDescription ?? null,
      mcpServers: plugin.mcpServers,
      privacyPolicyUrl: webUrl(ui?.privacyPolicyUrl),
      prompts: ui?.defaultPrompt ?? [],
      shareUrl: webUrl(plugin.shareUrl),
      skills: plugin.skills.map((skill) => ({
        description: skill.shortDescription ?? skill.description,
        enabled: skill.enabled,
        name: skill.interface?.displayName ?? skill.name,
        path: skill.path,
      })),
      termsOfServiceUrl: webUrl(ui?.termsOfServiceUrl),
      websiteUrl: webUrl(ui?.websiteUrl),
    }
  }

  async #installPlugin(locator: {
    marketplaceName: string
    marketplacePath: string | null
    pluginName: string
  }) {
    const response = await this.#call<v2.PluginInstallResponse>("plugin/install", {
      installAttemptId: randomUUID(),
      marketplacePath: locator.marketplacePath,
      pluginName: locator.pluginName,
      remoteMarketplaceName: locator.marketplacePath ? null : locator.marketplaceName,
    })
    return { appsNeedingAuth: response.appsNeedingAuth.map((app) => app.name), installed: true }
  }

  async #ensureBundledPlugin(): Promise<void> {
    const pending = this.#bundledPluginPromise ?? this.#installBundledPlugin()
    this.#bundledPluginPromise = pending
    try {
      await pending
    } catch (error) {
      if (this.#bundledPluginPromise === pending) this.#bundledPluginPromise = undefined
      throw error
    }
  }

  async #installBundledPlugin(): Promise<void> {
    const candidates = [
      new URL("./marketplace/", import.meta.url),
      new URL("../../../plugins/marketplace/", import.meta.url),
    ]
    const marketplaceDirectory = await Promise.any(
      candidates.map(async (candidate) => {
        await access(new URL(".agents/plugins/marketplace.json", candidate))
        return fileURLToPath(candidate)
      })
    ).catch(() => {
      throw new Error("Bundled Cypheria plugin marketplace is unavailable")
    })
    const registered = await this.#call<v2.MarketplaceAddResponse>("marketplace/add", {
      source: marketplaceDirectory,
      refName: null,
      sparsePaths: null,
    })
    const installed = await this.#call<v2.PluginInstalledResponse>("plugin/installed", {
      cwds: null,
      installSuggestionPluginNames: null,
    })
    const entry = installed.marketplaces
      .find((marketplace) => marketplace.name === cypheriaMarketplace)
      ?.plugins.find((plugin) => plugin.name === "cypheria-app-tools")
    if (!entry?.installed || entry.localVersion !== entry.version) {
      await this.#call<v2.PluginInstallResponse>("plugin/install", {
        installAttemptId: randomUUID(),
        marketplacePath: join(registered.installedRoot, ".agents", "plugins", "marketplace.json"),
        pluginName: "cypheria-app-tools",
        remoteMarketplaceName: null,
      })
    }
    const previous = installed.marketplaces.find(
      (marketplace) => marketplace.name === "cypheria-curated"
    )
    if (previous?.plugins.length === 1 && previous.plugins[0]?.name === "cypheria-app-tools") {
      if (previous.plugins[0].installed) {
        await this.#call("plugin/uninstall", { pluginId: previous.plugins[0].id })
      }
      await this.#call("marketplace/remove", { marketplaceName: "cypheria-curated" })
    }
  }

  async #removeMarketplace(name: string): Promise<void> {
    if (sourceKind(name) !== "custom") throw new Error("Official marketplaces cannot be removed")
    const current = await this.#call<v2.PluginListResponse>("plugin/list", {
      cwds: null,
      forceRefetch: true,
    })
    if (current.marketplaceLoadErrors.length) throw new Error("Refresh marketplaces before removal")
    const matches = current.marketplaces.filter(
      (marketplace) => marketplace.name === name && marketplace.path !== null
    )
    if (matches.length !== 1) throw new Error("Marketplace could not be uniquely resolved")
    if (matches[0]?.plugins.some((plugin) => plugin.installed)) {
      throw new Error("Uninstall this marketplace's plugins before removing it")
    }
    await this.#call("marketplace/remove", { marketplaceName: name })
  }

  async #writeConfig(keyPath: string, value: unknown): Promise<void> {
    await this.#call("config/value/write", { keyPath, mergeStrategy: "upsert", value })
  }
}
