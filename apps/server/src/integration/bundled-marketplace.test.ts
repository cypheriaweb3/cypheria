import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { AppToolService } from "../app-tools/service.js"
import { materializeBundledMarketplace } from "./bundled-marketplace.js"
import { isHiddenBundledPlugin, STATIC_BUNDLED_PLUGIN_NAMES } from "./plugin-utils.js"

const root = fileURLToPath(new URL("../../../../plugins/", import.meta.url))
const json = async (path: string) => JSON.parse(await readFile(`${root}${path}`, "utf8"))

/** Each bundled plugin with an MCP server and the server it declares. */
const SERVERS = {
  "code-review": "code-review",
  "cypheria-app-tools": "cypheria_app_tools",
} as const
type McpPluginName = keyof typeof SERVERS
/** Where each plugin keeps the relay its MCP server runs. */
const RELAYS: Record<McpPluginName, string> = {
  "code-review": "src/server/relay.mjs",
  "cypheria-app-tools": "mcp/server.mjs",
}
const MCP_PLUGIN_NAMES = Object.keys(SERVERS) as readonly McpPluginName[]

describe("bundled Cypheria marketplace", () => {
  it("ships each plugin with a manifest for every supported Agent at the same version", async () => {
    for (const name of STATIC_BUNDLED_PLUGIN_NAMES) {
      const codex = await json(`${name}/.codex-plugin/plugin.json`)
      const claude = await json(`${name}/.claude-plugin/plugin.json`)
      expect(codex.name).toBe(name)
      expect(claude.name).toBe(name)
      expect(claude.version).toBe(codex.version)
    }
  })

  it("lists the plugins in every supported Agent's marketplace file, beside the manifests", async () => {
    const claudeMarketplace = await json(".claude-plugin/marketplace.json")
    const codexMarketplace = await json(".agents/plugins/marketplace.json")
    for (const marketplace of [claudeMarketplace, codexMarketplace]) {
      expect(marketplace.name).toBe("cypheria-bundled")
      expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
        ...STATIC_BUNDLED_PLUGIN_NAMES,
      ])
    }
    for (const plugin of claudeMarketplace.plugins) {
      expect(plugin.source).toBe(`./${plugin.name}`)
    }
    for (const plugin of codexMarketplace.plugins) {
      expect(plugin.source.path).toBe(`./${plugin.name}`)
    }
  })

  it("runs the same relay for each MCP plugin's server", async () => {
    const relays = await Promise.all(
      MCP_PLUGIN_NAMES.map((name) => readFile(`${root}${name}/${RELAYS[name]}`, "utf8"))
    )
    expect(new Set(relays).size).toBe(1)
    for (const name of MCP_PLUGIN_NAMES) {
      const server = SERVERS[name]
      const codex = await json(`${name}/.codex-mcp.json`)
      const claude = await json(`${name}/.claude-mcp.json`)
      expect(Object.keys(codex.mcpServers)).toEqual([server])
      expect(Object.keys(claude.mcpServers)).toEqual([server])
      expect(codex.mcpServers[server].args).toEqual([`./${RELAYS[name]}`, "--server", server])
      expect(claude.mcpServers[server].args).toEqual([
        `\${CLAUDE_PLUGIN_ROOT}/${RELAYS[name]}`,
        "--server",
        server,
      ])
      await expect(readFile(`${root}${name}/.mcp.json`)).rejects.toThrow()
    }
  })

  it("ships the Computer Use plugins as manifests and icons only", async () => {
    for (const name of ["browser", "chrome", "computer-use"]) {
      const codex = await json(`${name}/.codex-plugin/plugin.json`)
      expect(codex.mcpServers).toBeUndefined()
      expect(codex.hooks).toBeUndefined()
      expect(codex.skills).toBeUndefined()
      await expect(readFile(`${root}${name}/${codex.interface.logo}`)).resolves.toBeDefined()
    }
  })

  it("generates the hidden cua plugin into the marketplace Agents install from", async () => {
    const target = join(await mkdtemp(join(tmpdir(), "cypheria-marketplace-")), "cypheria-bundled")
    try {
      await materializeBundledMarketplace(root, target)
      const read = async (path: string) => JSON.parse(await readFile(join(target, path), "utf8"))
      const codex = await read("cua/.codex-plugin/plugin.json")
      expect(codex.hooks).toBeUndefined()
      expect((await read("cua/.mcp.json")).mcpServers.cua_repl.enabled).toBe(false)
      expect((await read("cua/.claude-mcp.json")).mcpServers.cua_repl.env).toMatchObject({
        CUA_REPL_ENABLED_SURFACES: `\${CYPHERIA_CUA_SURFACES:-}`,
        NODE_REPL_HOST_SERVICES_PIPE_PATH: `\${CYPHERIA_CUA_HOST_PIPE:-}`,
      })
      for (const file of [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"]) {
        const names = (await read(file)).plugins.map((plugin: { name: string }) => plugin.name)
        expect(names).toEqual([...STATIC_BUNDLED_PLUGIN_NAMES, "cua"])
      }
      await expect(readFile(join(target, "code-review", "node_modules"))).rejects.toThrow()
      expect(isHiddenBundledPlugin("cypheria-bundled", "cua")).toBe(true)
      expect(isHiddenBundledPlugin("other", "cua")).toBe(false)
    } finally {
      await rm(join(target, ".."), { force: true, recursive: true })
    }
  })

  it("gives every Agent process the app tools token instead of the Server token", async () => {
    for (const name of MCP_PLUGIN_NAMES) {
      const server = SERVERS[name]
      const codex = await json(`${name}/.codex-mcp.json`)
      const claude = await json(`${name}/.claude-mcp.json`)
      expect(codex.mcpServers[server].env_vars).toEqual([
        "CYPHERIA_SERVER_URL",
        "CYPHERIA_APP_TOOLS_TOKEN",
      ])
      expect(claude.mcpServers[server].env.CYPHERIA_APP_TOOLS_TOKEN).toBe(
        `\${CYPHERIA_APP_TOOLS_TOKEN:-}`
      )
      expect(JSON.stringify([codex, claude])).not.toContain("CYPHERIA_SERVER_TOKEN")
    }
  })

  it("lists app tools directly and prompts only where the official desktop does", async () => {
    const server = (await json("cypheria-app-tools/.codex-mcp.json")).mcpServers.cypheria_app_tools
    expect(server.omit_tools_from).toEqual(["deferred"])
    expect(server.default_tools_approval_mode).toBe("approve")
    const prompted = Object.keys(server.tools)
    expect(prompted.sort()).toEqual([
      "automation_update",
      "create_thread",
      "fork_thread",
      "handoff_thread",
      "send_message_to_thread",
    ])
    for (const tool of prompted) {
      expect(AppToolService.toolNames.has(tool)).toBe(true)
      expect(server.tools[tool]).toEqual({ approval_mode: "prompt" })
    }
  })
})
