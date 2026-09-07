import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"
import {
  addCodexMarketplace,
  installCodexPlugin,
  listCodexPlugins,
  listCodexSkills,
  readCodexPlugin,
  removeCodexMarketplace,
  setCodexPluginEnabled,
  setCodexSkillEnabled,
  uninstallCodexPlugin,
  upgradeCodexMarketplaces,
} from "./codex-plugins.js"

class FakeBridge {
  readonly calls: Array<{ method: string; params: unknown }> = []
  constructor(private readonly responses: Record<string, unknown>) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    return this.responses[method] ?? {}
  }
}

const asBridge = (bridge: FakeBridge) => bridge as unknown as CodexAppServerBridge

describe("desktop plugin and skill services", () => {
  it("reports an App Server catalog failure", async () => {
    const bridge = {
      request: async () => {
        throw new Error("ChatGPT authentication required for remote plugin catalog")
      },
    } as unknown as CodexAppServerBridge
    const result = await listCodexPlugins(bridge, {})
    expect(result.marketplaces).toEqual([])
    expect(result.errors).toEqual([
      {
        path: "catalog:app-server",
        message: "ChatGPT authentication required for remote plugin catalog",
      },
    ])
  })
  it("revalidates marketplace removal and never implicitly uninstalls plugins", async () => {
    const builtInBridge = new FakeBridge({})
    await expect(removeCodexMarketplace(asBridge(builtInBridge), "openai-curated")).rejects.toThrow(
      "cannot be removed"
    )
    expect(builtInBridge.calls).toEqual([])
    await expect(
      removeCodexMarketplace(asBridge(builtInBridge), "cypheria-curated")
    ).rejects.toThrow("cannot be removed")
    expect(builtInBridge.calls).toEqual([])

    for (const scenario of ["installed", "missing", "ambiguous", "load-error", "remote"]) {
      const market = {
        name: "team",
        path: scenario === "remote" ? null : "/market/team",
        plugins: [{ installed: scenario === "installed" }],
      }
      const bridge = new FakeBridge({
        "plugin/list": {
          marketplaces:
            scenario === "missing" ? [] : scenario === "ambiguous" ? [market, market] : [market],
          marketplaceLoadErrors: scenario === "load-error" ? [{ message: "Failed" }] : [],
        },
      })
      await expect(removeCodexMarketplace(asBridge(bridge), "team")).rejects.toThrow()
      expect(bridge.calls.map((call) => call.method)).toEqual(["plugin/list"])
    }
    const bridge = new FakeBridge({
      "plugin/list": {
        marketplaceLoadErrors: [],
        marketplaces: [{ name: "team", path: "/market/team", plugins: [] }],
      },
    })
    await expect(removeCodexMarketplace(asBridge(bridge), "team")).resolves.toEqual({
      marketplaceName: "team",
      succeeded: true,
    })
    expect(bridge.calls[1]).toEqual({
      method: "marketplace/remove",
      params: { marketplaceName: "team" },
    })
  })
  it("classifies marketplaces by trusted marketplace-name allowlists", async () => {
    const bridge = {
      request: async () => ({
        featuredPluginIds: [],
        marketplaceLoadErrors: [],
        marketplaces: [
          {
            interface: { displayName: "OpenAI" },
            name: "openai-curated-remote",
            path: null,
            plugins: [],
          },
          {
            interface: { displayName: "Built in" },
            name: "openai-bundled",
            path: "/market/bundled",
            plugins: [],
          },
          {
            interface: { displayName: "Runtime" },
            name: "openai-primary-runtime",
            path: "/market/runtime",
            plugins: [],
          },
          {
            interface: { displayName: "My tools" },
            name: "my-tools",
            path: "/market/my-tools",
            plugins: [],
          },
          {
            interface: { displayName: "Cypheria Marketplace" },
            name: "cypheria-curated",
            path: "/market/cypheria",
            plugins: [],
          },
          {
            interface: { displayName: "User OpenAI helpers" },
            name: "my-openai-helpers",
            path: "/market/my-openai-helpers",
            plugins: [],
          },
        ],
      }),
    } as unknown as CodexAppServerBridge
    const result = await listCodexPlugins(bridge, {})
    expect(
      result.marketplaces.map(({ catalog, displayName, name }) => ({
        catalog,
        displayName,
        name,
      }))
    ).toEqual([
      { catalog: "openai", displayName: "OpenAI", name: "openai-curated-remote" },
      { catalog: "openai", displayName: "Built in", name: "openai-bundled" },
      { catalog: "openai", displayName: "Runtime", name: "openai-primary-runtime" },
      { catalog: "personal", displayName: "My tools", name: "my-tools" },
      { catalog: "public", displayName: "Cypheria Marketplace", name: "cypheria-curated" },
      {
        catalog: "personal",
        displayName: "User OpenAI helpers",
        name: "my-openai-helpers",
      },
    ])
  })
  it("projects plugin details and keeps local marketplace lookup local", async () => {
    const bridge = new FakeBridge({
      "plugin/read": {
        plugin: {
          summary: {
            interface: { defaultPrompt: ["Review a PR"], longDescription: "Fallback description" },
          },
          description: null,
          shareUrl: null,
          apps: [],
          mcpServers: ["github"],
          skills: [
            {
              name: "review",
              description: "Review changes",
              enabled: true,
              path: "/skills/review/SKILL.md",
            },
          ],
        },
      },
    })
    const result = await readCodexPlugin(asBridge(bridge), {
      marketplaceName: "team",
      marketplacePath: "/marketplaces/team",
      pluginName: "github",
    })
    expect(result).toMatchObject({
      description: "Fallback description",
      prompts: ["Review a PR"],
      mcpServers: ["github"],
      skills: [{ name: "review", enabled: true }],
    })
    expect(bridge.calls[0]).toEqual({
      method: "plugin/read",
      params: {
        marketplacePath: "/marketplaces/team",
        remoteMarketplaceName: null,
        pluginName: "github",
      },
    })
  })
  it("flattens generated App Server plugin metadata into renderer-safe views", async () => {
    const bridge = new FakeBridge({
      "plugin/list": {
        featuredPluginIds: ["github@openai-curated-remote"],
        marketplaceLoadErrors: [],
        marketplaces: [
          {
            interface: { displayName: "OpenAI" },
            name: "openai-curated-remote",
            path: null,
            plugins: [
              {
                authPolicy: "ON_USE",
                availability: "AVAILABLE",
                disabledReason: null,
                eligiblePlanTypes: null,
                enabled: true,
                id: "github@openai-curated-remote",
                installPolicy: "AVAILABLE",
                installPolicySource: null,
                installed: true,
                installedAt: 1,
                interface: {
                  brandColor: "#000000",
                  capabilities: ["apps", "skills"],
                  category: "Coding",
                  composerIcon: null,
                  composerIconUrl: null,
                  defaultPrompt: null,
                  developerName: "OpenAI",
                  displayName: "GitHub",
                  logo: null,
                  logoDark: null,
                  logoUrl: "https://example.test/github.png",
                  logoUrlDark: null,
                  longDescription: null,
                  privacyPolicyUrl: null,
                  screenshots: [],
                  screenshotUrls: [],
                  shortDescription: "Triage PRs and issues",
                  termsOfServiceUrl: null,
                  websiteUrl: null,
                },
                keywords: [],
                localVersion: "1.2.0",
                mustShowInstallationInterstitial: false,
                name: "github",
                remotePluginId: "remote-github",
                shareContext: null,
                source: { type: "remote" },
                version: "1.3.0",
              },
            ],
          },
        ],
      },
    })

    await expect(listCodexPlugins(asBridge(bridge), {})).resolves.toEqual({
      errors: [],
      marketplaces: [
        expect.objectContaining({
          catalog: "openai",
          displayName: "OpenAI",
          name: "openai-curated-remote",
          plugins: [
            expect.objectContaining({
              displayName: "GitHub",
              featured: true,
              logoUrl: "https://example.test/github.png",
              version: "1.2.0",
            }),
          ],
        }),
      ],
    })
    expect(bridge.calls[0]).toMatchObject({
      method: "plugin/list",
      params: { cwds: null, forceRefetch: false },
    })
    expect(bridge.calls[0]?.params).toEqual({ cwds: null, forceRefetch: false })
  })

  it("routes plugin lifecycle and marketplace mutations through generated methods", async () => {
    const bridge = new FakeBridge({
      "marketplace/add": {
        alreadyAdded: false,
        installedRoot: "/marketplaces/team",
        marketplaceName: "team",
      },
      "plugin/install": { appsNeedingAuth: [{ name: "GitHub" }], authPolicy: "ON_INSTALL" },
    })

    await expect(
      installCodexPlugin(asBridge(bridge), {
        marketplaceName: "OpenAI",
        marketplacePath: null,
        pluginName: "github",
      })
    ).resolves.toEqual({ appsNeedingAuth: ["GitHub"], installed: true })
    await expect(uninstallCodexPlugin(asBridge(bridge), "github@openai")).resolves.toEqual({
      uninstalled: true,
    })
    await setCodexPluginEnabled(asBridge(bridge), "github@openai", false)
    await expect(addCodexMarketplace(asBridge(bridge), { source: "org/plugins" })).resolves.toEqual(
      { marketplaceName: "team", succeeded: true }
    )
    await upgradeCodexMarketplaces(asBridge(bridge))

    expect(bridge.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "plugin/install" }),
        { method: "plugin/uninstall", params: { pluginId: "github@openai" } },
        {
          method: "config/value/write",
          params: {
            keyPath: "plugins.github@openai.enabled",
            mergeStrategy: "upsert",
            value: false,
          },
        },
        expect.objectContaining({ method: "marketplace/add" }),
        { method: "marketplace/upgrade", params: { marketplaceName: null } },
      ])
    )
  })

  it("lists and toggles standalone and plugin-owned skills by path", async () => {
    const bridge = new FakeBridge({
      "skills/list": {
        data: [
          {
            cwd: "/workspace",
            errors: [],
            skills: [
              {
                description: "Build reusable skills",
                enabled: true,
                interface: { displayName: "Skill Creator", iconLargeUrl: null, iconSmallUrl: null },
                name: "skill-creator",
                path: "/skills/creator/SKILL.md",
                pluginId: null,
                scope: "system",
              },
            ],
          },
        ],
      },
    })

    await expect(listCodexSkills(asBridge(bridge), { cwd: "/workspace" })).resolves.toEqual({
      errors: [],
      skills: [expect.objectContaining({ displayName: "Skill Creator", scope: "system" })],
    })
    await setCodexSkillEnabled(asBridge(bridge), "/skills/creator/SKILL.md", false)
    expect(bridge.calls.at(-1)).toEqual({
      method: "skills/config/write",
      params: { enabled: false, path: "/skills/creator/SKILL.md" },
    })
  })
})
