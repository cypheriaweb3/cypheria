import type { CodexAppServerBridge, v2 } from "@cypheria/codex-bridge"
import { z } from "zod"
import {
  type CodexAppListResult,
  type CodexMcpListResult,
  IntegrationIdSchema,
  McpAddRequestSchema,
} from "../../ipc/src/integrations.js"

export const integrationWebUrl = (value: string | null | undefined) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

// Bound and validate pagination; never silently present a truncated catalog as complete.
async function pages<T>(
  fetch: (cursor: string | null) => Promise<{ data: T[]; nextCursor: string | null }>
) {
  let cursor: string | null = null
  const seen = new Set<string>()
  const items: T[] = []
  for (let page = 0; page < 100; page++) {
    const response = await fetch(cursor)
    items.push(...response.data)
    if (!response.nextCursor) return items
    if (seen.has(response.nextCursor))
      throw new Error("The server returned a repeated pagination cursor. Please refresh.")
    seen.add(response.nextCursor)
    cursor = response.nextCursor
  }
  throw new Error("The integration catalog exceeded the page limit.")
}

export async function listCodexApps(
  bridge: CodexAppServerBridge,
  forceRefetch = false
): Promise<CodexAppListResult> {
  const [entries, runtime] = await Promise.all([
    pages<v2.AppInfo>((cursor) =>
      bridge.request<"app/list", v2.AppsListResponse>("app/list", {
        cursor,
        limit: 100,
        forceRefetch,
      })
    ),
    bridge
      .request<"app/installed", v2.AppsInstalledResponse>("app/installed", {
        forceRefresh: forceRefetch,
      })
      .then((value) => ({ value, error: null }))
      .catch(() => ({
        value: null,
        error: "Runtime availability could not be checked. Refresh to retry.",
      })),
  ])
  const states = new Map(runtime.value?.apps.map((app) => [app.id, app]))
  return {
    runtimeError: runtime.error,
    apps: [...new Map(entries.map((app) => [app.id, app])).values()].map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      logoUrl: integrationWebUrl(app.logoUrl),
      installUrl: integrationWebUrl(app.installUrl),
      accessible: app.isAccessible,
      enabled: app.isEnabled,
      callable: states.get(app.id)?.callable ?? null,
      effectiveEnabled: states.get(app.id)?.enabled ?? null,
      pluginNames: app.pluginDisplayNames,
    })),
  }
}

export async function setCodexAppEnabled(
  bridge: CodexAppServerBridge,
  appId: string,
  enabled: boolean
) {
  IntegrationIdSchema.parse(appId)
  const { apps } = await listCodexApps(bridge)
  if (!apps.some((app) => app.id === appId && app.accessible))
    throw new Error("This app is not available to the current account.")
  await bridge.request<"config/value/write", v2.ConfigWriteResponse>("config/value/write", {
    keyPath: `apps.${appId}.enabled`,
    value: enabled,
    mergeStrategy: "upsert",
  })
  return { enabled }
}

export async function openCodexAppConnection(
  bridge: CodexAppServerBridge,
  appId: string,
  openExternal: (url: string) => Promise<unknown>
) {
  const app = (await listCodexApps(bridge)).apps.find((app) => app.id === appId)
  if (!app?.installUrl) throw new Error("No connection page is available for this app.")
  await openExternal(app.installUrl)
  return { opened: true as const }
}

const mcpConfigSchema = z.record(
  z.string(),
  z.object({ enabled: z.boolean().optional() }).passthrough()
)
async function configuredMcp(bridge: CodexAppServerBridge) {
  const result = await bridge.request<"config/read", v2.ConfigReadResponse>("config/read", {
    includeLayers: false,
  })
  return mcpConfigSchema.parse(result.config.mcp_servers ?? {})
}

export async function listCodexMcp(bridge: CodexAppServerBridge): Promise<CodexMcpListResult> {
  const [entries, config] = await Promise.all([
    pages<v2.McpServerStatus>((cursor) =>
      bridge.request<"mcpServerStatus/list", v2.ListMcpServerStatusResponse>(
        "mcpServerStatus/list",
        { cursor, limit: 100, detail: "full" }
      )
    ),
    configuredMcp(bridge),
  ])
  const servers: CodexMcpListResult["servers"] = [
    ...new Map(entries.map((server) => [server.name, server])).values(),
  ].map((server) => ({
    name: server.name,
    pluginId: server.pluginId,
    enabled: Object.hasOwn(config, server.name) ? config[server.name]?.enabled !== false : null,
    configurable:
      !server.pluginId &&
      Object.hasOwn(config, server.name) &&
      IntegrationIdSchema.safeParse(server.name).success,
    authStatus: server.authStatus,
    runtimeStatus: server.runtimeStatus,
    tools: Object.entries(server.tools).flatMap(([name, tool]) =>
      tool ? [{ name, description: tool.description ?? null }] : []
    ),
    resourceCount: server.resources.length + server.resourceTemplates.length,
  }))
  // Disabled configuration entries may not be included in the runtime inventory.
  for (const [name, entry] of Object.entries(config)) {
    if (servers.some((server) => server.name === name)) continue
    servers.push({
      name,
      pluginId: null,
      enabled: entry.enabled !== false,
      configurable: IntegrationIdSchema.safeParse(name).success,
      authStatus: "unknown",
      runtimeStatus: entry.enabled === false ? "disabled" : null,
      tools: [],
      resourceCount: 0,
    })
  }
  return { servers }
}

export async function setCodexMcpEnabled(
  bridge: CodexAppServerBridge,
  name: string,
  enabled: boolean
) {
  IntegrationIdSchema.parse(name)
  const server = (await listCodexMcp(bridge)).servers.find((server) => server.name === name)
  if (!server?.configurable) throw new Error("Manage this server through its owning plugin.")
  await bridge.request<"config/value/write", v2.ConfigWriteResponse>("config/value/write", {
    keyPath: `mcp_servers.${name}.enabled`,
    value: enabled,
    mergeStrategy: "upsert",
  })
  await bridge.request("config/mcpServer/reload", undefined)
  return { enabled }
}

export async function loginCodexMcp(
  bridge: CodexAppServerBridge,
  name: string,
  openExternal: (url: string) => Promise<unknown>
) {
  const server = (await listCodexMcp(bridge)).servers.find((server) => server.name === name)
  if (
    !server ||
    server.enabled === false ||
    server.authStatus === "unsupported" ||
    server.authStatus === "bearerToken"
  )
    throw new Error("OAuth login is not available for this server.")
  const result = await bridge.request<"mcpServer/oauth/login", v2.McpServerOauthLoginResponse>(
    "mcpServer/oauth/login",
    { name }
  )
  const url = integrationWebUrl(result.authorizationUrl)
  if (!url) throw new Error("The server returned an invalid authorization URL.")
  await openExternal(url)
  return { opened: true as const }
}

export async function addCodexMcp(
  bridge: CodexAppServerBridge,
  input: { name: string; url: string }
) {
  const { name, url } = McpAddRequestSchema.parse(input)
  const { servers } = await listCodexMcp(bridge)
  if (servers.some((server) => server.name === name))
    throw new Error("A server with this name already exists. Choose another name.")
  await bridge.request<"config/value/write", v2.ConfigWriteResponse>("config/value/write", {
    keyPath: `mcp_servers.${name}`,
    value: { url, enabled: true },
    mergeStrategy: "upsert",
  })
  await bridge.request("config/mcpServer/reload", undefined)
  return { added: true as const }
}
