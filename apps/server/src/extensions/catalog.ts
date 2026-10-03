import {
  type AgentId,
  type ExtensionCatalog,
  type ExtensionDiagnostic,
  type ExtensionEntrypoint,
  type ExtensionIcon,
  type ExtensionMentionProvider,
  type ExtensionSettingsProvider,
  OpenAIIconSchema,
  OpenAIMentionsCapabilitySchema,
  OpenAISettingsCapabilitySchema,
  OpenAIUiToolMetadataSchema,
} from "@cypheria/protocol"
import { z } from "zod"

import type { McpHost, McpServerInventory, McpToolDescriptor } from "./mcp-host.js"

/** One host's servers, in host priority order. */
export type HostInventory = {
  readonly host: McpHost
  readonly servers: readonly McpServerInventory[]
}

/** Where a catalog surface's calls go. */
export type CatalogRoute = {
  readonly host: McpHost
  readonly server: McpServerInventory
}

export type BuiltCatalog = Omit<ExtensionCatalog, "revision"> & {
  /** Routes by entry point, settings provider, and mention provider ID. */
  readonly routes: ReadonlyMap<string, CatalogRoute>
  /** Each server's host and inventory, by `serverKey`. */
  readonly servers: ReadonlyMap<string, CatalogRoute>
}

/** Identifies a server across Agents: the same plugin and server name is the same server. */
export const serverKey = (pluginId: string | null, server: string): string =>
  JSON.stringify([pluginId, server])

const MAX_DATA_ICON = 256 * 1024

/** Accepts `https:` icons and raster or SVG `data:` icons, with scripts removed from SVG. */
export const acceptIcon = (value: unknown): ExtensionIcon | null => {
  const parsed = OpenAIIconSchema.safeParse(value)
  if (!parsed.success) return null
  const { mimeType, src, theme } = parsed.data
  let accepted: string | null = null
  if (/^https:\/\/[^\s"'<>]+$/iu.test(src)) {
    accepted = src
  } else if (src.length <= MAX_DATA_ICON) {
    const match = /^data:image\/(png|jpeg|gif|webp|svg\+xml)(;base64)?,(.*)$/isu.exec(src)
    if (match) {
      const [, type, base64, data = ""] = match
      if (type?.toLowerCase() !== "svg+xml") {
        accepted = src
      } else {
        let svg: string
        try {
          svg = base64 ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data)
        } catch {
          return null
        }
        const clean = svg
          .replace(/<script[\s\S]*?<\/script\s*>/giu, "")
          .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/giu, "")
          .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/giu, "")
          .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/giu, "$1#")
        accepted = `data:image/svg+xml;base64,${Buffer.from(clean, "utf8").toString("base64")}`
      }
    }
  }
  return accepted ? { mimeType: mimeType ?? null, src: accepted, theme: theme ?? null } : null
}

const firstIcon = (icons: readonly unknown[] | null | undefined): ExtensionIcon | null => {
  for (const icon of icons ?? []) {
    const accepted = acceptIcon(icon)
    if (accepted) return accepted
  }
  return null
}

/** `_meta.ui.resourceUri`, or the deprecated flat `_meta["ui/resourceUri"]`. */
export const toolResourceUri = (tool: McpToolDescriptor): string | null => {
  const meta = tool._meta ?? {}
  const nested = (meta.ui as { resourceUri?: unknown } | undefined)?.resourceUri
  const value = typeof nested === "string" ? nested : meta["ui/resourceUri"]
  return typeof value === "string" && value.startsWith("ui://") ? value : null
}

/** `_meta.ui.visibility`; MCP Apps default to both the model and the App. */
export const toolVisibility = (tool: McpToolDescriptor): readonly string[] => {
  const visibility = (tool._meta?.ui as { visibility?: unknown } | undefined)?.visibility
  return Array.isArray(visibility) && visibility.every((entry) => typeof entry === "string")
    ? visibility
    : ["model", "app"]
}

export const toolTitle = (tool: McpToolDescriptor): string => {
  const annotated = tool.annotations?.title
  return tool.title?.trim() || (typeof annotated === "string" && annotated.trim()) || tool.name
}

const readOnly = (tool: McpToolDescriptor) => tool.annotations?.readOnlyHint === true

/** An extension capability under `extensions`, or the legacy `experimental`. */
const capability = <T>(
  capabilities: Record<string, unknown> | null,
  name: string,
  schema: z.ZodType<T>
): { value: T } | { error: z.ZodError } | null => {
  const record = z
    .object({
      experimental: z.record(z.string(), z.unknown()).optional(),
      extensions: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(capabilities ?? {})
  if (!record.success) return null
  const { experimental, extensions } = record.data
  const raw =
    extensions && Object.hasOwn(extensions, name) ? extensions[name] : experimental?.[name]
  if (raw === undefined) return null
  const parsed = schema.safeParse(raw)
  return parsed.success ? { value: parsed.data } : { error: parsed.error }
}

const MentionMarkerSchema = z.object({ "mentions/search": z.object({}).passthrough() })

/**
 * Builds the catalog from each host's servers. Hosts come in priority order; the first host that
 * reports a server wins it, so a plugin enabled for several Agents appears once. Like ChatGPT
 * Desktop, every tool is validated on its own and anything dropped is reported as a diagnostic.
 */
export const buildCatalog = (inventories: readonly HostInventory[]): BuiltCatalog => {
  const entrypoints: ExtensionEntrypoint[] = []
  const settings: ExtensionSettingsProvider[] = []
  const mentions: ExtensionMentionProvider[] = []
  const diagnostics: ExtensionDiagnostic[] = []
  const routes = new Map<string, CatalogRoute>()
  const servers = new Map<string, CatalogRoute>()

  for (const { host, servers: hostServers } of inventories) {
    if (!host.support.fullMetadata || !host.support.toolCalls) continue
    const agentId: AgentId | null = host.agentId
    for (const server of hostServers) {
      const key = serverKey(server.pluginId, server.name)
      if (servers.has(key)) continue
      servers.set(key, { host, server })
      if (host.catalog === false) continue
      const source = { agentId, pluginId: server.pluginId, server: server.name }
      const diagnose = (tool: string | null, reason: string, message: string) =>
        diagnostics.push({ ...source, message, reason, tool })
      if (server.error) {
        diagnose(null, "tool_discovery_failed", server.error)
        continue
      }
      const tools = new Map(server.tools.map((tool) => [tool.name, tool]))
      const serverIcon = firstIcon(server.serverInfo?.icons)
      const serverTitle = server.serverInfo?.title ?? server.serverInfo?.name ?? server.name

      const settingsCapability = capability(
        server.capabilities,
        "openai/settings",
        OpenAISettingsCapabilitySchema
      )
      if (settingsCapability && "error" in settingsCapability) {
        diagnose(
          null,
          "invalid_settings_capability",
          "Plugin settings are unavailable: the openai/settings capability is invalid."
        )
      } else if (settingsCapability) {
        const { readTool, updateTool } = settingsCapability.value
        if (readTool === updateTool || !tools.has(readTool) || !tools.has(updateTool)) {
          diagnose(
            null,
            "missing_invalid_or_duplicate_settings_tools",
            "Plugin settings are unavailable: readTool and updateTool must name two distinct tools the server lists."
          )
        } else {
          const id = JSON.stringify(["settings", server.pluginId, server.name])
          settings.push({
            ...source,
            icon: serverIcon,
            id,
            readTool,
            title: serverTitle,
            updateTool,
          })
          routes.set(id, { host, server })
        }
      }

      const mentionsCapability = capability(
        server.capabilities,
        "openai/mentions",
        OpenAIMentionsCapabilitySchema
      )
      const mentionTools: McpToolDescriptor[] = []
      if (mentionsCapability && "value" in mentionsCapability) {
        const tool = tools.get(mentionsCapability.value.searchTool)
        if (tool && readOnly(tool)) mentionTools.push(tool)
        else {
          diagnose(
            mentionsCapability.value.searchTool,
            "invalid_mention_tool",
            "Mentions are unavailable: the search tool must be a listed, read-only tool."
          )
        }
      } else {
        for (const tool of server.tools) {
          const marker = MentionMarkerSchema.safeParse(
            tool._meta?.["openai/extensions"] ?? tool._meta?.["openai/capabilities"]
          )
          if (!marker.success) continue
          if (toolVisibility(tool).includes("app")) mentionTools.push(tool)
          else {
            diagnose(
              tool.name,
              "invalid_mention_tool",
              "Mentions are unavailable: the search tool must be visible to the App."
            )
          }
        }
      }
      for (const tool of mentionTools) {
        const id = JSON.stringify(["mentions", server.pluginId, server.name, tool.name])
        mentions.push({
          ...source,
          icon: firstIcon(tool.icons) ?? serverIcon,
          id,
          title: serverTitle,
          tool: tool.name,
        })
        routes.set(id, { host, server })
      }

      for (const tool of server.tools) {
        const rawUi = tool._meta?.["openai/ui"]
        if (rawUi === undefined) continue
        const ui = OpenAIUiToolMetadataSchema.safeParse(rawUi)
        if (!ui.success) {
          diagnose(
            tool.name,
            "invalid_ui_metadata",
            'Plugin entry point ignored: the tool metadata at _meta["openai/ui"] is invalid.'
          )
          continue
        }
        const declared = ui.data.entrypoints ?? []
        if (declared.length === 0) continue
        const resourceUri = toolResourceUri(tool)
        if (!resourceUri) {
          diagnose(
            tool.name,
            "missing_or_invalid_ui_resource",
            "Plugin entry point ignored: the tool must declare a UI resource URI starting with ui://."
          )
          continue
        }
        const icon = firstIcon(tool.icons) ?? serverIcon
        for (const entry of declared) {
          const id = JSON.stringify([server.pluginId, server.name, tool.name, entry.type])
          if (routes.has(id)) continue
          routes.set(id, { host, server })
          entrypoints.push({
            ...source,
            extensions:
              entry.type === "file"
                ? [
                    ...new Set(
                      entry.extensions
                        .map((extension) => extension.trim().replace(/^\.+/u, "").toLowerCase())
                        .filter(Boolean)
                    ),
                  ]
                : [],
            icon,
            id,
            quickAction:
              entry.type === "global" && entry.quickAction
                ? {
                    arguments: entry.quickAction.target.arguments ?? {},
                    icon: firstIcon(entry.quickAction.icons),
                    title: entry.quickAction.title,
                    tool: entry.quickAction.target.name,
                  }
                : null,
            resourceUri,
            searchTerms: entry.type === "settings" ? (entry.searchTerms ?? []) : [],
            title: toolTitle(tool),
            tool: tool.name,
            type: entry.type,
          })
        }
      }
    }
  }
  return { diagnostics, entrypoints, mentions, routes, servers, settings }
}
