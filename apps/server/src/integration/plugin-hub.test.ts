import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentId, MarketplaceView, PluginView } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { InMemoryPluginMarketplaceRegistry, PluginHub } from "./plugin-hub.js"
import type {
  MarketplaceState,
  PluginInstallValue,
  PluginListValue,
  PluginProvider,
} from "./plugin-provider.js"

type FakePlugin = { enabled: boolean; installed: boolean; scopes?: ("user" | "project")[] }
type FakeMarket = { kind?: MarketplaceView["sourceKind"]; plugins: Record<string, FakePlugin> }

const plugin = (agentId: AgentId, market: string, name: string, state: FakePlugin): PluginView => ({
  availability: "AVAILABLE",
  brandColor: null,
  capabilities: [],
  category: null,
  compatibility: [agentId as "claude" | "codex"],
  description: null,
  developerName: null,
  displayName: name,
  ecosystem: agentId === "codex" ? "openai" : "claude",
  enabled: state.enabled,
  featured: false,
  harness: { agentId, nativeId: `${name}@${market}` },
  id: `${name}@${market}`,
  installed: state.installed,
  installedScopes: state.scopes ?? (state.installed ? ["user"] : []),
  installPolicy: "AVAILABLE",
  logoUrl: null,
  marketplaceName: market,
  marketplacePath: agentId === "codex" ? `/codex/${market}.json` : null,
  name,
  sourceType: "local",
  version: null,
})

const fake = (agentId: AgentId, initial: Record<string, FakeMarket> = {}) => {
  const markets: Record<string, FakeMarket> = structuredClone(initial)
  const states: Record<string, MarketplaceState> = {}
  const calls: string[] = []
  const addedName = { current: "team" }
  const installValue: { current: PluginInstallValue } = {
    current: { appsNeedingAuth: [], installed: true, reloadPending: false },
  }
  const provider: PluginProvider = {
    agentId,
    enabled: true,
    capabilities: {
      addMarketplace: true,
      configure: false,
      install: true,
      readDetail: true,
      removeMarketplace: true,
      scopes: ["user", "project", "local"],
      setEnabled: true,
      uninstall: true,
      upgradeMarketplace: true,
    },
    addMarketplace: vi.fn(async (input) => {
      calls.push(`add:${input.source}`)
      const target = fakeSupport[input.source]
      if (!target?.includes(agentId)) throw new Error(`${agentId} cannot read ${input.source}`)
      markets[addedName.current] ??= { plugins: {} }
      states[addedName.current] ??= "ok"
      return { marketplaceName: addedName.current }
    }),
    install: vi.fn(async (locator) => {
      calls.push(`install:${locator.pluginName}`)
      if (installValue.current.installed) {
        const entry = markets[locator.marketplaceName]?.plugins[locator.pluginName]
        if (entry) entry.installed = true
      }
      return installValue.current
    }),
    list: vi.fn(
      async (): Promise<PluginListValue> => ({
        capabilities: provider.capabilities,
        errors: [],
        marketplaces: Object.entries(markets).map(([name, market]) => ({
          displayName: name,
          name,
          path: null,
          plugins: Object.entries(market.plugins).map(([pluginName, state]) =>
            plugin(agentId, name, pluginName, state)
          ),
          sourceKind: market.kind ?? "custom",
        })),
      })
    ),
    marketplaceState: vi.fn(async (name) => states[name] ?? (markets[name] ? "ok" : "missing")),
    read: vi.fn(),
    removeMarketplace: vi.fn(async ({ name }) => {
      calls.push(`remove-market:${name}`)
      delete markets[name]
      return { succeeded: true as const, uninstalledPlugins: [] }
    }),
    setEnabled: vi.fn(async ({ enabled, id }) => {
      calls.push(`${enabled ? "enable" : "disable"}:${id}`)
      const [name, market] = id.split("@")
      const entry = markets[market ?? ""]?.plugins[name ?? ""]
      if (entry) entry.enabled = enabled
    }),
    setGlobalEnabled: vi.fn(),
    uninstall: vi.fn(async ({ id, scope }) => {
      calls.push(`uninstall:${id}${scope ? `:${scope}` : ""}`)
      const [name, market] = id.split("@")
      const entry = markets[market ?? ""]?.plugins[name ?? ""]
      if (entry) Object.assign(entry, { enabled: false, installed: false })
    }),
    upgradeMarketplace: vi.fn(async (name) => {
      calls.push(`upgrade:${name ?? "all"}`)
    }),
  }
  return { addedName, calls, installValue, markets, provider, states }
}

// Which Agents can read each marketplace source in these tests.
const fakeSupport: Record<string, AgentId[]> = {
  "acme/both": ["codex", "claude"],
  "acme/claude-only": ["claude"],
}

const hubOf = (codex: ReturnType<typeof fake>, claude: ReturnType<typeof fake>) => {
  const registry = new InMemoryPluginMarketplaceRegistry()
  const hub = new PluginHub(
    new Map<AgentId, PluginProvider>([
      ["codex", codex.provider],
      ["claude", claude.provider],
    ]),
    registry
  )
  return { hub, registry }
}

const team = (plugins: Record<string, FakePlugin>): Record<string, FakeMarket> => ({
  team: { plugins },
})
const off: FakePlugin = { enabled: false, installed: false }

describe("PluginHub", () => {
  it("adds a marketplace for every Agent that can read it and remembers the source", async () => {
    const codex = fake("codex")
    const claude = fake("claude")
    const { hub, registry } = hubOf(codex, claude)
    const both = await hub.addMarketplace({ source: "acme/both" })
    expect(both.agents).toEqual([
      { added: true, agentId: "codex", message: null },
      { added: true, agentId: "claude", message: null },
    ])
    expect(await registry.list()).toEqual([
      { name: "team", refName: undefined, source: "acme/both", sparsePaths: undefined },
    ])
    const solo = hubOf(fake("codex"), fake("claude"))
    const single = await solo.hub.addMarketplace({ refName: "v2", source: "acme/claude-only" })
    expect(single.agents.map((agent) => agent.added)).toEqual([false, true])
    expect(single.agents[0]?.message).toContain("cannot read")
    expect(await solo.registry.list()).toEqual([
      { name: "team", refName: "v2", source: "acme/claude-only", sparsePaths: undefined },
    ])
    await expect(hub.addMarketplace({ source: "acme/nobody" })).rejects.toThrow(
      /codex: codex cannot read[\s\S]*claude: claude cannot read/u
    )
  })

  it("refuses sources that are malformed, carry credentials, or point nowhere", async () => {
    const { hub } = hubOf(fake("codex"), fake("claude"))
    const bad = [
      "",
      "--claudeai",
      "https://user:secret@example.com/team.git",
      "https://TOKEN@github.com/acme/team.git",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "./relative/dir",
      "/definitely/not/here",
      "not a source",
      "acme/team\nextra",
    ]
    for (const source of bad) {
      await expect(hub.addMarketplace({ source }), source).rejects.toMatchObject({
        name: "INTEGRATION_INVALID",
      })
    }
    await expect(
      hub.addMarketplace({ refName: "--upload-pack=x", source: "acme/both" })
    ).rejects.toMatchObject({ name: "INTEGRATION_INVALID" })
    await expect(
      hub.addMarketplace({ source: "acme/both", sparsePaths: ["../escape"] })
    ).rejects.toMatchObject({ name: "INTEGRATION_INVALID" })
  })

  it("checks a local marketplace directory before any Agent reads it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-market-"))
    try {
      const { hub } = hubOf(fake("codex"), fake("claude"))
      await expect(hub.addMarketplace({ source: directory })).rejects.toThrow("has none of")
      await mkdir(join(directory, ".claude-plugin"), { recursive: true })
      await writeFile(join(directory, ".claude-plugin", "marketplace.json"), "{}")
      // The directory now qualifies; the fake Agents simply do not know this path.
      await expect(hub.addMarketplace({ source: directory })).rejects.toThrow("cannot read")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("rolls back when the Agents read different names from the marketplace files", async () => {
    const codex = fake("codex")
    const claude = fake("claude")
    claude.addedName.current = "team-claude"
    const { hub, registry } = hubOf(codex, claude)
    await expect(hub.addMarketplace({ source: "acme/both" })).rejects.toThrow(
      /different names \(codex: team, claude: team-claude\)/u
    )
    expect(codex.calls).toContain("remove-market:team")
    expect(claude.calls).toContain("remove-market:team-claude")
    expect(await registry.list()).toEqual([])
  })

  it("refuses names a source may not take, and rolls back", async () => {
    for (const name of ["cypheria-bundled", "openai-curated", "bad name"]) {
      const codex = fake("codex")
      const claude = fake("claude")
      codex.addedName.current = name
      claude.addedName.current = name
      const { hub, registry } = hubOf(codex, claude)
      await expect(hub.addMarketplace({ source: "acme/both" }), name).rejects.toMatchObject({
        name: "INTEGRATION_INVALID",
      })
      expect(codex.calls).toContain(`remove-market:${name}`)
      expect(await registry.list()).toEqual([])
    }
  })

  it("does not take over a name that was added from a different source", async () => {
    const codex = fake("codex", team({}))
    const claude = fake("claude")
    const { hub, registry } = hubOf(codex, claude)
    await registry.upsert({ name: "team", source: "acme/original" })
    await expect(hub.addMarketplace({ source: "acme/both" })).rejects.toThrow(
      "already added from acme/original"
    )
    // Claude gained the registration in this call, so it is undone; Codex already had it.
    expect(claude.calls).toContain("remove-market:team")
    expect(codex.calls).not.toContain("remove-market:team")
    expect(await registry.list()).toEqual([{ name: "team", source: "acme/original" }])
  })

  it("treats a registration the Agent cannot read as not added", async () => {
    const codex = fake("codex")
    const claude = fake("claude")
    claude.states.team = "unsupported"
    const { hub } = hubOf(codex, claude)
    const result = await hub.addMarketplace({ source: "acme/both" })
    expect(result.agents).toEqual([
      { added: true, agentId: "codex", message: null },
      expect.objectContaining({ added: false, agentId: "claude" }),
    ])
  })

  it("installs a plugin for every Agent that lists it and enables it there", async () => {
    const codex = fake("codex", team({ tool: off }))
    const claude = fake("claude", team({ tool: off }))
    const other = fake("claude", { other: { plugins: { tool: off } } })
    const { hub } = hubOf(codex, claude)
    const results = await hub.install({ marketplaceName: "team", pluginName: "tool" })
    expect(results.map((result) => [result.agentId, result.status])).toEqual([
      ["codex", "done"],
      ["claude", "done"],
    ])
    expect(codex.calls).toEqual(["install:tool", "enable:tool@team"])
    expect(claude.calls).toEqual(["install:tool", "enable:tool@team"])
    expect(other.calls).toEqual([])
    await expect(hub.install({ marketplaceName: "team", pluginName: "absent" })).rejects.toThrow(
      "not listed"
    )
  })

  it("reports an install command that needs review for that Agent only", async () => {
    const codex = fake("codex", team({ tool: off }))
    const claude = fake("claude", team({ tool: off }))
    const sha256 = "c".repeat(64)
    claude.installValue.current = {
      confirmation: { command: "my-tool path", pluginId: "tool@team", sha256 },
      installed: false,
    }
    const { hub } = hubOf(codex, claude)
    const results = await hub.install({ marketplaceName: "team", pluginName: "tool" })
    expect(results).toEqual([
      { agentId: "codex", appsNeedingAuth: [], reloadPending: false, status: "done" },
      {
        agentId: "claude",
        confirmation: { command: "my-tool path", pluginId: "tool@team", sha256 },
        status: "confirmation_required",
      },
    ])
    claude.installValue.current = { appsNeedingAuth: [], installed: true, reloadPending: false }
    const retry = await hub.install({
      acceptCommands: { claude: sha256 },
      agentIds: ["claude"],
      marketplaceName: "team",
      pluginName: "tool",
    })
    expect(retry.map((result) => result.status)).toEqual(["done"])
    expect(claude.provider.install).toHaveBeenLastCalledWith(
      expect.objectContaining({ acceptCommandSha256: sha256 })
    )
  })

  it("enables and disables one Agent without touching the others", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake("claude", team({ tool: { enabled: true, installed: true } }))
    const { hub } = hubOf(codex, claude)
    await hub.setEnabled({
      agentId: "claude",
      enabled: false,
      marketplaceName: "team",
      pluginName: "tool",
    })
    expect(claude.calls).toEqual(["disable:tool@team"])
    expect(codex.calls).toEqual([])
    expect(await hub.agents({ marketplaceName: "team", pluginName: "tool" })).toEqual([
      expect.objectContaining({ agentId: "codex", enabled: true, installed: true }),
      expect.objectContaining({ agentId: "claude", enabled: false, installed: true }),
    ])
  })

  it("installs into an Agent that gains support only when the user enables it there", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake("claude", team({ tool: off }))
    const { hub } = hubOf(codex, claude)
    expect(await hub.agents({ marketplaceName: "team", pluginName: "tool" })).toEqual([
      expect.objectContaining({ agentId: "codex", enabled: true }),
      expect.objectContaining({ agentId: "claude", enabled: false, installed: false }),
    ])
    await hub.setEnabled({
      agentId: "claude",
      enabled: true,
      marketplaceName: "team",
      pluginName: "tool",
    })
    expect(claude.calls).toEqual(["install:tool", "enable:tool@team"])
  })

  it("adds an Agent that gained support after an update, and leaves its plugins off", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake("claude")
    const { hub, registry } = hubOf(codex, claude)
    await registry.upsert({ name: "team", source: "acme/both" })
    const result = await hub.upgradeMarketplace("team")
    expect(result.added).toEqual([{ agentId: "claude", marketplaceName: "team" }])
    expect(result.removed).toEqual([])
    expect(codex.calls).toEqual(["upgrade:team"])
    expect(claude.calls).toEqual(["add:acme/both"])
  })

  it("removes an Agent that lost support, uninstalling its plugins", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake("claude", team({ tool: { enabled: true, installed: true } }))
    claude.states.team = "unsupported"
    const { hub, registry } = hubOf(codex, claude)
    await registry.upsert({ name: "team", source: "acme/both" })
    const result = await hub.upgradeMarketplace("team")
    expect(result.removed).toEqual([{ agentId: "claude", marketplaceName: "team" }])
    expect(claude.calls).toEqual(["upgrade:team", "uninstall:tool@team:user", "remove-market:team"])
    expect(codex.calls).toEqual(["upgrade:team"])
  })

  it("uninstalls plugins that left an Agent's marketplace file", async () => {
    const claude = fake(
      "claude",
      team({ keep: { enabled: true, installed: true }, gone: { enabled: true, installed: true } })
    )
    const codex = fake("codex")
    const { hub } = hubOf(codex, claude)
    claude.provider.upgradeMarketplace = vi.fn(async () => {
      claude.calls.push("upgrade:team")
      delete claude.markets.team?.plugins.gone
    })
    // The plugin is still installed in the harness but no longer listed: model that by listing it once.
    const list = claude.provider.list
    let first = true
    claude.provider.list = vi.fn(async (input) => {
      const value = await list(input)
      if (!first) return value
      first = false
      return {
        ...value,
        marketplaces: value.marketplaces.map((market) => ({
          ...market,
          plugins: [
            ...market.plugins,
            plugin("claude", "team", "gone", { enabled: true, installed: true }),
          ].filter(
            (entry, index, all) => all.findIndex((other) => other.name === entry.name) === index
          ),
        })),
      }
    })
    await hub.upgradeMarketplace("team")
    expect(claude.calls).toContain("uninstall:gone@team:user")
    expect(claude.calls).not.toContain("uninstall:keep@team:user")
  })

  it("previews the plugins a marketplace removal would uninstall, then removes it everywhere", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake(
      "claude",
      team({ tool: { enabled: false, installed: true, scopes: ["user", "project"] } })
    )
    const { hub, registry } = hubOf(codex, claude)
    await registry.upsert({ name: "team", source: "acme/both" })
    expect(await hub.removeMarketplace({ name: "team" })).toEqual({
      affectedPlugins: ["tool@team"],
      succeeded: false,
    })
    expect(codex.calls).toEqual([])
    expect(await hub.removeMarketplace({ confirmUninstall: true, name: "team" })).toEqual({
      succeeded: true,
      uninstalledPlugins: ["tool@team"],
    })
    expect(codex.calls).toEqual(["uninstall:tool@team:user", "remove-market:team"])
    expect(claude.calls).toEqual([
      "uninstall:tool@team:user",
      "uninstall:tool@team:project",
      "remove-market:team",
    ])
    expect(await registry.list()).toEqual([])
  })

  it("refuses to remove an official marketplace before changing anything", async () => {
    const codex = fake("codex", { team: { kind: "openai", plugins: {} } })
    const claude = fake("claude", team({}))
    const { hub } = hubOf(codex, claude)
    await expect(hub.removeMarketplace({ confirmUninstall: true, name: "team" })).rejects.toThrow(
      "Official marketplaces cannot be removed"
    )
    expect(claude.calls).toEqual([])
  })

  it("leaves an Agent with plugins turned off out of every operation", async () => {
    const codex = fake("codex", team({ tool: off }))
    const claude = fake("claude", team({ tool: off }))
    ;(claude.provider as { enabled: boolean }).enabled = false
    const { hub } = hubOf(codex, claude)
    const results = await hub.install({ marketplaceName: "team", pluginName: "tool" })
    expect(results.map((result) => result.agentId)).toEqual(["codex"])
    expect(
      (await hub.agents({ marketplaceName: "team", pluginName: "tool" })).map(
        (state) => state.agentId
      )
    ).toEqual(["codex"])
    const added = await hub.addMarketplace({ source: "acme/both" })
    expect(added.agents.map((agent) => agent.agentId)).toEqual(["codex"])
    await expect(
      hub.setEnabled({
        agentId: "claude",
        enabled: true,
        marketplaceName: "team",
        pluginName: "tool",
      })
    ).rejects.toMatchObject({ name: "INTEGRATION_DISABLED" })
    expect(claude.calls).toEqual([])
  })

  it("uninstalls from every Agent that holds the plugin", async () => {
    const codex = fake("codex", team({ tool: { enabled: true, installed: true } }))
    const claude = fake(
      "claude",
      team({ tool: { enabled: false, installed: true, scopes: ["project"] } })
    )
    const { hub } = hubOf(codex, claude)
    expect(await hub.uninstall({ marketplaceName: "team", pluginName: "tool" })).toEqual([
      "codex",
      "claude",
    ])
    expect(claude.calls).toEqual(["uninstall:tool@team:project"])
  })
})
