// An MCP server that relays one Cypheria tool server (`--server <name>`) to the Cypheria Server.
// It runs no tool itself: the Server lists the tools and runs each call for the calling Thread.
// The bundled `cypheria-app-tools` and `code-review` plugins ship this same file, and a private
// Code Review runs it as `--server review_context` to read its pinned pull request.
import { createInterface } from "node:readline"

const serverUrl = process.env.CYPHERIA_SERVER_URL || "http://127.0.0.1:6768"
// The Server hands every Agent process a token bound to what it may act for: one Thread for a
// Claude session, or the Codex app-server, whose calls name their Thread in the turn metadata.
const token = process.env.CYPHERIA_APP_TOOLS_TOKEN
const serverIndex = process.argv.indexOf("--server")
const serverName = serverIndex === -1 ? undefined : process.argv[serverIndex + 1]
const CALL_TIMEOUT_MS = 3_600_000
const CODEX_TURN_METADATA_KEY = "x-codex-turn-metadata"
const headers = {
  "content-type": "application/json",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
}

let tools
let toolsCheckedAt = 0
const running = new Map()

const readJson = async (response) => {
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(body.error?.message || `Cypheria Server returned ${response.status}`)
  return body
}

const listTools = async () => {
  if (tools && Date.now() - toolsCheckedAt < 30_000) return tools
  const url = new URL("/api/v1/app-tools/tools", serverUrl)
  url.searchParams.set("server", serverName)
  const body = await readJson(await fetch(url, { headers, signal: AbortSignal.timeout(10_000) }))
  if (!Array.isArray(body.tools)) throw new Error("Cypheria Server returned no tool list")
  tools = body.tools
  toolsCheckedAt = Date.now()
  return tools
}

const callTool = async (name, args, meta, signal) => {
  const response = await fetch(new URL("/api/v1/app-tools/call", serverUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      server: serverName,
      name,
      arguments: args,
      ...(meta?.[CODEX_TURN_METADATA_KEY] === undefined
        ? {}
        : { codexTurnMetadata: meta[CODEX_TURN_METADATA_KEY] }),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  })
  return readJson(response)
}

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
const reply = (id, result) => send({ id, result })
const fail = (id, code, message) => send({ id, error: { code, message } })

const handle = async (request) => {
  if (!request || request.jsonrpc !== "2.0" || !request.method) return
  const { id, method, params } = request
  if (method === "notifications/cancelled") {
    running.get(params?.requestId)?.abort()
    return
  }
  if (id === undefined || id === null) return
  if (!serverName) {
    fail(id, -32603, "Start this server with --server <name>")
    return
  }
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: "0.6.0" },
      })
      return
    case "ping":
      reply(id, {})
      return
    case "tools/list":
      try {
        reply(id, { tools: await listTools() })
      } catch (error) {
        fail(id, -32603, error instanceof Error ? error.message : String(error))
      }
      return
    case "tools/call": {
      const controller = new AbortController()
      running.set(id, controller)
      try {
        const result = await callTool(
          params?.name,
          params?.arguments || {},
          params?._meta,
          controller.signal
        )
        reply(id, {
          content: result.content,
          isError: result.isError === true,
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent }),
        })
      } catch (error) {
        if (controller.signal.aborted) return
        reply(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        })
      } finally {
        running.delete(id)
      }
      return
    }
    default:
      fail(id, -32601, `Method not found: ${method}`)
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    void handle(JSON.parse(line))
  } catch {
    /* Ignore malformed transport frames. */
  }
})
