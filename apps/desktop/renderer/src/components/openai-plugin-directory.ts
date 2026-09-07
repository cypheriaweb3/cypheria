import type { CodexMarketplaceView, CodexPluginView } from "../../../ipc/src/index.js"

const openAiRemoteMarketplaceName = "openai-curated-remote"
const popularPageSize = 50

const categoryName = (plugin: CodexPluginView) => plugin.category?.trim() || "Other"

const isOtherCategory = (category: string) => category.trim().toLocaleLowerCase() === "other"

const uniquePlugins = (plugins: CodexPluginView[]) => {
  const ids = new Set<string>()
  return plugins.filter((plugin) => {
    if (ids.has(plugin.id)) return false
    ids.add(plugin.id)
    return true
  })
}

/**
 * Codex Desktop gets its complete directory sections from a private ChatGPT
 * endpoint. App Server does not expose those sections, but the remote OpenAI
 * marketplace is returned in the same order as the Popular category. Match the
 * first category page without guessing how Desktop merges other marketplaces.
 */
export const openAiPopularPlugins = (marketplaces: CodexMarketplaceView[]) => {
  const openAiMarketplaces = marketplaces.filter((marketplace) => marketplace.catalog === "openai")
  const remoteMarketplace = openAiMarketplaces.find(
    (marketplace) => marketplace.name === openAiRemoteMarketplaceName
  )

  if (!remoteMarketplace)
    return uniquePlugins(
      openAiMarketplaces.flatMap((marketplace) =>
        marketplace.plugins.filter((plugin) => plugin.featured)
      )
    )

  return uniquePlugins(remoteMarketplace.plugins.slice(0, popularPageSize))
}

export const openAiPluginCategories = (plugins: CodexPluginView[]) => {
  const categories = Array.from(new Set(plugins.map(categoryName)))
  return categories.sort((left, right) => {
    if (isOtherCategory(left)) return isOtherCategory(right) ? 0 : 1
    return isOtherCategory(right) ? -1 : 0
  })
}

export const pluginsInOpenAiCategory = (plugins: CodexPluginView[], category: string) =>
  plugins.filter((plugin) => categoryName(plugin) === category)
