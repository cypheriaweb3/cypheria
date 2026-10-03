import type { ExtensionToolResult } from "@cypheria/protocol"

import type { AppToolMcpResult, AppToolMcpTool } from "../app-tools/service.js"
import type {
  McpHost,
  McpResourceContent,
  McpServerInventory,
  McpToolDescriptor,
} from "./mcp-host.js"

/** A bundled plugin's MCP server, answered by the Server itself. */
export type BundledMcpServer = {
  readonly pluginId: string
  listTools(): readonly AppToolMcpTool[]
  readResource(uri: string): Promise<readonly McpResourceContent[]>
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<AppToolMcpResult>
}

const toResult = (result: AppToolMcpResult): ExtensionToolResult => ({
  content: [...result.content],
  isError: result.isError,
  ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
})

const toTool = (tool: AppToolMcpTool): McpToolDescriptor => ({
  ...(tool._meta ? { _meta: tool._meta } : {}),
  ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
  description: tool.description,
  inputSchema: tool.inputSchema,
  name: tool.name,
  ...(tool.title ? { title: tool.title } : {}),
})

/**
 * Cypheria's bundled plugins. Their MCP servers are relays to Server code, so the Server answers
 * their Apps directly and they work whichever Agent is installed.
 */
export class BundledMcpHost implements McpHost {
  readonly agentId = null
  readonly catalog = false
  readonly support = { fullMetadata: true, serverResources: true, toolCalls: true }
  readonly #servers: ReadonlyMap<string, BundledMcpServer>

  constructor(servers: Record<string, BundledMcpServer>) {
    this.#servers = new Map(Object.entries(servers))
  }

  async listServers(): Promise<readonly McpServerInventory[]> {
    return [...this.#servers].map(([name, server]) => ({
      capabilities: null,
      error: null,
      name,
      pluginId: server.pluginId,
      serverInfo: null,
      tools: server.listTools().map(toTool),
    }))
  }

  async readResource(input: { server: string; uri: string }) {
    return this.#server(input.server).readResource(input.uri)
  }

  async callTool(input: {
    arguments: Record<string, unknown>
    server: string
    signal?: AbortSignal
    tool: string
  }): Promise<ExtensionToolResult> {
    return toResult(
      await this.#server(input.server).callTool(input.tool, input.arguments, input.signal)
    )
  }

  #server(name: string): BundledMcpServer {
    const server = this.#servers.get(name)
    if (!server) throw new Error(`Unknown bundled MCP server: ${name}`)
    return server
  }
}
