import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../../../plugins/marketplace/", import.meta.url))
const json = async (path: string) => JSON.parse(await readFile(`${root}${path}`, "utf8"))

describe("bundled Cypheria marketplace", () => {
  it("ships one plugin with a manifest for every supported Agent at the same version", async () => {
    const codex = await json("plugins/cypheria-app-tools/.codex-plugin/plugin.json")
    const claude = await json("plugins/cypheria-app-tools/.claude-plugin/plugin.json")
    expect(claude.name).toBe(codex.name)
    expect(claude.version).toBe(codex.version)
  })

  it("lists the plugin in every supported Agent's marketplace file", async () => {
    const claudeMarketplace = await json(".claude-plugin/marketplace.json")
    const codexMarketplace = await json(".agents/plugins/marketplace.json")
    expect(claudeMarketplace.name).toBe("cypheria-bundled")
    expect(codexMarketplace.name).toBe("cypheria-bundled")
    expect(claudeMarketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      "cypheria-app-tools",
    ])
    expect(codexMarketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      "cypheria-app-tools",
    ])
  })

  it("keeps each Agent's MCP declaration in its own file", async () => {
    const codex = await json("plugins/cypheria-app-tools/.codex-mcp.json")
    const claude = await json("plugins/cypheria-app-tools/.claude-mcp.json")
    expect(Object.keys(codex.mcpServers)).toEqual([
      "cypheria_app_tools",
      "cypheria_app",
      "cypheria_app_direct",
    ])
    expect(claude.mcpServers.cypheria_app_tools.args).toEqual([
      `\${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`,
    ])
    await expect(readFile(`${root}plugins/cypheria-app-tools/.mcp.json`)).rejects.toThrow()
  })

  it("gives every Agent process the app tools token instead of the Server token", async () => {
    const codex = await json("plugins/cypheria-app-tools/.codex-mcp.json")
    const claude = await json("plugins/cypheria-app-tools/.claude-mcp.json")
    for (const server of Object.values(codex.mcpServers) as { env_vars: string[] }[]) {
      expect(server.env_vars).toEqual(["CYPHERIA_SERVER_URL", "CYPHERIA_APP_TOOLS_TOKEN"])
    }
    expect(codex.mcpServers.cypheria_app_direct.omit_tools_from).toEqual(["deferred"])
    expect(claude.mcpServers.cypheria_app_tools.env.CYPHERIA_APP_TOOLS_TOKEN).toBe(
      `\${CYPHERIA_APP_TOOLS_TOKEN:-}`
    )
    expect(JSON.stringify([codex, claude])).not.toContain("CYPHERIA_SERVER_TOKEN")
  })
})
