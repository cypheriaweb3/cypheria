import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { AppToolService } from "../app-tools/service.js"
import { BUNDLED_PLUGIN_NAMES } from "./plugin-utils.js"

const root = fileURLToPath(new URL("../../../../plugins/", import.meta.url))
const json = async (path: string) => JSON.parse(await readFile(`${root}${path}`, "utf8"))

/** Each bundled plugin and the one MCP server it declares. */
const SERVERS = {
  browser: "browser",
  "code-review": "code-review",
  "cypheria-app-tools": "cypheria_app_tools",
}
/** Where each plugin keeps the relay its MCP server runs. */
const RELAYS = {
  browser: "mcp/server.mjs",
  "code-review": "src/server/relay.mjs",
  "cypheria-app-tools": "mcp/server.mjs",
}

describe("bundled Cypheria marketplace", () => {
  it("ships each plugin with a manifest for every supported Agent at the same version", async () => {
    for (const name of BUNDLED_PLUGIN_NAMES) {
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
        ...BUNDLED_PLUGIN_NAMES,
      ])
    }
    for (const plugin of claudeMarketplace.plugins) {
      expect(plugin.source).toBe(`./${plugin.name}`)
    }
    for (const plugin of codexMarketplace.plugins) {
      expect(plugin.source.path).toBe(`./${plugin.name}`)
    }
  })

  it("runs the same relay for each plugin's one MCP server", async () => {
    const relays = await Promise.all(
      BUNDLED_PLUGIN_NAMES.map((name) => readFile(`${root}${name}/${RELAYS[name]}`, "utf8"))
    )
    expect(new Set(relays).size).toBe(1)
    for (const name of BUNDLED_PLUGIN_NAMES) {
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

  it("gives every Agent process the app tools token instead of the Server token", async () => {
    for (const name of BUNDLED_PLUGIN_NAMES) {
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
