/**
 * Tool Proxy Host
 *
 * Host-side manager that starts a TCP server to handle tool execution requests.
 * Uses inline runtime code to avoid external file dependencies.
 */

import { randomBytes } from "node:crypto"
import { createServer, type Server, type Socket } from "node:net"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Tool } from "ai"
import { createErrorResponse, createResponse, parseMessage, serializeMessage } from "./json-rpc.js"
import {
  type CallHandlerParams,
  JsonRpcErrorCode,
  type JsonRpcRequest,
  type JsonRpcResponse,
  ProxyMethod,
  type ToolDefinition,
  type ToolResult,
} from "./types.js"

/**
 * ACP EnvVariable format
 */
export interface EnvVariable {
  name: string
  value: string
}

/**
 * MCP server configuration for session.mcpServers (ACP Stdio format)
 */
export interface MCPServerConfig {
  name: string
  command: string
  args: string[]
  env: EnvVariable[]
}

import { RUNTIME_CODE } from "./tool-proxy-runtime.js"

/**
 * Tool Proxy Host manages a TCP server that receives tool execution requests
 * from the runtime process (spawned by ACP agent).
 *
 * The proxy executes host-side AI SDK tools with an `execute` function. Tools
 * without `execute` are rejected before a session starts.
 */
export class ToolProxyHost {
  private server: Server | null = null
  private connections: Socket[] = []
  private tools = new Map<string, Tool>()
  private serverName: string
  private port: number = 0
  private readonly token = randomBytes(32).toString("base64url")
  private abortSignal: AbortSignal | undefined

  constructor(name = "acp-tool-proxy") {
    this.serverName = name
  }

  /**
   * Register an AI SDK tool to be exposed through the proxy
   */
  registerTool(name: string, tool: Tool): void {
    this.tools.set(name, tool)
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Record<string, Tool>): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.registerTool(name, tool)
    }
  }

  replaceTools(tools: Array<Tool & { name: string }>): void {
    this.tools.clear()
    for (const toolDefinition of tools) this.registerTool(toolDefinition.name, toolDefinition)
    this.notifyToolsChanged()
  }

  setExecutionContext(options: { abortSignal?: AbortSignal }): void {
    this.abortSignal = options.abortSignal
  }

  /**
   * Get tool definitions for the runtime
   */
  private getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    for (const [name, tool] of this.tools.entries()) {
      definitions.push({
        name,
        description: typeof tool.description === "string" ? tool.description : `Tool: ${name}`,
        // inputSchema from Tool can be Zod or JSON schema, cast to JSON schema format
        inputSchema: (tool.inputSchema as Record<string, unknown>) || {
          type: "object",
          properties: {},
        },
      })
    }
    return definitions
  }

  /**
   * Start TCP server and return MCP server config for ACP
   */
  async start(): Promise<MCPServerConfig> {
    if (!this.server) {
      // Create TCP server for runtime callbacks if not started
      await this.startServer()
    }

    return this.getServerConfig()
  }

  /**
   * Get MCP server configuration
   */
  private getServerConfig(): MCPServerConfig {
    // Uses node -e with inline runtime code
    // NO TOOLS passed in env - runtime will fetch them via TCP
    return {
      name: this.serverName,
      command: "node",
      args: ["-e", RUNTIME_CODE],
      env: [
        { name: "ACP_TOOL_PROXY_PORT", value: String(this.port) },
        { name: "ACP_TOOL_PROXY_TOKEN", value: this.token },
      ],
    }
  }

  /**
   * Start TCP server to receive tool execution requests
   */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket)
      })

      this.server.on("error", (err) => {
        // console.error("[ToolProxy] Server error:", err);
        reject(err)
      })

      // Listen on random available port
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server?.address()
        if (typeof address === "object" && address) {
          this.port = address.port
          // console.log(`[ToolProxy] Listening on port ${this.port}`);
          resolve()
        } else {
          reject(new Error("Failed to get server address"))
        }
      })
    })
  }

  /**
   * Handle incoming connection from runtime
   */
  private handleConnection(socket: Socket): void {
    this.connections.push(socket)

    let buffer = ""

    socket.on("data", (data) => {
      buffer += data.toString()
      if (buffer.length > 1_048_576) {
        socket.destroy(new Error("Tool proxy message exceeds 1 MiB"))
        return
      }
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.trim()) continue

        const message = parseMessage(line)
        if (!message) continue

        if ("method" in message) {
          this.handleRequest(socket, message as JsonRpcRequest).catch((err) =>
            console.error("[ToolProxy] Error handling request:", err)
          )
        }
      }
    })

    socket.on("close", () => {
      this.connections = this.connections.filter((c) => c !== socket)
    })

    socket.on("error", (err) => {
      console.error("[ToolProxy] Socket error:", err)
    })
  }

  /**
   * Handle JSON-RPC request from runtime
   */
  private async handleRequest(socket: Socket, request: JsonRpcRequest): Promise<void> {
    try {
      if (request.method === ProxyMethod.CALL_HANDLER) {
        const params = request.params as CallHandlerParams
        if (params?.token !== this.token) {
          this.sendResponse(
            socket,
            createErrorResponse(request.id, JsonRpcErrorCode.INVALID_REQUEST, "Unauthorized")
          )
          return
        }
        const tool = this.tools.get(params.name)

        if (!tool) {
          this.sendResponse(
            socket,
            createErrorResponse(
              request.id,
              JsonRpcErrorCode.METHOD_NOT_FOUND,
              `Tool not found: ${params.name}`
            )
          )
          return
        }

        if (!tool.execute) {
          this.sendResponse(
            socket,
            createErrorResponse(
              request.id,
              JsonRpcErrorCode.INVALID_REQUEST,
              `ACP tools must define execute(): ${params.name}`
            )
          )
          return
        }

        // Execute the tool on host side (Tool.execute expects args and options)
        const result = await tool.execute(params.args, {
          toolCallId: params.toolCallId,
          messages: [],
          abortSignal: this.abortSignal,
          context: {},
        })

        // Prepare MCP CallToolResult
        // Tools can return either:
        // 1. MCP CallToolResult with { content: ContentBlock[], isError?: boolean }
        // 2. Primitive values (string, number, object) that need wrapping
        let toolResult: ToolResult
        const hasMcpContent =
          typeof result === "object" &&
          result !== null &&
          "content" in result &&
          Array.isArray(result.content)
        const parseResult = hasMcpContent ? CallToolResultSchema.safeParse(result) : undefined

        if (parseResult?.success) {
          // Already has MCP-style content array, use directly
          toolResult = parseResult.data as ToolResult
        } else {
          // Wrap primitive result in text content
          toolResult = {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
          }
        }

        this.sendResponse(socket, createResponse(request.id, toolResult))
      } else if (request.method === ProxyMethod.GET_TOOLS) {
        const params = request.params as { token?: string } | undefined
        if (params?.token !== this.token) {
          this.sendResponse(
            socket,
            createErrorResponse(request.id, JsonRpcErrorCode.INVALID_REQUEST, "Unauthorized")
          )
          return
        }
        // New handler for fetching tools via TCP
        const definitions = this.getToolDefinitions()
        this.sendResponse(socket, createResponse(request.id, definitions))
      } else {
        this.sendResponse(
          socket,
          createErrorResponse(
            request.id,
            JsonRpcErrorCode.METHOD_NOT_FOUND,
            `Unknown method: ${request.method}`
          )
        )
      }
    } catch (error) {
      this.sendResponse(
        socket,
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INTERNAL_ERROR,
          error instanceof Error ? error.message : String(error)
        )
      )
    }
  }

  /**
   * Send response to runtime
   */
  private sendResponse(socket: Socket, response: JsonRpcResponse): void {
    socket.write(`${serializeMessage(response)}\n`)
  }

  private notifyToolsChanged(): void {
    const message = serializeMessage({
      jsonrpc: "2.0",
      method: ProxyMethod.TOOLS_CHANGED,
    } as JsonRpcRequest)
    for (const socket of this.connections) socket.write(`${message}\n`)
  }

  /**
   * Stop the TCP server
   */
  stop(): void {
    for (const socket of this.connections) {
      socket.destroy()
    }
    this.connections = []

    if (this.server) {
      this.server.close()
      this.server = null
    }

    this.port = 0
    this.abortSignal = undefined
  }
}
