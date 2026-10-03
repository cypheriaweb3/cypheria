import { describe, expect, it } from "vitest"

import { acceptIcon, buildCatalog } from "./catalog.js"
import type { McpHost, McpServerInventory } from "./mcp-host.js"

const host = (agentId: "codex" | "claude" | null, extra: Partial<McpHost> = {}): McpHost => ({
  agentId,
  callTool: async () => ({ content: [] }),
  listServers: async () => [],
  readResource: async () => [],
  support: { fullMetadata: true, serverResources: true, toolCalls: true },
  ...extra,
})

const server = (overrides: Partial<McpServerInventory> = {}): McpServerInventory => ({
  capabilities: null,
  error: null,
  name: "bits-and-bolts",
  pluginId: "bits-and-bolts@openai-curated",
  serverInfo: { icons: null, name: "bits-and-bolts", title: "Bits & Bolts" },
  tools: [],
  ...overrides,
})

const appTool = (name: string, entrypoints: unknown, resourceUri = "ui://bits/library") => ({
  _meta: { "openai/ui": { entrypoints }, ui: { resourceUri } },
  name,
  title: `${name} title`,
})

describe("buildCatalog", () => {
  it("collects entry points of every type with their titles, extensions, and quick actions", () => {
    const codex = host("codex")
    const built = buildCatalog([
      {
        host: codex,
        servers: [
          server({
            tools: [
              appTool("cad.library", [
                {
                  quickAction: {
                    icons: [{ src: "https://example.com/plus.svg" }],
                    target: { arguments: {}, name: "cad.create", type: "tool" },
                    title: "New part",
                  },
                  type: "global",
                },
                { type: "thread" },
                { searchTerms: ["cad"], type: "settings" },
              ]),
              appTool("cad.open", [{ extensions: [".STL", "..step"], type: "file" }]),
            ],
          }),
        ],
      },
    ])
    expect(built.entrypoints.map((entry) => [entry.type, entry.tool])).toEqual([
      ["global", "cad.library"],
      ["thread", "cad.library"],
      ["settings", "cad.library"],
      ["file", "cad.open"],
    ])
    expect(built.entrypoints[0]).toMatchObject({
      agentId: "codex",
      pluginId: "bits-and-bolts@openai-curated",
      quickAction: { arguments: {}, title: "New part", tool: "cad.create" },
      resourceUri: "ui://bits/library",
      title: "cad.library title",
    })
    expect(built.entrypoints[2]?.searchTerms).toEqual(["cad"])
    expect(built.entrypoints[3]?.extensions).toEqual(["stl", "step"])
    expect(built.routes.get(built.entrypoints[0]?.id ?? "")?.host).toBe(codex)
    expect(built.diagnostics).toEqual([])
  })

  it("drops invalid tools one by one and reports why", () => {
    const built = buildCatalog([
      {
        host: host("codex"),
        servers: [
          server({
            tools: [
              appTool("bad.meta", "not an object"),
              appTool("bad.resource", [{ type: "global" }], "https://example.com"),
              appTool("good", [{ type: "global" }]),
            ],
          }),
        ],
      },
    ])
    expect(built.entrypoints.map((entry) => entry.tool)).toEqual(["good"])
    expect(built.diagnostics.map((entry) => [entry.tool, entry.reason])).toEqual([
      ["bad.meta", "invalid_ui_metadata"],
      ["bad.resource", "missing_or_invalid_ui_resource"],
    ])
  })

  it("offers structured settings only when both tools are listed and distinct", () => {
    const tools = [{ name: "settings.read" }, { name: "settings.update" }]
    const built = buildCatalog([
      {
        host: host("codex"),
        servers: [
          server({
            capabilities: {
              extensions: {
                "openai/settings": { readTool: "settings.read", updateTool: "settings.update" },
              },
            },
            tools,
          }),
          server({
            capabilities: {
              experimental: {
                "openai/settings": { readTool: "settings.read", updateTool: "settings.read" },
              },
            },
            name: "other",
            tools,
          }),
        ],
      },
    ])
    expect(built.settings).toHaveLength(1)
    expect(built.settings[0]).toMatchObject({
      readTool: "settings.read",
      title: "Bits & Bolts",
      updateTool: "settings.update",
    })
    expect(built.diagnostics.map((entry) => entry.reason)).toEqual([
      "missing_invalid_or_duplicate_settings_tools",
    ])
  })

  it("reads mention tools from the capability or the per-tool marker", () => {
    const built = buildCatalog([
      {
        host: host("codex"),
        servers: [
          server({
            capabilities: { extensions: { "openai/mentions": { searchTool: "search" } } },
            tools: [{ annotations: { readOnlyHint: true }, name: "search" }],
          }),
          server({
            name: "marked",
            tools: [
              {
                _meta: {
                  "openai/extensions": { "mentions/search": {} },
                  ui: { visibility: ["app"] },
                },
                name: "find",
              },
            ],
          }),
        ],
      },
    ])
    expect(built.mentions.map((entry) => [entry.server, entry.tool])).toEqual([
      ["bits-and-bolts", "search"],
      ["marked", "find"],
    ])
  })

  it("lets the first host win a plugin's server and skips hosts without full metadata", () => {
    const tools = [appTool("cad.library", [{ type: "global" }])]
    const built = buildCatalog([
      { host: host("codex"), servers: [server({ tools })] },
      { host: host("claude"), servers: [server({ tools })] },
      {
        host: host("claude", {
          support: { fullMetadata: false, serverResources: false, toolCalls: false },
        }),
        servers: [server({ name: "claude-only", tools })],
      },
    ])
    expect(built.entrypoints).toHaveLength(1)
    expect(built.entrypoints[0]?.agentId).toBe("codex")
  })

  it("routes bundled servers by name without catalog surfaces", () => {
    const bundled = host(null, { catalog: false })
    const built = buildCatalog([
      {
        host: bundled,
        servers: [server({ name: "code-review", tools: [appTool("open", [{ type: "global" }])] })],
      },
    ])
    expect(built.entrypoints).toEqual([])
    expect([...built.servers.values()][0]?.host).toBe(bundled)
  })
})

describe("acceptIcon", () => {
  it("accepts https and raster data icons and strips scripts from SVG", () => {
    expect(acceptIcon({ src: "https://example.com/icon.svg" })?.src).toBe(
      "https://example.com/icon.svg"
    )
    expect(acceptIcon({ src: "data:image/png;base64,AAAA" })?.src).toBe(
      "data:image/png;base64,AAAA"
    )
    expect(acceptIcon({ src: "http://example.com/icon.svg" })).toBeNull()
    expect(acceptIcon({ src: "javascript:alert(1)" })).toBeNull()
    const svg = acceptIcon({
      src: `data:image/svg+xml,${encodeURIComponent('<svg onload="x()"><script>x()</script><path d="M0"/></svg>')}`,
    })
    const decoded = Buffer.from(svg?.src.split(",")[1] ?? "", "base64").toString("utf8")
    expect(decoded).toBe('<svg><path d="M0"/></svg>')
  })
})
