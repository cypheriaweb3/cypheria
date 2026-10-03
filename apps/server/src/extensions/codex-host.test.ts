import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ThreadView } from "@cypheria/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { HiddenThreadHandler } from "../agent/codex-runtime.js"
import { CodexMcpHost } from "./codex-host.js"

describe("CodexMcpHost", () => {
  let cwd: string
  let calls: { method: string; params: Record<string, unknown> | undefined }[]
  let hidden: Map<string, HiddenThreadHandler>
  let failNext: string | null
  let threads: Record<string, Partial<ThreadView>>
  let host: CodexMcpHost
  let started: number
  let resumed: string[]

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "cypheria-extension-host-"))
    calls = []
    hidden = new Map()
    failNext = null
    threads = {}
    started = 0
    resumed = []
    const callCodex = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method === "thread/start") {
        started += 1
        return { thread: { id: `host-${started}` } }
      }
      if (method === "mcpServer/tool/call") {
        if (failNext) {
          const message = failNext
          failNext = null
          throw new Error(message)
        }
        return { content: [{ text: "ok", type: "text" }], structuredContent: { ok: true } }
      }
      if (method === "mcpServer/resource/read") {
        return {
          contents: [{ mimeType: "text/html", text: "<p>", uri: params?.uri }],
          originCallId: null,
        }
      }
      if (method === "mcpServerStatus/list") {
        const status = (name: string, pluginId: string | null) => ({
          authStatus: "unsupported",
          httpOrigin: null,
          name,
          pluginId,
          resourceTemplates: [],
          resources: [],
          runtimeStatus: null,
          serverCapabilities: { extensions: {} },
          serverInfo: {
            description: null,
            icons: null,
            name,
            title: null,
            version: "1",
            websiteUrl: null,
          },
          tools: {
            open: { _meta: { ui: { resourceUri: "ui://a" } }, inputSchema: {}, name: "open" },
          },
          toolsError: null,
        })
        return {
          data: [
            status("bits", "bits@market"),
            status("codex_apps", null),
            status("code-review", "code-review@cypheria-bundled"),
          ],
          nextCursor: null,
        }
      }
      return {}
    })
    host = new CodexMcpHost({
      agents: {
        callCodex: callCodex as never,
        hideCodexThread: async (threadId, handler) => {
          hidden.set(threadId, handler)
        },
        unhideCodexThread: async (threadId) => {
          hidden.delete(threadId)
        },
      },
      cwd,
      elicit: async () => ({ action: "accept", content: { value: 1 } }),
      thread: async (threadId) => (threads[threadId] as ThreadView | undefined) ?? null,
      resume: async (threadId) => {
        resumed.push(threadId)
        const thread = threads[threadId]
        if (thread) thread.state = "idle"
        return (thread as ThreadView | undefined) ?? null
      },
    })
  })

  afterEach(async () => {
    await rm(cwd, { force: true, recursive: true })
  })

  it("lists plugin servers without Codex Apps or bundled plugins", async () => {
    const servers = await host.listServers()
    expect(servers.map((server) => [server.name, server.pluginId])).toEqual([
      ["bits", "bits@market"],
    ])
    expect(servers[0]?.tools[0]).toMatchObject({
      _meta: { ui: { resourceUri: "ui://a" } },
      name: "open",
    })
  })

  it("calls in one hidden, read-only, ephemeral Thread that it hides", async () => {
    await host.callTool({ arguments: {}, server: "bits", session: { kind: "host" }, tool: "open" })
    await host.readResource({ server: "bits", session: { kind: "host" }, uri: "ui://a" })
    expect(calls.filter((call) => call.method === "thread/start")).toEqual([
      {
        method: "thread/start",
        params: {
          cwd,
          ephemeral: true,
          permissions: ":read-only",
          threadSource: "mcp_extension_host",
        },
      },
    ])
    expect([...hidden.keys()]).toEqual(["host-1"])
    expect(calls.find((call) => call.method === "mcpServer/tool/call")?.params).toMatchObject({
      server: "bits",
      threadId: "host-1",
      tool: "open",
    })
  })

  it("replaces the hidden Thread once after its transport closed", async () => {
    await host.callTool({ arguments: {}, server: "bits", session: { kind: "host" }, tool: "open" })
    failNext = "tool call failed for `bits`: Transport closed"
    await expect(
      host.callTool({ arguments: {}, server: "bits", session: { kind: "host" }, tool: "open" })
    ).resolves.toMatchObject({ structuredContent: { ok: true } })
    expect(started).toBe(2)
    expect([...hidden.keys()]).toEqual(["host-2"])
    expect(calls.some((call) => call.method === "thread/unsubscribe")).toBe(true)
  })

  it("calls in a Codex Thread's own session, loading it when stopped, and never the hidden one", async () => {
    threads.loaded = { agentId: "codex", agentSessionId: "codex-thread", state: "idle" }
    threads.stopped = { agentId: "codex", agentSessionId: "codex-old", state: "stopped" }
    threads.claude = { agentId: "claude", agentSessionId: "claude-1", state: "idle" }
    for (const threadId of ["loaded", "stopped", "claude"]) {
      await host.callTool({
        arguments: {},
        server: "bits",
        session: { kind: "thread", threadId },
        tool: "open",
      })
    }
    const threadIds = calls
      .filter((call) => call.method === "mcpServer/tool/call")
      .map((call) => call.params?.threadId)
    expect(threadIds).toEqual(["codex-thread", "codex-old", "host-1"])
    expect(resumed).toEqual(["stopped"])
    await expect(host.threadSession("stopped")).resolves.toBe(true)
    await expect(host.threadSession("claude")).resolves.toBe(false)
  })

  it("reloads a Codex Thread whose session went away and calls again", async () => {
    threads.loaded = { agentId: "codex", agentSessionId: "codex-thread", state: "idle" }
    failNext = "thread not found: codex-thread"
    await expect(
      host.callTool({
        arguments: {},
        server: "bits",
        session: { kind: "thread", threadId: "loaded" },
        tool: "open",
      })
    ).resolves.toMatchObject({ structuredContent: { ok: true } })
    expect(resumed).toEqual(["loaded"])
  })

  it("answers the hidden Thread's elicitations and declines everything else", async () => {
    await host.callTool({ arguments: {}, server: "bits", session: { kind: "host" }, tool: "open" })
    const handler = hidden.get("host-1")
    await expect(
      handler?.request("mcpServer/elicitation/request", {
        message: "Pick",
        mode: "form",
        requestedSchema: { properties: {}, type: "object" },
        serverName: "bits",
        threadId: "host-1",
        turnId: null,
      })
    ).resolves.toEqual({ _meta: null, action: "accept", content: { value: 1 } })
    await expect(handler?.request("item/commandExecution/requestApproval", {})).rejects.toThrow()
  })
})
