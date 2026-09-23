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
const bundledTools = [
  tool("git_discover", "Find the local repository root and common Git directory.", {}),
  tool("git_status", "Read branch, HEAD, and changed files in a local repository.", {}),
  tool("git_branches", "List local branches and their commit IDs.", {}),
  tool(
    "git_branch_context",
    "Read the current, upstream, and default branches with ahead and behind counts.",
    {}
  ),
  tool("git_init", "Initialize a Git repository in an existing local directory.", {}),
  tool(
    "git_branch_create",
    "Create a local branch from HEAD or a start point.",
    { name: { type: "string" }, startPoint: { type: "string" } },
    ["cwd", "name"]
  ),
  tool(
    "git_checkout",
    "Switch branches, optionally stashing and restoring local changes.",
    { target: { type: "string" }, stashChanges: { type: "boolean" } },
    ["cwd", "target"]
  ),
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
  tool("git_worktrees", "List active Git worktrees and restorable Cypheria-managed worktrees.", {}),
  tool("git_worktree_create", "Create a detached Cypheria-managed worktree from a commit or ref.", {
    startPoint: { type: "string" },
  }),
  tool(
    "git_worktree_delete",
    "Delete a clean Cypheria-managed worktree after saving its HEAD for restoration.",
    {
      path: { type: "string" },
    },
    ["cwd", "path"]
  ),
  tool(
    "git_worktree_restore",
    "Restore a previously deleted Cypheria-managed worktree from its saved HEAD.",
    {
      path: { type: "string" },
    },
    ["cwd", "path"]
  ),
]
const typeFromName = (name) => `git.${name.slice(4).replaceAll("_", "-")}.request`
let catalog = {
  tools: bundledTools,
  types: new Map(bundledTools.map((entry) => [entry.name, typeFromName(entry.name)])),
}
let catalogCheckedAt = 0

const refreshCatalog = async () => {
  if (Date.now() - catalogCheckedAt < 30_000) return
  try {
    const response = await fetch(new URL("/api/v1/git/tools", serverUrl), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return
    const body = await response.json()
    if (!Array.isArray(body.tools)) return
    const descriptions = new Map(bundledTools.map((entry) => [entry.name, entry.description]))
    const tools = []
    const types = new Map()
    for (const entry of body.tools) {
      if (
        typeof entry.type !== "string" ||
        !/^git\.[a-z0-9-]+\.request$/u.test(entry.type) ||
        entry.inputSchema?.type !== "object"
      )
        return
      const name = `git_${entry.type.slice(4, -8).replaceAll("-", "_")}`
      if (types.has(name)) return
      types.set(name, entry.type)
      const requirement =
        entry.type.includes("gitlab-mr-") || entry.type.includes("github-app-")
          ? " A connected App and local Codex thread are required."
          : ""
      tools.push({
        name,
        description:
          descriptions.get(name) ||
          `Call the Cypheria Server ${entry.type} operation.${requirement}`,
        inputSchema: entry.inputSchema,
      })
    }
    if (tools.length) {
      catalog = { tools, types }
      catalogCheckedAt = Date.now()
    }
  } catch {
    // Older or temporarily unavailable Servers keep the bundled core tool list.
  }
}

const callServer = async (type, args) => {
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
        serverInfo: { name: "cypheria-app-tools", version: "0.4.0" },
      })
      return
    case "ping":
      reply(id, {})
      return
    case "tools/list":
      await refreshCatalog()
      reply(id, { tools: catalog.tools })
      return
    case "tools/call": {
      await refreshCatalog()
      const type = catalog.types.get(params?.name)
      if (!type) {
        fail(id, -32602, "Unknown Cypheria tool")
        return
      }
      try {
        const value = await callServer(type, params.arguments || {})
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
