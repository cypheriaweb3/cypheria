import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"

const serverUrl = process.env.CYPHERIA_SERVER_URL || "http://127.0.0.1:6768"
const token = process.env.CYPHERIA_SERVER_TOKEN
const cwd = { type: "string", description: "Absolute path in the local Cypheria Server host" }
const filePaths = { type: "array", items: { type: "string" }, minItems: 1 }
const tool = (name, description, properties, required = ["cwd"]) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: { cwd, ...properties },
    required,
    additionalProperties: false,
  },
})
const tools = [
  tool("git_discover", "Find the local repository root and common Git directory.", {}),
  tool("git_status", "Read branch, HEAD, and changed files in a local repository.", {}),
  tool("git_branches", "List local branches and their commit IDs.", {}),
  tool("git_diff", "Read a staged, unstaged, or base-ref diff.", {
    staged: { type: "boolean" },
    base: { type: "string" },
    paths: filePaths,
  }),
  tool("git_stage", "Stage specified repository paths.", { paths: filePaths }, ["cwd", "paths"]),
  tool("git_unstage", "Unstage specified repository paths.", { paths: filePaths }, [
    "cwd",
    "paths",
  ]),
  tool(
    "git_commit",
    "Commit the current index with a message.",
    { message: { type: "string", minLength: 1 } },
    ["cwd", "message"]
  ),
  tool("git_push", "Push the current branch or an explicit remote and branch.", {
    remote: { type: "string" },
    branch: { type: "string" },
    setUpstream: { type: "boolean" },
    forceWithLease: { type: "boolean" },
  }),
]
const operations = new Set(tools.map((entry) => entry.name))

const callServer = async (name, args) => {
  const type = `git.${name.slice(4).replaceAll("_", "-")}.request`
  const response = await fetch(new URL("/api/v1/git/request", serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type, requestId: randomUUID(), payload: args }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error?.message || `Cypheria Server returned ${response.status}`)
  if (!body.payload?.ok) throw new Error(body.payload?.error?.message || "Git operation failed")
  return body.payload.value
}

const reply = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
const fail = (id, code, message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`)

const handle = async (request) => {
  if (!request || request.jsonrpc !== "2.0" || !request.method) return
  const { id, method, params } = request
  if (id === undefined || id === null) return
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "cypheria-app-tools", version: "0.1.0" },
      })
      return
    case "ping":
      reply(id, {})
      return
    case "tools/list":
      reply(id, { tools })
      return
    case "tools/call": {
      if (!operations.has(params?.name)) {
        fail(id, -32602, "Unknown Cypheria tool")
        return
      }
      try {
        const value = await callServer(params.name, params.arguments || {})
        reply(id, { content: [{ type: "text", text: JSON.stringify(value) }] })
      } catch (error) {
        reply(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        })
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
