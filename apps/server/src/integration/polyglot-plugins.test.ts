import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"
import { parse } from "yaml"

import { readMarketplaceCatalog } from "./marketplace-catalog.js"
import { gitRemote, revisionDirectory } from "./marketplace-store.js"
import {
  ClinePackageProvider,
  CopilotPackageProvider,
  DevinPackageProvider,
  GeminiPackageProvider,
  GoosePackageProvider,
  GrokPackageProvider,
  type PackagePlugin,
  PiPackageProvider,
} from "./package-plugin-providers.js"
import { detectPluginFormats, nativeFormatFor, readPluginMcpServerNames } from "./plugin-format.js"

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

const temp = () => mkdtemp(join(tmpdir(), "cypheria-polyglot-"))

describe("format detection", () => {
  it("detects formats from manifests only, never from directory names", async () => {
    const root = await temp()
    await mkdir(join(root, "skills", "a"), { recursive: true })
    await mkdir(join(root, "extensions"), { recursive: true })
    expect(await detectPluginFormats(root)).toEqual([])

    await writeJson(join(root, "plugin.json"), { name: "x" })
    await writeJson(join(root, ".codex-plugin", "plugin.json"), { name: "x" })
    await writeJson(join(root, ".github", "plugin", "plugin.json"), { name: "x" })
    await writeJson(join(root, ".goose-plugin", "plugin.json"), { name: "x" })
    await writeJson(join(root, ".grok-plugin", "plugin.json"), { name: "x" })
    await writeJson(join(root, "package.json"), { name: "x", pi: {} })
    expect(await detectPluginFormats(root)).toEqual([
      "agent_plugin",
      "codex",
      "copilot",
      "goose",
      "grok",
      "pi",
    ])
  })

  it("prefers each Agent's own manifest", () => {
    expect(nativeFormatFor("codex", ["agent_plugin", "codex"])).toBe("codex")
    expect(nativeFormatFor("goose", ["agent_plugin", "gemini"])).toBe("agent_plugin")
    expect(nativeFormatFor("cursor", ["cursor", "claude"])).toBeUndefined()
    expect(nativeFormatFor("grok-build", ["agent_plugin", "claude"])).toBe("claude")
    expect(nativeFormatFor("pi", ["agent_plugin"])).toBeUndefined()
  })

  it("reads MCP server names from mcp.json before .mcp.json", async () => {
    const root = await temp()
    await writeJson(join(root, ".mcp.json"), { mcpServers: { old: { command: "old" } } })
    await writeJson(join(root, "mcp.json"), {
      mcpServers: {
        remote: { type: "sse", url: "https://example.com/sse" },
        tool: { command: "./bin/tool" },
      },
    })
    expect(await readPluginMcpServerNames(root)).toEqual(["remote", "tool"])
  })
})

describe("marketplace catalogs", () => {
  it("merges Codex and Claude entries and drops sources that escape the directory", async () => {
    const root = await temp()
    await writeJson(join(root, ".agents", "plugins", "marketplace.json"), {
      name: "team",
      plugins: [{ name: "review", source: { path: "./review", source: "local" } }],
    })
    await writeJson(join(root, ".claude-plugin", "marketplace.json"), {
      name: "team",
      plugins: [
        { description: "Reviews", name: "review", source: "./review" },
        { name: "remote", source: { ref: "v1", repo: "acme/remote", source: "github" } },
        { name: "escape", source: "../../etc" },
        { name: "npm-tool", source: { package: "@acme/tool", source: "npm" } },
      ],
    })
    const catalog = await readMarketplaceCatalog(root)
    expect(catalog).toMatchObject({ files: ["claude", "codex"], name: "team" })
    expect(catalog.plugins.map((plugin) => [plugin.name, plugin.source])).toEqual([
      ["escape", null],
      ["npm-tool", { kind: "npm", package: "@acme/tool", version: null }],
      ["remote", { kind: "git", path: null, ref: "v1", url: "https://github.com/acme/remote.git" }],
      ["review", { kind: "local", path: "review" }],
    ])
  })

  it("reads a Grok marketplace file, whose sources name their kind as type", async () => {
    const root = await temp()
    await writeJson(join(root, ".grok-plugin", "marketplace.json"), {
      name: "xai-official",
      plugins: [
        { name: "gdrive", source: { path: "./plugins/gdrive", type: "local" } },
        {
          name: "vercel",
          source: {
            sha: "f42fa61",
            source: "url",
            url: "https://github.com/vercel/vercel-plugin.git",
          },
        },
      ],
    })
    const catalog = await readMarketplaceCatalog(root)
    expect(catalog).toMatchObject({ files: ["grok"], name: "xai-official" })
    expect(catalog.plugins.map((plugin) => [plugin.name, plugin.source])).toEqual([
      ["gdrive", { kind: "local", path: "plugins/gdrive" }],
      [
        "vercel",
        {
          kind: "git",
          path: null,
          ref: "f42fa61",
          url: "https://github.com/vercel/vercel-plugin.git",
        },
      ],
    ])
  })

  it("names a revision after its version and the start of its SHA-256", () => {
    const sha256 = "2a8ad9f74633".padEnd(64, "0")
    expect(revisionDirectory({ sha256, version: "1.2.0" })).toBe("1.2.0-2a8ad9f74633")
    expect(revisionDirectory({ sha256, version: null })).toBe("local-2a8ad9f74633")
    expect(revisionDirectory({ sha256, version: "../1" })).toBe("local-2a8ad9f74633")
  })

  it("expands GitHub shorthand and embedded refs", () => {
    expect(gitRemote("acme/team#v2")).toEqual({
      ref: "v2",
      url: "https://github.com/acme/team.git",
    })
    expect(gitRemote("https://git.example/team.git", "main")).toEqual({
      ref: "main",
      url: "https://git.example/team.git",
    })
  })
})

const packagePlugin = (installPath: string, extra: Partial<PackagePlugin> = {}): PackagePlugin => ({
  id: "tools@team",
  installPath,
  installSourceType: "local",
  installSourceUrl: "./tools",
  marketplaceId: "team",
  marketplacePath: null,
  name: "tools",
  origin: null,
  ...extra,
})

describe("Goose plugins", () => {
  it("links, lists, switches, and removes plugins on Goose's own layout", async () => {
    const home = await temp()
    const source = join(home, "source")
    await writeJson(join(source, ".goose-plugin", "plugin.json"), { name: "tools" })
    const installed = join(home, ".agents", "plugins", "installed")
    await writeJson(join(installed, ".goose-plugin-install.json"), {
      format: "open-plugins",
      source: "https://example.com/installed.git",
      source_type: "git",
    })
    await mkdir(join(home, "config"), { recursive: true })
    await writeFile(join(home, "config", "config.yaml"), "# keep me\nGOOSE_PROVIDER: openai\n")
    const goose = new GoosePackageProvider({ home, run: vi.fn() })

    const result = await goose.install(packagePlugin(source))
    const link = join(home, ".agents", "plugins", "tools")
    expect(result).toEqual({ installed: true, receipt: { command: "link", nativeId: link } })
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    await goose.setEnabled(packagePlugin(source), { nativeId: link }, false)

    const config = await readFile(join(home, "config", "config.yaml"), "utf8")
    expect(config).toContain("# keep me")
    expect(parse(config)).toMatchObject({
      GOOSE_PROVIDER: "openai",
      plugins: { [link]: { enabled: false } },
    })
    expect(await goose.list()).toEqual([
      expect.objectContaining({
        enabled: true,
        goose: true,
        name: "installed",
        source: "https://example.com/installed.git",
      }),
      expect.objectContaining({ enabled: false, goose: false, linkedTo: source, name: "tools" }),
    ])

    await goose.uninstall(packagePlugin(source), { nativeId: link })
    await expect(lstat(link)).rejects.toThrow()
    expect(parse(await readFile(join(home, "config", "config.yaml"), "utf8")).plugins).toEqual({})
    expect((await lstat(source)).isDirectory()).toBe(true)
  })
})

describe("Pi packages", () => {
  it("installs a local package in place and asks before npm runs package code", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "" }))
    const pi = new PiPackageProvider(run)
    await pi.install(packagePlugin("/plugins/tools"))
    expect(run).toHaveBeenLastCalledWith(["install", "/plugins/tools"], expect.anything())

    const catalog = packagePlugin("/sources/tools", {
      installSourceType: "npm",
      installSourceUrl: "@acme/pi-tools",
      marketplaceId: "pi-package-catalog",
    })
    const pending = await pi.install(catalog)
    const command = "pi install npm:@acme/pi-tools"
    const sha256 = createHash("sha256").update(command).digest("hex")
    expect(pending).toEqual({
      confirmation: { command, pluginId: "tools@team", sha256 },
      installed: false,
    })
    expect(run).toHaveBeenCalledTimes(1)
    await pi.install(catalog, { acceptCommandSha256: sha256 })
    expect(run).toHaveBeenLastCalledWith(["install", "npm:@acme/pi-tools"], expect.anything())
  })
})

describe("Agent catalogs", () => {
  it("reads a Devin marketplace manifest and a plain directory of plugins", async () => {
    const devin = await temp()
    await writeJson(join(devin, ".devin-plugin", "plugin.json"), {
      name: "devin-marketplace",
      optionalPlugins: ["./plugins/atlan", "../outside"],
    })
    await writeJson(join(devin, "plugins", "atlan", ".devin-plugin", "plugin.json"), {
      description: "Atlan MCP",
      displayName: "Atlan",
      mcpServers: { atlan: { url: "https://mcp.atlan.com/mcp" } },
      name: "atlan",
    })
    const catalog = await readMarketplaceCatalog(devin)
    expect(catalog).toMatchObject({ files: ["devin"], name: "devin-marketplace" })
    expect(catalog.plugins).toEqual([
      expect.objectContaining({
        displayName: "Atlan",
        name: "atlan",
        source: { kind: "local", path: "plugins/atlan" },
      }),
    ])
    expect(await readPluginMcpServerNames(join(devin, "plugins", "atlan"))).toEqual(["atlan"])

    const cline = await temp()
    await writeJson(join(cline, "plugins", "linear", "package.json"), {
      cline: { plugins: ["./index.ts"] },
      description: "Linear skill",
    })
    await mkdir(join(cline, "plugins", "web-search"), { recursive: true })
    const directory = await readMarketplaceCatalog(cline, { pluginDirectory: "plugins" })
    expect(directory.plugins.map((plugin) => [plugin.name, plugin.description])).toEqual([
      ["linear", "Linear skill"],
      ["web-search", null],
    ])
    expect(await detectPluginFormats(join(cline, "plugins", "linear"))).toEqual(["cline"])
  })

  it("installs Cline plugins after confirmation and Devin plugins by their marketplace URL", async () => {
    const run = vi.fn(async (args: string[]) => ({
      exitCode: 0,
      stderr: "",
      stdout:
        args[1] === "install" && args[0] === "plugin"
          ? JSON.stringify({ installPath: "/cline/plugins/_installed/official/linear-1" })
          : "",
    }))
    const cline = new ClinePackageProvider(run)
    const official = packagePlugin("/m/plugins/linear", {
      marketplaceId: "cline-official",
      name: "linear",
    })
    const pending = await cline.install(official)
    expect(pending.installed).toBe(false)
    if (pending.installed) return
    expect(pending.confirmation.command).toBe("cline plugin install linear")
    const done = await cline.install(official, { acceptCommandSha256: pending.confirmation.sha256 })
    expect(run).toHaveBeenLastCalledWith(
      ["plugin", "install", "linear", "--force", "--json"],
      expect.anything()
    )
    expect(done).toMatchObject({
      installed: true,
      receipt: { nativeId: "/cline/plugins/_installed/official/linear-1" },
    })

    const devin = new DevinPackageProvider(run)
    await devin.install(
      packagePlugin("/m/plugins/atlan", {
        name: "atlan",
        origin: {
          path: "plugins/atlan",
          url: "https://github.com/CognitionAI/devin-marketplace.git",
        },
      })
    )
    expect(run).toHaveBeenLastCalledWith(
      [
        "plugins",
        "install",
        "https://github.com/CognitionAI/devin-marketplace#plugins/atlan",
        "--yes",
        "--local",
      ],
      expect.anything()
    )
  })
})

describe("Grok Build plugins", () => {
  it("installs a plugin by path and switches and removes it by the name Grok lists", async () => {
    const run = vi.fn(async (args: string[]) => ({
      exitCode: 0,
      stderr: "",
      stdout:
        args[1] === "list"
          ? JSON.stringify([
              { name: "other", path: "/grok/other", source: "/elsewhere" },
              { name: "review-tools", path: "/grok/review", source: "/plugins/tools" },
            ])
          : "",
    }))
    const grok = new GrokPackageProvider(run)
    const plugin = packagePlugin("/plugins/tools")
    const result = await grok.install(plugin)
    expect(run).toHaveBeenNthCalledWith(
      1,
      ["plugin", "install", "/plugins/tools", "--trust"],
      expect.anything()
    )
    expect(result).toEqual({
      installed: true,
      receipt: { command: "grok plugin install /plugins/tools --trust", nativeId: "review-tools" },
    })
    if (!result.installed) return
    await grok.setEnabled(plugin, result.receipt, false)
    expect(run).toHaveBeenLastCalledWith(["plugin", "disable", "review-tools"], expect.anything())
    await grok.uninstall(plugin, result.receipt)
    expect(run).toHaveBeenLastCalledWith(
      ["plugin", "uninstall", "review-tools", "--confirm"],
      expect.anything()
    )
  })

  it("reinstalls a changed plugin, keeping its data and whether it is enabled", async () => {
    const run = vi.fn(async (args: string[]) => ({
      exitCode: 0,
      stderr: "",
      stdout:
        args[1] === "list"
          ? JSON.stringify([
              { name: "review-tools", path: "/grok/review", source: "/plugins/tools" },
            ])
          : "",
    }))
    const grok = new GrokPackageProvider(run)
    const receipt = await grok.update(
      packagePlugin("/plugins/tools"),
      { nativeId: "review-tools" },
      false
    )
    expect(run.mock.calls.map(([args]) => args.slice(0, 3).join(" "))).toEqual([
      "plugin uninstall review-tools",
      "plugin install /plugins/tools",
      "plugin list --json",
      "plugin disable review-tools",
    ])
    expect(run.mock.calls[0]?.[0]).toContain("--keep-data")
    expect(receipt).toMatchObject({ nativeId: "review-tools" })
  })
})

describe("Devin updates", () => {
  it("reinstalls an enabled plugin and leaves a disabled one to its next enable", async () => {
    const run = vi.fn(async (_args: string[]) => ({ exitCode: 0, stderr: "", stdout: "" }))
    const devin = new DevinPackageProvider(run)
    const plugin = packagePlugin("/m/plugins/atlan", { name: "atlan" })
    await devin.update(plugin, { nativeId: "atlan" }, false)
    expect(run).not.toHaveBeenCalled()
    await devin.update(plugin, { nativeId: "atlan" }, true)
    expect(run.mock.calls.map(([args]) => args.slice(0, 2).join(" "))).toEqual([
      "plugins remove",
      "plugins install",
    ])
  })
})

describe("Copilot CLI plugins", () => {
  it("installs from the marketplaces it ships by name, without registering them", async () => {
    const run = vi.fn(async (_args: string[]) => ({ exitCode: 0, stderr: "", stdout: "" }))
    const copilot = new CopilotPackageProvider(run)
    const builtin = packagePlugin("/m/plugins/roundup", {
      marketplaceId: "awesome-copilot",
      name: "roundup",
    })
    expect(copilot.supports(builtin)).toBe(true)
    expect(copilot.supports(packagePlugin("/tools"))).toBe(false)
    const result = await copilot.install(builtin)
    expect(run.mock.calls.map(([args]) => args.join(" "))).toEqual([
      "plugin install roundup@awesome-copilot",
    ])
    if (!result.installed) return
    await copilot.update(builtin, result.receipt)
    expect(run).toHaveBeenLastCalledWith(
      ["plugin", "update", "roundup@awesome-copilot"],
      expect.anything()
    )

    const local = packagePlugin("/team/tools", { marketplacePath: "/team" })
    await copilot.install(local)
    expect(run.mock.calls.slice(-2).map(([args]) => args.join(" "))).toEqual([
      "plugin marketplace add /team",
      "plugin install tools@team",
    ])
    await copilot.update(local, { nativeId: "tools@team" })
    expect(run).toHaveBeenLastCalledWith(["plugin", "update", "tools@team"], expect.anything())
  })

  it("reads a Copilot marketplace file", async () => {
    const root = await temp()
    await writeJson(join(root, ".github", "plugin", "marketplace.json"), {
      name: "awesome-copilot",
      plugins: [
        { name: "roundup", source: "plugins/roundup" },
        { name: "council", source: { ref: "v0.1.3", repo: "acme/council", source: "github" } },
      ],
    })
    const catalog = await readMarketplaceCatalog(root)
    expect(catalog).toMatchObject({ files: ["copilot"], name: "awesome-copilot" })
    expect(catalog.plugins.map((plugin) => [plugin.name, plugin.source])).toEqual([
      [
        "council",
        { kind: "git", path: null, ref: "v0.1.3", url: "https://github.com/acme/council.git" },
      ],
      ["roundup", { kind: "local", path: "plugins/roundup" }],
    ])
  })
})

describe("updates of Agents that load a plugin from its directory", () => {
  it("points Goose's link at the new revision and keeps its enablement", async () => {
    const home = await temp()
    const first = join(home, "rev-1")
    const second = join(home, "rev-2")
    await writeJson(join(first, ".goose-plugin", "plugin.json"), { name: "tools" })
    await writeJson(join(second, ".goose-plugin", "plugin.json"), { name: "tools" })
    const goose = new GoosePackageProvider({ home, run: vi.fn() })
    const result = await goose.install(packagePlugin(first))
    if (!result.installed) return
    await goose.setEnabled(packagePlugin(first), result.receipt, false)
    await goose.update(packagePlugin(second), result.receipt)
    const link = join(home, ".agents", "plugins", "tools")
    expect(await readlink(link)).toBe(second)
    expect(parse(await readFile(join(home, "config", "config.yaml"), "utf8"))).toMatchObject({
      plugins: { [link]: { enabled: false } },
    })
  })

  it("installs Pi's new revision in place of the old one, and nothing while disabled", async () => {
    const run = vi.fn(async (_args: string[]) => ({ exitCode: 0, stderr: "", stdout: "" }))
    const pi = new PiPackageProvider(run)
    await pi.update(packagePlugin("/rev-2"), { nativeId: "/rev-1" }, false)
    expect(run).not.toHaveBeenCalled()
    const receipt = await pi.update(packagePlugin("/rev-2"), { nativeId: "/rev-1" }, true)
    expect(run.mock.calls.map(([args]) => args.join(" "))).toEqual([
      "remove /rev-1",
      "install /rev-2",
    ])
    expect(receipt).toMatchObject({ nativeId: "/rev-2" })
  })

  it("links Gemini's new revision and keeps a disabled extension disabled", async () => {
    const run = vi.fn(async (_args: string[]) => ({ exitCode: 0, stderr: "", stdout: "" }))
    const gemini = new GeminiPackageProvider(run)
    await gemini.update(packagePlugin("/rev-2"), { nativeId: "tools" }, false)
    expect(run.mock.calls.map(([args]) => args.slice(0, 3).join(" "))).toEqual([
      "extensions uninstall tools",
      "extensions link /rev-2",
      "extensions disable tools",
    ])
  })
})
