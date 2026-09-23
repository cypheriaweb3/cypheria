import { describe, expect, it, vi } from "vitest"
import type { AgentManager } from "./agent/agent-manager.js"
import { CodexAppToolClient } from "./codex-app-tool-client.js"

const connectorId = "connector_gitlab"
const tool = (action: string, link = "link-1") => ({
  _meta: {
    connector_id: connectorId,
    link_id: link,
    _codex_apps: { resource_uri: `/${connectorId}/${link}/${action}` },
  },
})

describe("CodexAppToolClient", () => {
  it("requires all actions on one account and passes the validated resource URI", async () => {
    const callCodex = vi.fn(async (method: string) => {
      if (method === "mcpServerStatus/list")
        return {
          data: [
            {
              name: "codex_apps",
              tools: {
                "gitlab.get_project": tool("get_project"),
                "gitlab.get_merge_request": tool("get_merge_request"),
              },
            },
          ],
          nextCursor: null,
        }
      if (method === "mcpServer/tool/call") return { structuredContent: { id: 42 }, content: [] }
      throw new Error(`Unexpected call: ${method}`)
    })
    const client = new CodexAppToolClient({ callCodex } as unknown as AgentManager)
    const selection = await client.select(connectorId, "gitlab", [
      "get_project",
      "get_merge_request",
    ])
    expect(selection.accountLinkId).toBe("link-1")
    expect(
      await client.call(selection, "thread-1", "gitlab", "get_project", { project_id: 42 })
    ).toEqual({ id: 42 })
    expect(callCodex).toHaveBeenCalledWith("mcpServer/tool/call", {
      threadId: "thread-1",
      server: "codex_apps",
      tool: "gitlab.get_project",
      arguments: { project_id: 42 },
      _meta: { _codex_apps: { resource_uri: `/${connectorId}/link-1/get_project` } },
    })
  })

  it("rejects mixed accounts and a link changed during the request", async () => {
    let link = "link-1"
    const callCodex = vi.fn(async (method: string) => {
      if (method === "mcpServerStatus/list")
        return {
          data: [
            {
              name: "codex_apps",
              tools: {
                "gitlab.get_project": tool("get_project", link),
                "gitlab.get_merge_request": tool("get_merge_request", "link-2"),
              },
            },
          ],
          nextCursor: null,
        }
      if (method === "mcpServer/tool/call") {
        link = "link-2"
        return { structuredContent: { id: 42 }, content: [] }
      }
      throw new Error(`Unexpected call: ${method}`)
    })
    const client = new CodexAppToolClient({ callCodex } as unknown as AgentManager)
    await expect(
      client.select(connectorId, "gitlab", ["get_project", "get_merge_request"])
    ).rejects.toThrow("all required actions")
    const selection = await client.select(connectorId, "gitlab", ["get_project"])
    await expect(
      client.call(selection, "thread-1", "gitlab", "get_project", { project_id: 42 })
    ).rejects.toThrow("changed during")
  })
})
