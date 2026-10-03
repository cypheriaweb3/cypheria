import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parseTokenCost } from "./claude-cli.js"
import { ClaudePluginProvider } from "./claude-plugin-provider.js"

type Call = string[]
type Reply = { exitCode?: number; stderr?: string; stdout?: string }

const reply = (value: unknown): Reply => ({ stdout: `${JSON.stringify(value)}\n` })
const SHA = "d".repeat(64)

describe("ClaudePluginProvider", () => {
  let root: string
  let calls: Call[]
  let stdin: string[]
  let marketplaces: { installLocation: string; name: string; repo?: string; source: string }[]
  let installed: Record<string, unknown>[]
  let available: Record<string, unknown>[]
  let handlers: ((args: string[]) => Reply | undefined)[]

  let pluginsOn = true
  const provider = () =>
    new ClaudePluginProvider({
      enabled: () => pluginsOn,
      reload: async () => ({ applied: 0, held: 0 }),
      runner: {
        run: async (args, options) => {
          calls.push(args)
          if (options?.input !== undefined) stdin.push(options.input)
          for (const handler of handlers) {
            const result = handler(args)
            if (result) return { exitCode: 0, stderr: "", stdout: "", ...result }
          }
          const joined = args.join(" ")
          if (joined === "plugin marketplace list --json")
            return { exitCode: 0, stderr: "", stdout: JSON.stringify(marketplaces) }
          if (joined === "plugin list --json --available") {
            return { exitCode: 0, stderr: "", stdout: JSON.stringify({ available, installed }) }
          }
          if (joined === "plugin list --json")
            return { exitCode: 0, stderr: "", stdout: JSON.stringify(installed) }
          return { exitCode: 1, stderr: `unexpected: ${joined}`, stdout: "" }
        },
      },
    })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cypheria-claude-plugins-"))
    calls = []
    pluginsOn = true
    stdin = []
    installed = []
    available = []
    handlers = []
    await mkdir(join(root, "team", ".claude-plugin"), { recursive: true })
    await writeFile(
      join(root, "team", ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "team",
        plugins: [
          {
            name: "both",
            source: "./both",
            category: "dev",
          },
          { name: "plain", source: "./plain" },
        ],
      })
    )
    marketplaces = [
      {
        installLocation: join(root, "official"),
        name: "claude-plugins-official",
        repo: "anthropics/claude-plugins-official",
        source: "github",
      },
      { installLocation: join(root, "team"), name: "team", repo: "acme/team", source: "github" },
    ]
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it("groups the catalog by marketplace and enriches entries from the marketplace file", async () => {
    available = [
      { marketplaceName: "team", name: "both", pluginId: "both@team", source: "./both" },
      { marketplaceName: "team", name: "plain", pluginId: "plain@team", source: "./plain" },
    ]
    installed = [
      {
        enabled: true,
        id: "plain@team",
        installPath: join(root, "cache"),
        scope: "user",
        version: "1.0.0",
      },
    ]
    const value = await provider().list({})
    const team = value.marketplaces.find((entry) => entry.name === "team")
    expect(
      value.marketplaces.find((entry) => entry.name === "claude-plugins-official")?.sourceKind
    ).toBe("claude")
    expect(team?.sourceKind).toBe("custom")
    const byName = Object.fromEntries((team?.plugins ?? []).map((plugin) => [plugin.name, plugin]))
    expect(byName.both).toMatchObject({
      category: "dev",
      compatibility: ["claude"],
      installed: false,
    })
    expect(byName.plain).toMatchObject({
      compatibility: ["claude"],
      enabled: true,
      installed: true,
      installedScopes: ["user"],
    })
    expect(value.capabilities.scopes).toEqual(["user", "project", "local"])
  })

  it("does nothing while plugins are turned off for Claude", async () => {
    pluginsOn = false
    const target = provider()
    const value = await target.list({})
    expect(value.marketplaces).toEqual([])
    expect(value.errors[0]?.message).toContain("turned off")
    expect(value.capabilities.install).toBe(false)
    expect(target.enabled).toBe(false)
    await expect(
      target.install({ marketplaceName: "team", marketplacePath: null, pluginName: "plain" })
    ).rejects.toMatchObject({ name: "INTEGRATION_DISABLED" })
    await expect(target.addMarketplace({ source: "acme/team" })).rejects.toMatchObject({
      name: "INTEGRATION_DISABLED",
    })
    expect(calls).toEqual([])
    pluginsOn = true
    expect(target.enabled).toBe(true)
  })

  it("registers the official marketplace when it is missing", async () => {
    marketplaces = []
    await provider().list({})
    expect(calls).toContainEqual([
      "plugin",
      "marketplace",
      "add",
      "anthropics/claude-plugins-official",
      "--scope",
      "user",
    ])
  })

  it("offers the bundled marketplace to Claude without installing from it", async () => {
    marketplaces = []
    handlers.push((args) =>
      args.slice(0, 3).join(" ") === "plugin marketplace add" ? { stdout: "added" } : undefined
    )
    await provider().list({})
    const added = calls.filter((call) => call.slice(0, 3).join(" ") === "plugin marketplace add")
    expect(added.map((call) => call[3])).toEqual([
      "anthropics/claude-plugins-official",
      expect.stringMatching(/[\\/]plugins$/u),
    ])
    expect(calls.some((call) => call[1] === "install")).toBe(false)
  })

  it("returns the marketplace-declared command for confirmation and never passes --yes", async () => {
    handlers.push((args) =>
      args[1] === "install" && !args.includes("--accept-command")
        ? reply({
            command: "install",
            failureCode: "command_source_refused",
            message: "not run",
            outcome: "failed",
            shownCommand: { command: "my-tool path", pluginId: "tool@team", sha256: SHA },
          })
        : args[1] === "install"
          ? reply({ command: "install", message: "ok", outcome: "ok", pluginId: "tool@team" })
          : undefined
    )
    const first = await provider().install({
      marketplaceName: "team",
      marketplacePath: null,
      pluginName: "tool",
    })
    expect(first).toEqual({
      confirmation: { command: "my-tool path", pluginId: "tool@team", sha256: SHA },
      installed: false,
    })
    const second = await provider().install({
      acceptCommandSha256: SHA,
      marketplaceName: "team",
      marketplacePath: null,
      pluginName: "tool",
      scope: "project",
    })
    expect(second).toMatchObject({ installed: true })
    const accepted = calls.find((call) => call.includes("--accept-command"))
    expect(accepted).toEqual([
      "plugin",
      "install",
      "tool@team",
      "--scope",
      "project",
      "--accept-command",
      SHA,
      "--json",
    ])
    expect(calls.flat()).not.toContain("--yes")
    expect(calls.flat()).not.toContain("-y")
  })

  it("asks for confirmation before removing a marketplace that has installed plugins", async () => {
    installed = [
      {
        enabled: true,
        id: "plain@team",
        installPath: join(root, "c"),
        scope: "user",
        version: "1",
      },
    ]
    const removal = vi.fn()
    handlers.push((args) => {
      if (args.slice(0, 3).join(" ") === "plugin marketplace remove") {
        removal(args)
        return { stdout: "removed" }
      }
      return undefined
    })
    const target = provider()
    expect(await target.removeMarketplace({ name: "team" })).toEqual({
      affectedPlugins: ["plain@team"],
      succeeded: false,
    })
    expect(removal).not.toHaveBeenCalled()
    expect(await target.removeMarketplace({ confirmUninstall: true, name: "team" })).toEqual({
      succeeded: true,
      uninstalledPlugins: ["plain@team"],
    })
    expect(removal).toHaveBeenCalledOnce()
    await expect(
      target.removeMarketplace({ confirmUninstall: true, name: "claude-plugins-official" })
    ).rejects.toThrow("Official marketplaces cannot be removed")
  })

  it("treats enabling an already enabled plugin as success", async () => {
    handlers.push((args) =>
      args[1] === "enable"
        ? reply({
            alreadyInGoalState: true,
            command: "enable",
            failureCode: "already_in_goal_state",
            message: "already",
            outcome: "failed",
          })
        : undefined
    )
    await expect(
      provider().setEnabled({ enabled: true, id: "plain@team" })
    ).resolves.toBeUndefined()
  })

  it("rejects marketplace sources and identifiers that could be read as options", async () => {
    const target = provider()
    await expect(target.addMarketplace({ source: "--claudeai" })).rejects.toMatchObject({
      name: "INTEGRATION_INVALID",
    })
    await expect(target.uninstall({ id: "--all@x" })).rejects.toMatchObject({
      name: "INTEGRATION_INVALID",
    })
    await expect(
      target.install({ marketplaceName: "team", marketplacePath: null, pluginName: "-x" })
    ).rejects.toMatchObject({ name: "INTEGRATION_INVALID" })
  })

  it("keeps sensitive option values out of the configuration view and passes writes on stdin", async () => {
    const config = {
      configured: ["endpoint"],
      inputs: { endpoint: "https://a", token: "" },
      pluginId: "cfg@team",
      schema: {
        endpoint: { description: "d", title: "Endpoint", type: "string" },
        token: { description: "d", sensitive: true, title: "Token", type: "string" },
      },
      unconfigured: ["token"],
    }
    handlers.push((args) =>
      args[1] === "configure" && !args.includes("--values-stdin")
        ? reply(config)
        : args.includes("--values-stdin")
          ? reply({ pluginId: "cfg@team", saved: ["token"], unconfigured: [] })
          : undefined
    )
    const target = provider()
    const view = await target.readConfig("cfg@team")
    expect(view.options.find((option) => option.key === "token")).toMatchObject({
      sensitive: true,
      value: null,
    })
    expect(view.options.find((option) => option.key === "endpoint")).toMatchObject({
      value: "https://a",
    })
    await expect(target.writeConfig("cfg@team", { nope: "x" })).rejects.toMatchObject({
      name: "INTEGRATION_INVALID",
    })
    await expect(target.writeConfig("cfg@team", { token: "a\nb" })).rejects.toMatchObject({
      name: "INTEGRATION_INVALID",
    })
    await expect(target.writeConfig("cfg@team", { token: "s3cret" })).resolves.toEqual({
      saved: ["token"],
      unconfigured: [],
    })
    const write = calls.find((call) => call.includes("--values-stdin"))
    expect(write?.join(" ")).not.toContain("s3cret")
    expect(stdin).toEqual(['{"token":"s3cret"}'])
  })
})

describe("parseTokenCost", () => {
  it("reads always-on and per-component estimates", () => {
    const text = `demo 0.1.0\n\nProjected token cost\n  Always-on:   ~4 tok   added to every session\n\nPer-component (rounded)\n  component  always-on  on-invoke\n  hello           < 20       < 20\n\n  note\n`
    expect(parseTokenCost(text)).toEqual({
      alwaysOn: 4,
      components: [{ alwaysOn: 20, name: "hello", onInvoke: 20 }],
    })
    expect(parseTokenCost("unexpected")).toBeUndefined()
  })
})
