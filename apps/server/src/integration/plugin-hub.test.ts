import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyDatabaseMigrations,
  createInMemoryDatabase,
  createPluginPersistenceService,
  type PluginPersistenceService,
} from "@cypheria/db"
import type { AgentId, PluginView } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { MarketplaceStore } from "./marketplace-store.js"
import type { PackagePluginProvider } from "./package-plugin-providers.js"
import { type PluginAuditEvent, PluginHub } from "./plugin-hub.js"
import type { PluginListValue, PluginProvider } from "./plugin-provider.js"

type Market = { file: string; name: string; path: string; plugins: string[] }
type FakeState = { enabled: boolean; installed: boolean }

const MARKER: Record<string, string> = {
  claude: ".claude-plugin/marketplace.json",
  codex: ".agents/plugins/marketplace.json",
}

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

/** A catalog Agent that reads its own marketplace file from the directory it is given. */
const catalogAgent = (agentId: "claude" | "codex") => {
  const markets = new Map<string, Market>()
  const states = new Map<string, FakeState>()
  const calls: string[] = []
  const view = (market: Market, name: string): PluginView => {
    const state = states.get(`${name}@${market.name}`) ?? { enabled: false, installed: false }
    return {
      availability: "AVAILABLE",
      brandColor: null,
      capabilities: [],
      category: null,
      compatibility: [agentId],
      description: null,
      developerName: null,
      displayName: name,
      ecosystem: agentId === "codex" ? "openai" : "claude",
      enabled: state.enabled,
      featured: false,
      harness: { agentId, nativeId: `${name}@${market.name}` },
      id: `${name}@${market.name}`,
      installed: state.installed,
      installedScopes: state.installed ? ["user"] : [],
      installPolicy: "AVAILABLE",
      logoUrl: null,
      marketplaceName: market.name,
      marketplacePath: market.path,
      name,
      sourceType: "local",
      version: null,
    }
  }
  const provider: PluginProvider = {
    addMarketplace: vi.fn(async ({ source }) => {
      calls.push(`add:${source}`)
      const raw = await readFile(join(source, MARKER[agentId] ?? ""), "utf8").catch(() => {
        throw new Error(`${agentId} found no marketplace file`)
      })
      const file = JSON.parse(raw) as { name: string; plugins: { name: string }[] }
      markets.set(file.name, {
        file: MARKER[agentId] ?? "",
        name: file.name,
        path: source,
        plugins: file.plugins.map((plugin) => plugin.name),
      })
      return { marketplaceName: file.name }
    }),
    agentId,
    capabilities: {
      addMarketplace: true,
      configure: false,
      install: true,
      readDetail: true,
      removeMarketplace: true,
      scopes: ["user"],
      setEnabled: true,
      uninstall: true,
      upgradeMarketplace: true,
    },
    enabled: true,
    install: vi.fn(async (locator) => {
      calls.push(`install:${locator.pluginName}`)
      states.set(`${locator.pluginName}@${locator.marketplaceName}`, {
        enabled: false,
        installed: true,
      })
      return { appsNeedingAuth: [], installed: true as const, reloadPending: false }
    }),
    list: vi.fn(
      async (): Promise<PluginListValue> => ({
        capabilities: provider.capabilities,
        errors: [],
        marketplaces: [...markets.values()].map((market) => ({
          displayName: market.name,
          name: market.name,
          path: market.path,
          plugins: market.plugins.map((name) => view(market, name)),
          sourceKind: "custom" as const,
        })),
      })
    ),
    marketplaceState: vi.fn(async (name) => (markets.has(name) ? "ok" : "missing")),
    read: vi.fn(),
    removeMarketplace: vi.fn(async ({ name }) => {
      calls.push(`remove-market:${name}`)
      markets.delete(name)
      return { succeeded: true as const, uninstalledPlugins: [] }
    }),
    setEnabled: vi.fn(async ({ enabled, id }) => {
      calls.push(`${enabled ? "enable" : "disable"}:${id}`)
      const state = states.get(id)
      if (state) state.enabled = enabled
    }),
    setGlobalEnabled: vi.fn(),
    uninstall: vi.fn(async ({ id }) => {
      calls.push(`uninstall:${id}`)
      states.delete(id)
    }),
    upgradeMarketplace: vi.fn(async () => undefined),
  }
  return { calls, provider, states }
}

const packageAgent = (agentId: AgentId) => {
  const calls: string[] = []
  const provider: PackagePluginProvider = {
    agentId,
    install: vi.fn(async (plugin) => {
      calls.push(`install:${plugin.installPath}`)
      return { installed: true as const, receipt: { command: "install", nativeId: plugin.name } }
    }),
    setEnabled: vi.fn(async (plugin, _receipt, enabled) => {
      calls.push(`${enabled ? "enable" : "disable"}:${plugin.name}`)
    }),
    supports: () => true,
    uninstall: vi.fn(async (plugin) => {
      calls.push(`uninstall:${plugin.name}`)
    }),
    update: vi.fn(async (plugin, receipt) => {
      calls.push(`update:${plugin.name}`)
      return receipt
    }),
  }
  return { calls, provider }
}

const setup = async (agents: AgentId[] = ["codex", "claude", "pi", "cursor", "goose"]) => {
  const home = await mkdtemp(join(tmpdir(), "cypheria-hub-"))
  const database = createInMemoryDatabase()
  await applyDatabaseMigrations(database.client)
  await database.client.execute("PRAGMA foreign_keys = ON")
  const persistence: PluginPersistenceService = createPluginPersistenceService(database.db)
  const codex = catalogAgent("codex")
  const claude = catalogAgent("claude")
  const pi = packageAgent("pi")
  const audit: PluginAuditEvent[] = []
  const git = {
    run: vi.fn(async (_cwd: string, _args: readonly string[]) => ({ stderr: "", stdout: "" })),
  }
  const store = new MarketplaceStore({ cypheriaHome: home, git })
  const busy = new Set<AgentId>()
  const hub = new PluginHub({
    activeAgents: () => agents,
    isAgentBusy: async (agentId) => busy.has(agentId),
    agentHome: (agentId) => join(home, "agents", agentId, "home"),
    audit: async (event) => {
      audit.push(event)
    },
    packages: new Map([["pi", pi.provider]]),
    persistence,
    providers: new Map<AgentId, PluginProvider>([
      ["codex", codex.provider],
      ["claude", claude.provider],
    ]),
    store,
  })
  return { audit, busy, claude, codex, git, home, hub, persistence, pi, store }
}

/** A local marketplace with a polyglot plugin `review` and a Pi package `pi-tools`. */
const marketplace = async (
  home: string,
  options: { files?: ("claude" | "codex")[]; name?: string } = {}
): Promise<string> => {
  const root = join(home, "team-marketplace")
  const name = options.name ?? "team"
  const plugins = [
    { name: "review", source: { path: "./review", source: "local" } },
    { name: "pi-tools", source: { path: "./pi-tools", source: "local" } },
  ]
  for (const file of options.files ?? ["codex", "claude"]) {
    await writeJson(join(root, MARKER[file] ?? ""), {
      name,
      plugins:
        file === "claude"
          ? plugins.map((entry) => ({ ...entry, source: `./${entry.name}` }))
          : plugins,
    })
  }
  await writeJson(join(root, "review", "plugin.json"), { name: "review", version: "1.0.0" })
  await writeJson(join(root, "review", ".claude-plugin", "plugin.json"), { name: "review" })
  await writeJson(join(root, "review", "mcp.json"), {
    mcpServers: { lint: { args: ["--stdio"], command: "./bin/lint" } },
  })
  await mkdir(join(root, "review", "skills", "triage"), { recursive: true })
  await writeFile(join(root, "review", "skills", "triage", "SKILL.md"), "---\nname: triage\n---\n")
  await writeJson(join(root, "pi-tools", "package.json"), {
    name: "pi-tools",
    pi: { skills: ["./skills"] },
  })
  return root
}

describe("PluginHub", () => {
  it("registers a local marketplace directory in place with every Agent that reads it", async () => {
    const { codex, claude, home, hub, persistence } = await setup()
    const root = await marketplace(home)
    const result = await hub.addMarketplace({ source: root })
    expect(result.marketplaceName).toBe("team")
    expect(result.agents.every((agent) => agent.added)).toBe(true)
    expect(codex.calls).toContain(`add:${root}`)
    expect(claude.calls).toContain(`add:${root}`)
    expect(await persistence.marketplaces.get("team")).toMatchObject({
      isBuiltin: false,
      localPath: root,
      ownerAgentId: null,
      source: root,
    })
  })

  it("fetches a remote marketplace once into the marketplaces directory", async () => {
    const { codex, git, home, hub, persistence } = await setup()
    git.run.mockImplementation(async (cwd: string) => {
      await writeJson(join(cwd, MARKER.codex ?? ""), { name: "remote-team", plugins: [] })
      return { stderr: "", stdout: "" }
    })
    await hub.addMarketplace({ source: "acme/remote-team" })
    const localPath = join(home, "marketplaces", "remote-team")
    expect(await persistence.marketplaces.get("remote-team")).toMatchObject({
      localPath,
      source: "acme/remote-team",
    })
    expect(codex.calls).toContain(`add:${localPath}`)
    expect(
      git.run.mock.calls.some(([, args]) =>
        args.includes("https://github.com/acme/remote-team.git")
      )
    ).toBe(true)
  })

  it("refuses reserved names and names already taken by another source, removing what it created", async () => {
    const { claude, codex, home, hub, persistence } = await setup()
    const reserved = await marketplace(home, { name: "cypheria-tools" })
    await expect(hub.addMarketplace({ source: reserved })).rejects.toThrow(/reserved/u)
    expect(codex.calls.filter((call) => call.startsWith("add:"))).toEqual([])

    const root = await marketplace(home)
    await persistence.marketplaces.upsert({
      displayName: "team",
      id: "team",
      isBuiltin: false,
      localPath: "/elsewhere",
      ownerAgentId: null,
      refName: null,
      source: "acme/other",
      sparsePaths: null,
    })
    await expect(hub.addMarketplace({ source: root })).rejects.toThrow(/already added/u)
    expect(claude.calls).toEqual([])
  })

  it("rolls back when the Agents read different names", async () => {
    const { codex, home, hub } = await setup()
    const root = await marketplace(home, { files: ["codex"] })
    await writeJson(join(root, MARKER.claude ?? ""), { name: "other", plugins: [] })
    await expect(hub.addMarketplace({ source: root })).rejects.toThrow(/different names/u)
    expect(codex.calls).toContain("remove-market:team")
  })

  it("installs and enables natively wherever the package is read, and nowhere else", async () => {
    const { codex, home, hub, persistence, pi } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })

    const results = await hub.install({ marketplaceName: "team", pluginName: "review" })
    expect(results.map((result) => [result.agentId, result.status])).toEqual([
      ["codex", "done"],
      ["claude", "done"],
    ])
    expect(codex.calls).toContain("enable:review@team")
    expect(pi.calls).toEqual([])
    expect(await persistence.plugins.get("review@team")).toMatchObject({
      detectedFormats: ["agent_plugin", "claude"],
      installPath: join(root, "review"),
    })
    expect(await persistence.bindings.get("review@team", "cursor")).toBeUndefined()

    await hub.install({ marketplaceName: "team", pluginName: "pi-tools" })
    // Package Agents install an immutable copy of the plugin's current revision.
    expect(pi.calls).toEqual([
      expect.stringMatching(/^install:.*\/plugins\/cache\/team\/pi-tools\/local-[a-f0-9]{12}$/u),
    ])
    expect(await persistence.bindings.get("pi-tools@team", "pi")).toMatchObject({
      enabled: true,
    })
  })

  it("refuses to enable a plugin in an Agent that reads none of its formats", async () => {
    const { home, hub, persistence } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "review" })
    await expect(
      hub.setEnabled({
        agentId: "cursor",
        enabled: true,
        marketplaceName: "team",
        pluginName: "review",
      })
    ).rejects.toThrow(/does not read any of/u)
    expect(await persistence.bindings.get("review@team", "cursor")).toBeUndefined()
  })

  it("offers no switch to a catalog Agent for a plugin of a marketplace it does not read", async () => {
    const { home, hub } = await setup()
    const root = await marketplace(home, { files: ["claude"] })
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "review" })
    const listed = await hub.list("codex", {})
    const review = listed.marketplaces
      .flatMap((entry) => entry.plugins)
      .find((plugin) => plugin.name === "review")
    expect(review).toMatchObject({ installed: true, supported: false })
  })

  it("updates an idle Agent's copy of a changed plugin and leaves a busy one for later", async () => {
    const { audit, busy, home, hub, persistence, pi, store } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "pi-tools" })
    const installed = (await persistence.bindings.get("pi-tools@team", "pi"))?.installedSha256
    expect(installed).toMatch(/^[a-f0-9]{64}$/u)
    const snapshot = join(
      home,
      "plugins",
      "cache",
      "team",
      "pi-tools",
      `local-${installed?.slice(0, 12)}`
    )

    vi.spyOn(store, "refresh").mockImplementation(async () => {
      await writeFile(join(root, "pi-tools", "README.md"), "changed")
    })
    busy.add("pi")
    await hub.upgradeMarketplace("team")
    // A running session keeps the revision it started with, untouched by the refresh.
    expect(pi.calls.filter((call) => call.startsWith("update:"))).toEqual([])
    await expect(readFile(join(snapshot, "README.md"), "utf8")).rejects.toThrow()

    busy.delete("pi")
    vi.spyOn(store, "refresh").mockResolvedValue()
    await hub.upgradeMarketplace("team")
    expect(pi.calls.filter((call) => call.startsWith("update:"))).toEqual(["update:pi-tools"])
    const updated = (await persistence.bindings.get("pi-tools@team", "pi"))?.installedSha256
    expect(updated).not.toBe(installed)
    const [plugin] = vi.mocked(pi.provider.update ?? vi.fn()).mock.calls.at(-1) ?? []
    expect(plugin?.installPath).toBe(
      join(home, "plugins", "cache", "team", "pi-tools", `local-${updated?.slice(0, 12)}`)
    )
    expect(await readFile(join(plugin?.installPath ?? "", "README.md"), "utf8")).toBe("changed")
    await expect(readdir(snapshot)).rejects.toThrow()
    expect(audit.map((event) => event.eventType)).toContain("plugin.native.updated")

    await hub.upgradeMarketplace("team")
    expect(pi.calls.filter((call) => call.startsWith("update:"))).toHaveLength(1)
  })

  it("reinstalls through the install path, with its confirmation, when enabling installs again", async () => {
    const { home, hub, pi } = await setup()
    Object.assign(pi.provider, { enableInstalls: true })
    vi.mocked(pi.provider.install).mockImplementation(async (plugin, options) => {
      pi.calls.push(`install:${plugin.installPath}`)
      if (options?.acceptCommandSha256 !== "a".repeat(64)) {
        return {
          confirmation: {
            command: "pi install npm:x",
            pluginId: plugin.id,
            sha256: "a".repeat(64),
          },
          installed: false,
        }
      }
      return { installed: true, receipt: { command: "install", nativeId: plugin.name } }
    })
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({
      acceptCommands: { pi: "a".repeat(64) },
      marketplaceName: "team",
      pluginName: "pi-tools",
    })
    await hub.setEnabled({
      agentId: "pi",
      enabled: false,
      marketplaceName: "team",
      pluginName: "pi-tools",
    })
    const pending = await hub.setEnabled({
      agentId: "pi",
      enabled: true,
      marketplaceName: "team",
      pluginName: "pi-tools",
    })
    expect(pending.status).toBe("confirmation_required")
    expect(pi.calls).not.toContain("enable:pi-tools")
  })

  it("registers an Agent catalog with the catalog Agents that read its marketplace file", async () => {
    const { claude, codex, home, hub } = await setup()
    const catalog = join(home, "marketplaces", "copilot-plugins")
    await writeJson(join(catalog, ".claude-plugin", "marketplace.json"), {
      name: "copilot-plugins",
      plugins: [{ name: "workiq", source: "./plugins/workiq" }],
    })
    await hub.list("claude", {})
    await vi.waitFor(() => expect(claude.calls).toContain(`add:${catalog}`))
    await vi.waitFor(() => expect(codex.calls).toContain(`add:${catalog}`))
    expect(codex.calls.some((call) => call.includes("xai-official"))).toBe(false)
  })

  it("never registers the Cursor catalog, whose Claude marketplace file lists only part of it", async () => {
    const { claude, codex, home, hub } = await setup()
    const catalog = join(home, "marketplaces", "cursor-plugins")
    await writeJson(join(catalog, ".claude-plugin", "marketplace.json"), {
      name: "cursor-plugins",
      plugins: [{ name: "origin-apps", source: "./origin-apps" }],
    })
    await hub.list("claude", {})
    await hub.upgradeMarketplace("cursor-plugins")
    expect([...claude.calls, ...codex.calls].some((call) => call.includes(catalog))).toBe(false)
  })

  it("reports which Agents support the plugin", async () => {
    const { home, hub } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "review" })
    const states = await hub.agents({ marketplaceName: "team", pluginName: "review" })
    expect(states.map((state) => [state.agentId, state.supported, state.enabled])).toEqual([
      ["codex", true, true],
      ["claude", true, true],
      ["pi", false, false],
      ["cursor", false, false],
      ["goose", false, false],
    ])
  })

  it("uninstalls natively and forgets the plugin", async () => {
    const { codex, home, hub, persistence } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "review" })
    const removed = await hub.uninstall({ marketplaceName: "team", pluginName: "review" })
    expect(removed.sort()).toEqual(["claude", "codex"])
    expect(codex.calls).toContain("uninstall:review@team")
    expect(await persistence.plugins.get("review@team")).toBeUndefined()
    expect(await persistence.bindings.list({ pluginId: "review@team" })).toEqual([])
  })

  it("installs a standalone package and offers it to Agents that read its format", async () => {
    const { home, hub, persistence, pi } = await setup()
    const directory = join(home, "my-pi-package")
    await writeJson(join(directory, "package.json"), { name: "my-pi-package", pi: {} })
    const result = await hub.installStandalone({ source: directory, sourceType: "local" })
    expect(result).toMatchObject({
      marketplaceName: "standalone-plugins",
      pluginName: "my-pi-package",
    })
    expect(pi.calls).toEqual([
      expect.stringMatching(
        /^install:.*\/plugins\/cache\/standalone-plugins\/my-pi-package\/local-[a-f0-9]{12}$/u
      ),
    ])
    expect(await persistence.plugins.get("my-pi-package@standalone-plugins")).toMatchObject({
      detectedFormats: ["pi"],
      installPath: directory,
      installSourceType: "local",
    })
    const listed = await hub.list("codex", {})
    expect(listed.marketplaces.map((entry) => entry.name)).toContain("standalone-plugins")
  })

  it("previews a marketplace removal, then removes it everywhere; built-ins stay", async () => {
    const { codex, home, hub, persistence } = await setup()
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    await hub.install({ marketplaceName: "team", pluginName: "review" })
    expect(await hub.removeMarketplace({ name: "team" })).toEqual({
      affectedPlugins: ["review@team"],
      succeeded: false,
    })
    expect(await hub.removeMarketplace({ confirmUninstall: true, name: "team" })).toEqual({
      succeeded: true,
      uninstalledPlugins: ["review@team"],
    })
    expect(codex.calls).toContain("remove-market:team")
    expect(await persistence.marketplaces.get("team")).toBeUndefined()
    await expect(hub.removeMarketplace({ name: "standalone-plugins" })).rejects.toThrow(/Built-in/u)
  })

  it("leaves a catalog Agent with plugins turned off out of every operation", async () => {
    const { claude, home, hub } = await setup()
    ;(claude.provider as { enabled: boolean }).enabled = false
    const root = await marketplace(home)
    await hub.addMarketplace({ source: root })
    expect(claude.calls).toEqual([])
    const states = await hub.agents({ marketplaceName: "team", pluginName: "review" })
    expect(states.some((state) => state.agentId === "claude")).toBe(false)
  })
})
