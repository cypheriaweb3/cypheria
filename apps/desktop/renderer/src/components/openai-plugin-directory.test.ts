import { describe, expect, it } from "vitest"
import type { CodexMarketplaceView, CodexPluginView } from "../../../ipc/src/index.js"
import {
  openAiPluginCategories,
  openAiPopularPlugins,
  pluginsInOpenAiCategory,
} from "./openai-plugin-directory.js"

const plugin = (
  displayName: string,
  options: { category?: string | null; featured?: boolean } = {}
): CodexPluginView => ({
  availability: "AVAILABLE",
  brandColor: null,
  capabilities: [],
  category: options.category === undefined ? "Productivity" : options.category,
  description: null,
  developerName: null,
  displayName,
  enabled: true,
  featured: options.featured ?? false,
  id: displayName.toLowerCase().replaceAll(" ", "-"),
  installed: false,
  installPolicy: "AVAILABLE",
  logoUrl: null,
  marketplaceName: "openai-curated-remote",
  marketplacePath: null,
  name: displayName.toLowerCase().replaceAll(" ", "-"),
  sourceType: "remote",
  version: "1.0.0",
})

const marketplace = (
  name: string,
  plugins: CodexPluginView[],
  catalog: CodexMarketplaceView["catalog"] = "openai"
): CodexMarketplaceView => ({ catalog, displayName: name, name, path: null, plugins })

describe("OpenAI plugin directory", () => {
  it("uses only the remote marketplace rank for Popular", () => {
    const remoteNames = [
      "Gmail",
      "GitHub",
      "Google Drive",
      "Slack",
      "Outlook Email",
      "Canva",
      "Trello",
      "Google Calendar",
      "Notion",
      "Outlook Calendar",
      "HubSpot",
      "Supabase",
      "Atlassian Rovo",
      "Astrologic",
      "monday.com",
      "Fathom",
    ]
    const popular = openAiPopularPlugins([
      marketplace(
        "openai-curated-remote",
        remoteNames.map((name) => plugin(name))
      ),
      marketplace("openai-bundled", [plugin("Computer Use", { featured: true })]),
      marketplace("openai-primary-runtime", [plugin("Spreadsheets", { featured: true })]),
    ])

    expect(popular.map(({ displayName }) => displayName)).toEqual(remoteNames)
  })

  it("limits the ranked fallback to the first remote category page", () => {
    const popular = openAiPopularPlugins([
      marketplace(
        "openai-curated-remote",
        Array.from({ length: 55 }, (_, index) => plugin(`Plugin ${index + 1}`))
      ),
    ])
    expect(popular).toHaveLength(50)
    expect(popular.at(-1)?.displayName).toBe("Plugin 50")
  })

  it("keeps all category members and always puts Other last", () => {
    const plugins = [
      plugin("No category", { category: null, featured: true }),
      plugin("Finance plugin", { category: "Finance" }),
      plugin("Other plugin", { category: "Other" }),
      plugin("Developer plugin", { category: "Developer Tools" }),
    ]

    expect(openAiPluginCategories(plugins)).toEqual(["Finance", "Developer Tools", "Other"])
    expect(pluginsInOpenAiCategory(plugins, "Other").map(({ displayName }) => displayName)).toEqual(
      ["No category", "Other plugin"]
    )
  })
})
