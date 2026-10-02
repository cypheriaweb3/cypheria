import { access, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import type {
  McpAppClientMessage,
  McpAppResourceContent,
  McpAppServerMessage,
  McpAppTool,
  McpAppToolResult,
} from "@cypheria/protocol"

import type { AppToolMcpResult, AppToolMcpTool } from "../app-tools/service.js"
import { bundledMarketplaceDirectory } from "../integration/plugin-utils.js"

/** An MCP server whose tools and App resources the Server answers itself. */
export type McpAppProvider = {
  listTools(): AppToolMcpTool[]
  readResource(uri: string): Promise<McpAppResourceContent[]>
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<AppToolMcpResult>
}

/** Reaches MCP servers other Agents load, through the Codex App Server. */
export type McpAppCodexBridge = {
  readResource(server: string, uri: string, threadId?: string): Promise<McpAppResourceContent[]>
  callTool(input: {
    server: string
    name: string
    arguments?: unknown
    threadId: string
    meta?: Record<string, unknown>
  }): Promise<McpAppToolResult>
  listTools(server: string, threadId?: string): Promise<McpAppTool[]>
}

const toResult = (result: AppToolMcpResult): McpAppToolResult => ({
  content: [...result.content],
  isError: result.isError,
  ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
})

const toTool = (tool: AppToolMcpTool): McpAppTool => ({
  inputSchema: tool.inputSchema,
  name: tool.name,
  ...(tool.title ? { title: tool.title } : {}),
  ...(tool.description ? { description: tool.description } : {}),
  ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
  ...(tool._meta ? { _meta: tool._meta } : {}),
})

/**
 * The client side of MCP Apps: a client reads an App's `ui://` resource and calls its server's tools
 * through these requests. Bundled Cypheria servers are answered in this process.
 */
export class McpAppService {
  readonly #providers: ReadonlyMap<string, McpAppProvider>
  readonly #codex: McpAppCodexBridge | undefined

  constructor(providers: Record<string, McpAppProvider>, codex?: McpAppCodexBridge) {
    this.#providers = new Map(Object.entries(providers))
    this.#codex = codex
  }

  async handle(
    request: McpAppClientMessage,
    send: (message: McpAppServerMessage) => void
  ): Promise<boolean> {
    const type = request.type.replace(/\.request$/u, ".response") as McpAppServerMessage["type"]
    try {
      const value = await this.#run(request)
      send({
        payload: { ok: true, value },
        requestId: request.requestId,
        type,
      } as McpAppServerMessage)
    } catch (error) {
      send({
        payload: {
          error: {
            code: "MCP_APP_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
          ok: false,
        },
        requestId: request.requestId,
        type,
      } as McpAppServerMessage)
    }
    return true
  }

  async #run(request: McpAppClientMessage): Promise<unknown> {
    const { server, threadId } = request.payload
    const provider = this.#providers.get(server)
    switch (request.type) {
      case "mcpApp.tools.list.request":
        if (provider) return { tools: provider.listTools().map(toTool) }
        return { tools: await this.#bridge().listTools(server, threadId) }
      case "mcpApp.resource.read.request":
        if (provider) return { contents: await provider.readResource(request.payload.uri) }
        return {
          contents: await this.#bridge().readResource(server, request.payload.uri, threadId),
        }
      case "mcpApp.tool.call.request":
        if (provider) {
          return toResult(
            await provider.callTool(request.payload.name, request.payload.arguments ?? {})
          )
        }
        if (!threadId) throw new Error("This MCP App needs a Thread to call its tools")
        return this.#bridge().callTool({
          arguments: request.payload.arguments,
          name: request.payload.name,
          server,
          threadId,
          ...(request.payload._meta ? { meta: request.payload._meta } : {}),
        })
    }
  }

  #bridge(): McpAppCodexBridge {
    if (!this.#codex) throw new Error("This MCP server is unavailable")
    return this.#codex
  }
}

/**
 * The Code Review App's HTML: the bundled plugin's `assets/pull-requests.html` in a built Server,
 * or the `@cypheria/code-review-app` build output in a checkout.
 */
export const readCodeReviewAppHtml = async (): Promise<string> => {
  const candidates: string[] = []
  try {
    const marketplace = await bundledMarketplaceDirectory(".agents/plugins/marketplace.json")
    candidates.push(`${marketplace}/plugins/code-review/assets/pull-requests.html`)
  } catch {
    // A checkout without the marketplace still has the App's build output.
  }
  candidates.push(
    fileURLToPath(
      new URL("../../../../packages/code-review-app/dist/pull-requests.html", import.meta.url)
    )
  )
  for (const candidate of candidates) {
    const exists = await access(candidate).then(
      () => true,
      () => false
    )
    if (exists) return readFile(candidate, "utf8")
  }
  throw new Error(
    "The Code Review App is not built. Run `pnpm --filter @cypheria/code-review-app build`."
  )
}
