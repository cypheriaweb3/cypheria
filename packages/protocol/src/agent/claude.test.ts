import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  AGENT_CLAUDE_RPC,
  AgentClaudeClientMessageSchema,
  AgentClaudeSdkNotificationSchema,
  AgentClaudeServerMessageSchema,
  CLAUDE_AGENT_SDK_EXCLUDED_OPTION_KEYS,
  CLAUDE_AGENT_SDK_EXCLUDED_TOP_LEVEL_FUNCTIONS,
  CLAUDE_AGENT_SDK_OPTION_KEYS,
  CLAUDE_AGENT_SDK_QUERY_METHODS,
  CLAUDE_AGENT_SDK_SERIALIZABLE_OPTION_KEYS,
  CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS,
  CLAUDE_AGENT_SDK_VERSION,
  ClaudeListSessionsOptionsSchema,
  ClaudeQueryOptionsSchema,
  ClaudeResolveSettingsOptionsSchema,
  getAgentClaudeRpcDefinition,
  isClientResponseMessage,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  unwrapClaudeSdkMessage,
  wrapClaudeSdkMessage,
} from "../index.ts"

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort()

describe("agent.claude protocol", () => {
  it("pins and exhaustively classifies the installed SDK surface", () => {
    expect(CLAUDE_AGENT_SDK_VERSION).toBe("0.3.270")

    const sdkRpcMethods = Object.values(AGENT_CLAUDE_RPC)
      .filter(({ scope }) => scope === "sdk")
      .map(({ method }) => method)
    expect(
      sortedUnique([...sdkRpcMethods, ...CLAUDE_AGENT_SDK_EXCLUDED_TOP_LEVEL_FUNCTIONS])
    ).toEqual([...CLAUDE_AGENT_SDK_TOP_LEVEL_FUNCTIONS])
    expect(CLAUDE_AGENT_SDK_EXCLUDED_TOP_LEVEL_FUNCTIONS).toEqual(
      expect.arrayContaining(["createSdkMcpServer", "startup", "tool"])
    )
    expect(sdkRpcMethods).not.toContain("startup")
    expect(
      AgentClaudeClientMessageSchema.safeParse({
        requestId: "request-1",
        type: "agent.claude.warm_query.start.request",
        warmQueryId: "warm-query-1",
      }).success
    ).toBe(false)

    const queryRpcMethods = Object.values(AGENT_CLAUDE_RPC)
      .filter(({ scope }) => scope === "query")
      .map(({ method }) => method)
    expect(sortedUnique([...queryRpcMethods, "streamInput"])).toEqual([
      ...CLAUDE_AGENT_SDK_QUERY_METHODS,
    ])

    expect(
      sortedUnique([
        ...CLAUDE_AGENT_SDK_SERIALIZABLE_OPTION_KEYS,
        ...CLAUDE_AGENT_SDK_EXCLUDED_OPTION_KEYS,
      ])
    ).toEqual([...CLAUDE_AGENT_SDK_OPTION_KEYS])
  })

  it("accepts every serializable query option family and canonicalizes stdio MCP config", () => {
    const parsed = ClaudeQueryOptionsSchema.parse({
      agents: {
        reviewer: { description: "Review code", prompt: "Review carefully" },
      },
      mcpServers: {
        local: { args: ["server.mjs"], command: "node" },
        remote: { type: "http", url: "https://mcp.example.com" },
      },
      permissionMode: "plan",
      systemPrompt: { append: "Be concise", preset: "claude_code", type: "preset" },
      thinking: { type: "adaptive" },
    })

    expect(parsed.mcpServers?.local).toMatchObject({ command: "node", type: "stdio" })
    expect(ClaudeQueryOptionsSchema.safeParse({ canUseTool: "not-a-function" }).success).toBe(false)
    expect(
      ClaudeQueryOptionsSchema.safeParse({
        mcpServers: { local: { instance: {}, name: "local", type: "sdk" } },
      }).success
    ).toBe(false)
  })

  it("strictly validates session and settings operation options", () => {
    expect(
      ClaudeListSessionsOptionsSchema.parse({
        dir: "/workspace",
        includeProgrammatic: false,
        limit: 25,
        offset: 0,
      })
    ).toEqual({
      dir: "/workspace",
      includeProgrammatic: false,
      limit: 25,
      offset: 0,
    })
    expect(ClaudeListSessionsOptionsSchema.safeParse({ unknown: true }).success).toBe(false)
    expect(
      ClaudeResolveSettingsOptionsSchema.safeParse({
        cwd: "/workspace",
        settingSources: ["project", "local"],
      }).success
    ).toBe(true)
    expect(
      ClaudeResolveSettingsOptionsSchema.safeParse({ settingSources: ["enterprise"] }).success
    ).toBe(false)
  })

  it("uses paired request and response messages for SDK and Query calls", () => {
    const request = AgentClaudeClientMessageSchema.parse({
      options: { cwd: "/workspace", includePartialMessages: true },
      prompt: { text: "Inspect this repository", type: "text" },
      queryId: "query-1",
      requestId: "request-1",
      type: "agent.claude.query.start.request",
    })
    if (request.type !== "agent.claude.query.start.request") {
      throw new Error("Expected Claude query start request")
    }
    expect(getAgentClaudeRpcDefinition(request)).toMatchObject({ method: "query", scope: "sdk" })

    const response = AgentClaudeServerMessageSchema.parse({
      payload: { requestId: "request-1", result: { queryId: "query-1" } },
      type: "agent.claude.query.start.response",
    })
    expect(isClientResponseMessage(response)).toBe(true)

    expect(
      AgentClaudeServerMessageSchema.safeParse({
        payload: {
          error: { code: "query_failed", message: "failed" },
          requestId: "request-1",
          result: { queryId: "query-1" },
        },
        type: "agent.claude.query.start.response",
      }).success
    ).toBe(false)

    expect(
      AgentClaudeServerMessageSchema.parse({
        payload: { requestId: "request-2" },
        type: "agent.claude.query.model.set.response",
      })
    ).toEqual({
      payload: { requestId: "request-2" },
      type: "agent.claude.query.model.set.response",
    })
    expect(
      AgentClaudeServerMessageSchema.safeParse({
        payload: { requestId: "request-2", result: null },
        type: "agent.claude.query.model.set.response",
      }).success
    ).toBe(false)
  })

  it("represents streaming input without sending an AsyncIterable over the wire", () => {
    expect(
      SessionInboundMessageSchema.parse({
        payload: {
          message: { content: "continue", role: "user" },
          parent_tool_use_id: null,
          type: "user",
        },
        queryId: "query-1",
        type: "agent.claude.query.input.notification",
      })
    ).toMatchObject({ queryId: "query-1" })

    expect(
      SessionInboundMessageSchema.parse({
        queryId: "query-1",
        type: "agent.claude.query.input.complete.notification",
      })
    ).toMatchObject({ queryId: "query-1" })
  })

  it("flattens every SDK output variant into concrete notification types", () => {
    expect(AgentClaudeSdkNotificationSchema).toBeInstanceOf(z.ZodDiscriminatedUnion)

    const assistant = { type: "assistant" } as SDKMessage
    const assistantNotification = wrapClaudeSdkMessage("query-1", assistant)
    expect(assistantNotification.type).toBe("agent.claude.assistant.notification")
    expect(unwrapClaudeSdkMessage(assistantNotification)).toEqual(assistant)

    const replay = { isReplay: true, type: "user" } as SDKMessage
    expect(wrapClaudeSdkMessage("query-1", replay).type).toBe(
      "agent.claude.user_replay.notification"
    )

    const status = { subtype: "status", type: "system" } as SDKMessage
    const statusNotification = wrapClaudeSdkMessage("query-1", status)
    expect(statusNotification.type).toBe("agent.claude.system.status.notification")
    expect(SessionOutboundMessageSchema.parse(statusNotification)).toEqual(statusNotification)
  })

  it("rejects mismatched and unknown SDK output discriminators", () => {
    expect(
      AgentClaudeSdkNotificationSchema.safeParse({
        payload: { subtype: "compact_boundary", type: "system" },
        queryId: "query-1",
        type: "agent.claude.system.status.notification",
      }).success
    ).toBe(false)

    expect(() =>
      wrapClaudeSdkMessage("query-1", {
        subtype: "future_message",
        type: "system",
      } as unknown as SDKMessage)
    ).toThrow("Unsupported Claude Agent SDK message")
  })
})
