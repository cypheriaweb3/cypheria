import { createConnection } from "node:net"
import { jsonSchema, tool } from "ai"
import { describe, expect, it } from "vitest"
import { ToolProxyHost } from "../src/tool-proxy/tool-proxy-host.js"
import type { JsonRpcRequest, JsonRpcResponse } from "../src/tool-proxy/types.js"

function request(port: number, message: JsonRpcRequest): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    let buffer = ""
    socket.once("connect", () => socket.write(`${JSON.stringify(message)}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, newline)) as JsonRpcResponse)
    })
    socket.once("error", reject)
  })
}

describe("ACP tool proxy", () => {
  it("authenticates requests and forwards execution identity and cancellation", async () => {
    const abortController = new AbortController()
    let executionOptions: { toolCallId: string; abortSignal?: AbortSignal } | undefined
    const host = new ToolProxyHost()
    host.registerTool(
      "lookup",
      tool({
        inputSchema: jsonSchema<{ query: string }>({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        }),
        execute: async ({ query }, options) => {
          executionOptions = options
          return { query }
        },
      })
    )
    host.setExecutionContext({ abortSignal: abortController.signal })

    const config = await host.start()
    const port = Number(config.env.find(({ name }) => name === "ACP_TOOL_PROXY_PORT")?.value)
    const token = config.env.find(({ name }) => name === "ACP_TOOL_PROXY_TOKEN")?.value

    try {
      const unauthorized = await request(port, {
        jsonrpc: "2.0",
        id: 1,
        method: "getTools",
        params: { token: "wrong" },
      })
      expect(unauthorized.error?.message).toBe("Unauthorized")

      const response = await request(port, {
        jsonrpc: "2.0",
        id: 2,
        method: "callHandler",
        params: { token, name: "lookup", args: { query: "acp" }, toolCallId: "call-7" },
      })
      expect(response.result).toEqual({ content: [{ type: "text", text: '{"query":"acp"}' }] })
      expect(executionOptions?.toolCallId).toBe("call-7")
      expect(executionOptions?.abortSignal).toBe(abortController.signal)
    } finally {
      host.stop()
    }
  })
})
