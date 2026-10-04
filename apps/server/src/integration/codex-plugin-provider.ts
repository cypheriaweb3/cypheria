import { randomUUID } from "node:crypto"
import { access } from "node:fs/promises"
import { join } from "node:path"

import type {
  MarketplaceSourceKind,
  PluginCapabilities,
  PluginDetailView,
  PluginScope,
} from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"

import type { AgentManager } from "../agent/agent-manager.js"
import type {
  MarketplaceRemoveValue,
  MarketplaceState,
  PluginInstallValue,
  PluginListValue,
  PluginLocator,
  PluginProvider,
} from "./plugin-provider.js"
import {
  BUNDLED_MARKETPLACE_NAME,
  BUNDLED_PLUGIN_NAMES,
  bundledMarketplaceDirectory,
  isHiddenBundledPlugin,
  pluginImage,
  webUrl,
} from "./plugin-utils.js"

const openAiMarketplaces = new Set([
  "openai-api-curated",
  "openai-bundled",
  "openai-curated",
  "openai-curated-remote",
  "openai-primary-runtime",
])

const sourceKind = (name: string): MarketplaceSourceKind => {
  if (name === BUNDLED_MARKETPLACE_NAME) return "cypheria"
  if (openAiMarketplaces.has(name)) return "openai"
  return "custom"
}

const CODEX_CAPABILITIES: PluginCapabilities = {
  addMarketplace: true,
  configure: false,
  install: true,
  readDetail: true,
  removeMarketplace: true,
  scopes: [],
  setEnabled: true,
  uninstall: true,
  upgradeMarketplace: true,
}

export class CodexPluginProvider implements PluginProvider {
  readonly agentId = "codex" as const
  readonly capabilities = CODEX_CAPABILITIES
  readonly enabled = true
  readonly #agents: AgentManager
  #bundledPluginPromise: Promise<void> | undefined

  constructor(agents: AgentManager) {
    this.#agents = agents
  }

  async list(input: { cwd?: string; forceRefresh?: boolean }): Promise<PluginListValue> {
    return this.#list(input.cwd, input.forceRefresh ?? false)
  }

  async marketplaceState(name: string): Promise<MarketplaceState> {
    const response = await this.#call<v2.PluginListResponse>("plugin/list", {
      cwds: null,
      forceRefetch: false,
    })
    const marketplace = response.marketplaces.find(
      (entry) => entry.name === name && entry.path !== null
    )
    if (!marketplace?.path) return "missing"
    return (await access(marketplace.path).then(
      () => true,
      () => false
    ))
      ? "ok"
      : "unsupported"
  }

  async #list(cwd?: string, forceRefetch = false): Promise<PluginListValue> {
    try {
      const response = await this.#call<v2.PluginListResponse>("plugin/list", {
        cwds: cwd ? [cwd] : null,
        forceRefetch,
      })
      if (
        !this.#bundledPluginPromise &&
        response.marketplaces.some(
          (marketplace) =>
            marketplace.name === BUNDLED_MARKETPLACE_NAME &&
            marketplace.plugins.some(
              (plugin) =>
                (BUNDLED_PLUGIN_NAMES as readonly string[]).includes(plugin.name) &&
                plugin.installed
            )
        )
      ) {
        await this.#ensureBundledPlugin()
        return this.#list(cwd, true)
      }
      const featured = new Set(response.featuredPluginIds)
      const marketplaces = await Promise.all(
        response.marketplaces.map(async (marketplace) => ({
          displayName: marketplace.interface?.displayName?.trim() || marketplace.name,
          name: marketplace.name,
          path: marketplace.path,
          plugins: await Promise.all(
            marketplace.plugins
              .filter((plugin) => !isHiddenBundledPlugin(marketplace.name, plugin.name))
              .map(async (plugin) => ({
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
                installedScopes: [],
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
        capabilities: this.capabilities,
        errors: response.marketplaceLoadErrors.map((error) => ({
          message: error.message,
          path: error.marketplacePath,
        })),
        marketplaces,
      }
    } catch (error) {
      return {
        capabilities: this.capabilities,
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

  async read(locator: PluginLocator): Promise<PluginDetailView> {
    const pluginName = locator.marketplacePath
      ? locator.pluginName
      : await this.#remotePluginId(locator.marketplaceName, locator.pluginName)
    const { plugin } = await this.#call<v2.PluginReadResponse>("plugin/read", {
      marketplacePath: locator.marketplacePath,
      pluginName,
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
      detailAvailable: true,
      mcpServers: plugin.mcpServers,
      onboardingSkill:
        plugin.onboardingSkill?.path && plugin.onboardingSkill.enabled
          ? {
              name: plugin.onboardingSkill.interface?.displayName ?? plugin.onboardingSkill.name,
              path: plugin.onboardingSkill.path,
            }
          : null,
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

  async install(locator: PluginLocator): Promise<PluginInstallValue> {
    const pluginName = locator.marketplacePath
      ? locator.pluginName
      : await this.#remotePluginId(locator.marketplaceName, locator.pluginName)
    const response = await this.#call<v2.PluginInstallResponse>("plugin/install", {
      installAttemptId: randomUUID(),
      marketplacePath: locator.marketplacePath,
      pluginName,
      remoteMarketplaceName: locator.marketplacePath ? null : locator.marketplaceName,
    })
    return {
      appsNeedingAuth: response.appsNeedingAuth.map((app) => app.name),
      installed: true,
      reloadPending: false,
    }
  }

  async uninstall(input: { id: string; scope?: PluginScope }): Promise<void> {
    await this.#call("plugin/uninstall", { pluginId: input.id })
  }

  async setEnabled(input: { enabled: boolean; id: string }): Promise<void> {
    await this.#call("config/value/write", {
      keyPath: `plugins.${input.id}.enabled`,
      mergeStrategy: "upsert",
      value: input.enabled,
    })
  }

  async setGlobalEnabled(enabled: boolean): Promise<void> {
    await this.#call("experimentalFeature/enablement/set", {
      enablement: { plugins: enabled },
    } satisfies v2.ExperimentalFeatureEnablementSetParams)
    if (enabled) await this.#ensureBundledPlugin()
  }

  async addMarketplace(input: {
    refName?: string
    source: string
    sparsePaths?: string[]
  }): Promise<{ marketplaceName: string | null }> {
    const result = await this.#call<v2.MarketplaceAddResponse>("marketplace/add", {
      refName: input.refName ?? null,
      source: input.source,
      sparsePaths: input.sparsePaths ?? null,
    })
    return { marketplaceName: result.marketplaceName }
  }

  async upgradeMarketplace(name?: string): Promise<void> {
    await this.#call("marketplace/upgrade", { marketplaceName: name ?? null })
  }

  async removeMarketplace(input: { name: string }): Promise<MarketplaceRemoveValue> {
    if (sourceKind(input.name) !== "custom") {
      throw new Error("Official marketplaces cannot be removed")
    }
    const current = await this.#call<v2.PluginListResponse>("plugin/list", {
      cwds: null,
      forceRefetch: true,
    })
    if (current.marketplaceLoadErrors.length) throw new Error("Refresh marketplaces before removal")
    const matches = current.marketplaces.filter(
      (marketplace) => marketplace.name === input.name && marketplace.path !== null
    )
    if (matches.length !== 1) throw new Error("Marketplace could not be uniquely resolved")
    if (matches[0]?.plugins.some((plugin) => plugin.installed)) {
      throw new Error("Uninstall this marketplace's plugins before removing it")
    }
    await this.#call("marketplace/remove", { marketplaceName: input.name })
    return { succeeded: true, uninstalledPlugins: [] }
  }

  async #call<Result>(
    method: Parameters<AgentManager["callCodex"]>[0],
    params?: Record<string, unknown>
  ): Promise<Result> {
    return (await this.#agents.callCodex(method, params)) as Result
  }

  async #remotePluginId(marketplaceName: string, pluginName: string): Promise<string> {
    const result = await this.#call<v2.PluginListResponse>("plugin/list", {
      cwds: null,
      forceRefetch: true,
    })
    const marketplace = result.marketplaces.find(
      (entry) => entry.name === marketplaceName && entry.path === null
    )
    const plugin = marketplace?.plugins.find((entry) => entry.name === pluginName)
    if (!plugin?.remotePluginId) {
      throw new Error(`Remote plugin ${pluginName} is unavailable in ${marketplaceName}`)
    }
    return plugin.remotePluginId
  }

  ensureBundledPlugin(): Promise<void> {
    return this.#ensureBundledPlugin()
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
    const marketplaceDirectory = await bundledMarketplaceDirectory(
      ".agents/plugins/marketplace.json"
    )
    const registered = await this.#call<v2.MarketplaceAddResponse>("marketplace/add", {
      source: marketplaceDirectory,
      refName: null,
      sparsePaths: null,
    })
    const installed = await this.#call<v2.PluginInstalledResponse>("plugin/installed", {
      cwds: null,
      installSuggestionPluginNames: null,
    })
    const plugins = installed.marketplaces.find(
      (marketplace) => marketplace.name === BUNDLED_MARKETPLACE_NAME
    )?.plugins
    for (const pluginName of BUNDLED_PLUGIN_NAMES) {
      const entry = plugins?.find((plugin) => plugin.name === pluginName)
      if (entry?.installed && entry.localVersion === entry.version) continue
      await this.#call<v2.PluginInstallResponse>("plugin/install", {
        installAttemptId: randomUUID(),
        marketplacePath: join(registered.installedRoot, ".agents", "plugins", "marketplace.json"),
        pluginName,
        remoteMarketplaceName: null,
      })
    }
  }
}
