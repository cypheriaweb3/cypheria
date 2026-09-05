import { readFile, stat } from "node:fs/promises"
import { extname } from "node:path"
import type { CodexAppServerBridge, v2 } from "@cypheria/codex-bridge"
import type {
  CodexMarketplaceView,
  CodexPluginInstallResult,
  CodexPluginListResult,
  CodexPluginLocator,
  CodexSkillListResult,
} from "../../ipc/src/index.js"

const marketplaceKinds = [
  "local",
  "vertical",
  "workspace-directory",
  "shared-with-me",
  "created-by-me-remote",
] as const

const webLink = (value: string | null | undefined) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// Asset paths come from App Server, never from renderer input.
const pluginImage = async (url: string | null | undefined, path: string | null | undefined) => {
  if (url && /^https?:\/\//i.test(url)) return url
  if (!path) return null
  const mime = (
    {
      ".png": "image/png",
      ".webp": "image/webp",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
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

export const readCodexPlugin = async (bridge: CodexAppServerBridge, input: CodexPluginLocator) => {
  const { plugin } = await bridge.request<"plugin/read", v2.PluginReadResponse>("plugin/read", {
    marketplacePath: input.marketplacePath,
    remoteMarketplaceName: input.marketplacePath ? null : input.marketplaceName,
    pluginName: input.pluginName,
  })
  const ui = plugin.summary.interface
  return {
    description: plugin.description ?? ui?.longDescription ?? null,
    shareUrl: webLink(plugin.shareUrl),
    prompts: ui?.defaultPrompt ?? [],
    websiteUrl: webLink(ui?.websiteUrl),
    privacyPolicyUrl: webLink(ui?.privacyPolicyUrl),
    termsOfServiceUrl: webLink(ui?.termsOfServiceUrl),
    apps: plugin.apps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      category: app.category,
      installUrl: webLink(app.installUrl),
    })),
    skills: plugin.skills.map((skill) => ({
      name: skill.interface?.displayName ?? skill.name,
      description: skill.shortDescription ?? skill.description,
      enabled: skill.enabled,
      path: skill.path,
    })),
    mcpServers: plugin.mcpServers,
  }
}

export const listCodexPlugins = async (
  bridge: CodexAppServerBridge,
  options: { cwd?: string; forceRefetch?: boolean }
): Promise<CodexPluginListResult> => {
  const results = await Promise.all(
    marketplaceKinds.map(async (kind): Promise<CodexPluginListResult> => {
      try {
        const response = await bridge.request<"plugin/list", v2.PluginListResponse>("plugin/list", {
          cwds: options.cwd ? [options.cwd] : null,
          forceRefetch: options.forceRefetch ?? false,
          marketplaceKinds: [kind],
        })
        const featured = new Set(response.featuredPluginIds)
        const marketplaces: CodexMarketplaceView[] = await Promise.all(
          response.marketplaces.map(async (marketplace) => ({
            name: marketplace.name,
            kinds: [kind],
            path: marketplace.path,
            plugins: await Promise.all(
              marketplace.plugins.map(async (plugin) => ({
                availability: plugin.availability,
                brandColor: plugin.interface?.brandColor ?? null,
                capabilities: plugin.interface?.capabilities ?? [],
                category: plugin.interface?.category ?? null,
                description:
                  plugin.interface?.shortDescription ?? plugin.interface?.longDescription ?? null,
                developerName: plugin.interface?.developerName ?? null,
                displayName: plugin.interface?.displayName ?? plugin.name,
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
                sourceType: plugin.source.type,
                sourceKinds: [kind],
                version: plugin.localVersion ?? plugin.version,
              }))
            ),
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
          marketplaces: [],
          errors: [
            {
              path: `source:${kind}`,
              message: `${kind}: ${error instanceof Error ? error.message : "Unable to load source"}`,
            },
          ],
        }
      }
    })
  )
  const merged = new Map<string, CodexMarketplaceView>()
  for (const market of results.flatMap((result) => result.marketplaces)) {
    const key = JSON.stringify([market.name, market.path])
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, market)
      continue
    }
    existing.kinds = [...new Set([...(existing.kinds ?? []), ...(market.kinds ?? [])])]
    for (const plugin of market.plugins) {
      const previous = existing.plugins.find((item) => item.id === plugin.id)
      if (!previous) existing.plugins.push(plugin)
      else {
        previous.sourceKinds = [
          ...new Set([...(previous.sourceKinds ?? []), ...(plugin.sourceKinds ?? [])]),
        ]
        previous.featured ||= plugin.featured
      }
    }
  }
  return { errors: results.flatMap((result) => result.errors), marketplaces: [...merged.values()] }
}

export const removeCodexMarketplace = async (
  bridge: CodexAppServerBridge,
  marketplaceName: string
): Promise<{ marketplaceName: string; succeeded: true }> => {
  const current = await bridge.request<"plugin/list", v2.PluginListResponse>("plugin/list", {
    marketplaceKinds: ["local"],
    forceRefetch: true,
    cwds: null,
  })
  if (current.marketplaceLoadErrors.length)
    throw new Error("Refresh marketplace sources before removing one.")
  const matches = current.marketplaces.filter(
    (market) => market.name === marketplaceName && market.path !== null
  )
  if (matches.length !== 1)
    throw new Error("The local marketplace could not be uniquely resolved. Refresh and try again.")
  if (matches[0]?.plugins.some((plugin) => plugin.installed))
    throw new Error("Uninstall this marketplace’s plugins before removing its source.")
  await bridge.request<"marketplace/remove", v2.MarketplaceRemoveResponse>("marketplace/remove", {
    marketplaceName,
  })
  return { marketplaceName, succeeded: true }
}

export const installCodexPlugin = async (
  bridge: CodexAppServerBridge,
  plugin: CodexPluginLocator
): Promise<CodexPluginInstallResult> => {
  const response = await bridge.request<"plugin/install", v2.PluginInstallResponse>(
    "plugin/install",
    {
      installAttemptId: crypto.randomUUID(),
      marketplacePath: plugin.marketplacePath,
      remoteMarketplaceName: plugin.marketplacePath ? null : plugin.marketplaceName,
      pluginName: plugin.pluginName,
    }
  )
  return {
    appsNeedingAuth: response.appsNeedingAuth.map((app) => app.name),
    installed: true,
  }
}

export const uninstallCodexPlugin = async (
  bridge: CodexAppServerBridge,
  pluginId: string
): Promise<{ uninstalled: true }> => {
  await bridge.request("plugin/uninstall", { pluginId })
  return { uninstalled: true }
}

export const setCodexPluginEnabled = async (
  bridge: CodexAppServerBridge,
  pluginId: string,
  enabled: boolean
): Promise<{ enabled: boolean }> => {
  await bridge.request<"config/value/write", v2.ConfigWriteResponse>("config/value/write", {
    keyPath: `plugins.${pluginId}.enabled`,
    mergeStrategy: "upsert",
    value: enabled,
  })
  return { enabled }
}

export const listCodexSkills = async (
  bridge: CodexAppServerBridge,
  options: { cwd?: string; forceReload?: boolean }
): Promise<CodexSkillListResult> => {
  const response = await bridge.request<"skills/list", v2.SkillsListResponse>("skills/list", {
    cwds: options.cwd ? [options.cwd] : [],
    forceReload: options.forceReload ?? false,
  })

  return {
    errors: response.data.flatMap((entry) =>
      entry.errors.map((error) => ({ message: error.message, path: error.path ?? null }))
    ),
    skills: response.data.flatMap((entry) =>
      entry.skills.map((skill) => ({
        brandColor: skill.interface?.brandColor ?? null,
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
        scope: skill.scope,
      }))
    ),
  }
}

export const setCodexSkillEnabled = async (
  bridge: CodexAppServerBridge,
  path: string,
  enabled: boolean
): Promise<{ enabled: boolean }> => {
  await bridge.request<"skills/config/write", v2.SkillsConfigWriteResponse>("skills/config/write", {
    enabled,
    path,
  })
  return { enabled }
}

export const addCodexMarketplace = async (
  bridge: CodexAppServerBridge,
  input: { refName?: string; source: string; sparsePaths?: string[] }
): Promise<{ marketplaceName: string | null; succeeded: true }> => {
  const response = await bridge.request<"marketplace/add", v2.MarketplaceAddResponse>(
    "marketplace/add",
    {
      refName: input.refName ?? null,
      source: input.source,
      sparsePaths: input.sparsePaths ?? null,
    }
  )
  return { marketplaceName: response.marketplaceName, succeeded: true }
}

export const upgradeCodexMarketplaces = async (
  bridge: CodexAppServerBridge,
  marketplaceName?: string
): Promise<{ marketplaceName: string | null; succeeded: true }> => {
  await bridge.request<"marketplace/upgrade", v2.MarketplaceUpgradeResponse>(
    "marketplace/upgrade",
    { marketplaceName: marketplaceName ?? null }
  )
  return { marketplaceName: marketplaceName ?? null, succeeded: true }
}
