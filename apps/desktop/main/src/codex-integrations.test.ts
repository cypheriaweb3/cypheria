import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import { describe, expect, it, vi } from "vitest"
import {
  AppEnabledRequestSchema,
  CodexAppListResultSchema,
  CodexMcpListResultSchema,
  McpAddRequestSchema,
  McpEnabledRequestSchema,
} from "../../ipc/src/integrations.js"
import {
  addCodexMcp,
  integrationWebUrl,
  listCodexApps,
  listCodexMcp,
  loginCodexMcp,
  openCodexAppConnection,
  setCodexAppEnabled,
  setCodexMcpEnabled,
} from "./codex-integrations.js"

function fake(responses: Record<string, unknown | ((params: Record<string, unknown>) => unknown)>) {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    const value = responses[method]
    if (value instanceof Error) throw value
    return typeof value === "function" ? value(params) : (value ?? {})
  })
  return { bridge: { request } as unknown as CodexAppServerBridge, request }
}
const app = {
  id: "github",
  name: "GitHub",
  description: "Code",
  logoUrl: "https://example.test/logo.png",
  installUrl: "https://example.test/connect",
  isAccessible: true,
  isEnabled: true,
  pluginDisplayNames: ["GitHub"],
}
const server = {
  name: "docs",
  pluginId: null,
  runtimeStatus: "authenticationRequired",
  authStatus: "notLoggedIn",
  tools: { search: { description: "Search docs" } },
  resources: [],
  resourceTemplates: [],
}
const mcpResponses = {
  "mcpServerStatus/list": { data: [server], nextCursor: null },
  "config/read": {
    config: {
      mcp_servers: {
        docs: { enabled: true, env: { SECRET: "do-not-expose" } },
        disabled: { enabled: false },
      },
    },
  },
}

describe("integration management", () => {
  it("validates incomplete MCP forms without throwing", () => {
    expect(McpAddRequestSchema.safeParse({ name: "", url: "" }).success).toBe(false)
    expect(McpAddRequestSchema.safeParse({ name: "docs", url: "https://" }).success).toBe(false)
  })
  it("adds an HTTP MCP server without overwriting an existing entry", async () => {
    const { bridge, request } = fake(mcpResponses)
    await addCodexMcp(bridge, { name: "remote", url: "https://example.test/mcp" })
    expect(request).toHaveBeenCalledWith("config/value/write", {
      keyPath: "mcp_servers.remote",
      value: { url: "https://example.test/mcp", enabled: true },
      mergeStrategy: "upsert",
    })
    await expect(
      addCodexMcp(bridge, { name: "docs", url: "https://example.test/mcp" })
    ).rejects.toThrow("already exists")
    await expect(addCodexMcp(bridge, { name: "remote", url: "file:///tmp/test" })).rejects.toThrow()
  })
  it("paginates apps and distinguishes accessible, enabled and callable", async () => {
    const { bridge, request } = fake({
      "app/list": (p: Record<string, unknown>) =>
        p.cursor
          ? { data: [{ ...app, id: "drive", isAccessible: false }], nextCursor: null }
          : { data: [app], nextCursor: "next" },
      "app/installed": { apps: [{ id: "github", enabled: true, callable: false }] },
    })
    const result = CodexAppListResultSchema.parse(await listCodexApps(bridge, true))
    expect(result.apps).toHaveLength(2)
    expect(result.apps[0]).toMatchObject({ accessible: true, enabled: true, callable: false })
    expect(result.apps[1]).toMatchObject({ accessible: false, callable: null })
    expect(request).toHaveBeenCalledWith("app/list", {
      cursor: "next",
      limit: 100,
      forceRefetch: true,
    })
  })
  it("preserves app metadata when the runtime snapshot is unavailable", async () => {
    const { bridge } = fake({
      "app/list": { data: [app], nextCursor: null },
      "app/installed": new Error("runtime unavailable"),
    })
    const result = await listCodexApps(bridge)
    expect(result.apps[0]?.callable).toBeNull()
    expect(result.runtimeError).toBeTruthy()
  })
  it("rejects repeated cursors instead of looping or truncating", async () => {
    const { bridge } = fake({
      "app/list": { data: [], nextCursor: "same" },
      "app/installed": { apps: [] },
    })
    await expect(listCodexApps(bridge)).rejects.toThrow("repeated pagination")
  })
  it("writes only a known accessible app's enablement and opens its server-provided page", async () => {
    const { bridge, request } = fake({
      "app/list": { data: [app], nextCursor: null },
      "app/installed": { apps: [] },
    })
    await setCodexAppEnabled(bridge, "github", false)
    expect(request).toHaveBeenCalledWith("config/value/write", {
      keyPath: "apps.github.enabled",
      value: false,
      mergeStrategy: "upsert",
    })
    const open = vi.fn(async () => {})
    await openCodexAppConnection(bridge, "github", open)
    expect(open).toHaveBeenCalledWith("https://example.test/connect")
    await expect(setCodexAppEnabled(bridge, "missing", true)).rejects.toThrow("not available")
    expect(AppEnabledRequestSchema.safeParse({ appId: "x.enabled", enabled: true }).success).toBe(
      false
    )
  })
  it("includes disabled MCP config without exposing commands, secrets or tokens", async () => {
    const { bridge } = fake(mcpResponses)
    const result = CodexMcpListResultSchema.parse(await listCodexMcp(bridge))
    expect(result.servers).toHaveLength(2)
    expect(result.servers[0]).toMatchObject({
      authStatus: "notLoggedIn",
      runtimeStatus: "authenticationRequired",
      configurable: true,
    })
    expect(result.servers[1]).toMatchObject({
      name: "disabled",
      enabled: false,
      runtimeStatus: "disabled",
    })
    expect(JSON.stringify(result)).not.toContain("do-not-expose")
  })
  it("toggles standalone MCP configuration then reloads, but refuses plugin-owned writes", async () => {
    const { bridge, request } = fake(mcpResponses)
    await setCodexMcpEnabled(bridge, "docs", false)
    expect(request).toHaveBeenCalledWith("config/value/write", {
      keyPath: "mcp_servers.docs.enabled",
      value: false,
      mergeStrategy: "upsert",
    })
    expect(request).toHaveBeenLastCalledWith("config/mcpServer/reload", undefined)
    const owned = fake({
      ...mcpResponses,
      "mcpServerStatus/list": { data: [{ ...server, pluginId: "docs@team" }], nextCursor: null },
    })
    await expect(setCodexMcpEnabled(owned.bridge, "docs", false)).rejects.toThrow("owning plugin")
    expect(
      McpEnabledRequestSchema.safeParse({ name: "docs.enabled", enabled: false }).success
    ).toBe(false)
  })
  it("opens OAuth without claiming completion and rejects unsafe redirects", async () => {
    const { bridge } = fake({
      ...mcpResponses,
      "mcpServer/oauth/login": { authorizationUrl: "https://auth.example.test/authorize" },
    })
    const open = vi.fn(async () => {})
    await expect(loginCodexMcp(bridge, "docs", open)).resolves.toEqual({ opened: true })
    expect(open).toHaveBeenCalledWith("https://auth.example.test/authorize")
    const unsafe = fake({
      ...mcpResponses,
      "mcpServer/oauth/login": { authorizationUrl: "javascript:alert(1)" },
    })
    await expect(loginCodexMcp(unsafe.bridge, "docs", open)).rejects.toThrow(
      "invalid authorization"
    )
    expect(integrationWebUrl("file:///tmp/token")).toBeNull()
    expect(integrationWebUrl("https://user:secret@example.test")).toBeNull()
  })
})
