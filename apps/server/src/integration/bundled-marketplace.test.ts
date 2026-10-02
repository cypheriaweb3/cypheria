import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { AppToolService } from "../app-tools/service.js"
import { BUNDLED_PLUGIN_NAMES } from "./plugin-utils.js"

const root = fileURLToPath(new URL("../../../../plugins/marketplace/", import.meta.url))
const json = async (path: string) => JSON.parse(await readFile(`${root}${path}`, "utf8"))

/** Each bundled plugin and the one MCP server it declares. */
const SERVERS = { "code-review": "code-review", "cypheria-app-tools": "cypheria_app_tools" }

describe("bundled Cypheria marketplace", () => {
  it("ships each plugin with a manifest for every supported Agent at the same version", async () => {
    for (const name of BUNDLED_PLUGIN_NAMES) {
      const codex = await json(`plugins/${name}/.codex-plugin/plugin.json`)
      const claude = await json(`plugins/${name}/.claude-plugin/plugin.json`)
      expect(codex.name).toBe(name)
      expect(claude.name).toBe(name)
      expect(claude.version).toBe(codex.version)
    }
  })

  it("lists the plugins in every supported Agent's marketplace file", async () => {
    const claudeMarketplace = await json(".claude-plugin/marketplace.json")
    const codexMarketplace = await json(".agents/plugins/marketplace.json")
    for (const marketplace of [claudeMarketplace, codexMarketplace]) {
      expect(marketplace.name).toBe("cypheria-bundled")
      expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
        ...BUNDLED_PLUGIN_NAMES,
      ])
    }
  })

  it("runs the same relay for each plugin's one MCP server", async () => {
    const relays = await Promise.all(
      BUNDLED_PLUGIN_NAMES.map((name) => readFile(`${root}plugins/${name}/mcp/server.mjs`, "utf8"))
    )
    expect(new Set(relays).size).toBe(1)
    for (const name of BUNDLED_PLUGIN_NAMES) {
      const server = SERVERS[name]
      const codex = await json(`plugins/${name}/.codex-mcp.json`)
      const claude = await json(`plugins/${name}/.claude-mcp.json`)
      expect(Object.keys(codex.mcpServers)).toEqual([server])
      expect(Object.keys(claude.mcpServers)).toEqual([server])
      expect(codex.mcpServers[server].args).toEqual(["./mcp/server.mjs", "--server", server])
      expect(claude.mcpServers[server].args).toEqual([
        `\${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`,
        "--server",
        server,
      ])
      await expect(readFile(`${root}plugins/${name}/.mcp.json`)).rejects.toThrow()
    }
  })

  it("gives every Agent process the app tools token instead of the Server token", async () => {
    for (const name of BUNDLED_PLUGIN_NAMES) {
      const server = SERVERS[name]
      const codex = await json(`plugins/${name}/.codex-mcp.json`)
      const claude = await json(`plugins/${name}/.claude-mcp.json`)
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
    const server = (await json("plugins/cypheria-app-tools/.codex-mcp.json")).mcpServers
      .cypheria_app_tools
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
