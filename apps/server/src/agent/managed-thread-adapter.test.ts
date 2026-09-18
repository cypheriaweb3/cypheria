import type { AgentId } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { ThreadProviderCreateInput, ThreadProviderEvent } from "../thread/provider-adapter.js"
import type {
  AgentManager,
  AgentMessageContext,
  AgentRuntimeServerMessage,
} from "./agent-manager.js"
import { ManagedThreadAdapter } from "./managed-thread-adapter.js"

const input = (agentId: AgentId): ThreadProviderCreateInput => ({
  agentId,
  cwd: "/repo",
  forkedFromAgentSessionId: null,
  onEvent: () => undefined,
  threadId: "01984de2-8f74-7c91-a3b2-5c5e937cf399",
})

describe("ManagedThreadAdapter", () => {
  it("maps Codex thread/start to a server-owned Thread session", async () => {
    const handleCodex = vi.fn(
      async (
        message: Record<string, unknown>,
        context: { send: (message: AgentRuntimeServerMessage) => void }
      ) => {
        context.send({
          payload: {
            requestId: message.requestId,
            thread: { id: "01984de2-8f74-7c91-a3b2-5c5e937cf400", turns: [] },
          },
          type: "agent.codex.thread.start.response",
        } as unknown as AgentRuntimeServerMessage)
      }
    )
    const manager = {
      disposeSession: vi.fn(),
      handleCodex,
      releaseThreadAdapter: vi.fn(),
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "codex")

    await expect(adapter.create(input("codex"))).resolves.toMatchObject({
      capabilities: { fork: true },
      sessionId: "01984de2-8f74-7c91-a3b2-5c5e937cf400",
    })
    expect(handleCodex.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/repo",
      type: "agent.codex.thread.start.request",
    })
  })

  it("rejects ACP agents that cannot delete their native sessions", async () => {
    const disposeSession = vi.fn(async () => undefined)
    const manager = {
      disposeSession,
      handleAcp: vi.fn(
        async (
          message: Record<string, unknown>,
          context: { send: (message: AgentRuntimeServerMessage) => void }
        ) => {
          context.send({
            agent: "gemini",
            payload: {
              requestId: message.requestId,
              result: { agentCapabilities: {}, protocolVersion: 1 },
            },
            protocolVersion: 1,
            type: "agent.acp.initialize.response",
          } as AgentRuntimeServerMessage)
        }
      ),
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")

    await expect(adapter.create(input("gemini"))).rejects.toThrow("sessionCapabilities.delete")
    expect(disposeSession).toHaveBeenCalledWith(input("gemini").threadId)
  })

  it("bridges ACP permission options with their provider option IDs", async () => {
    const events: ThreadProviderEvent[] = []
    const messages: Record<string, unknown>[] = []
    const handleAcp = vi.fn(
      async (message: Record<string, unknown>, context: AgentMessageContext) => {
        messages.push(message)
        if (message.type === "agent.acp.initialize.request") {
          context.send({
            agent: "gemini",
            payload: {
              requestId: String(message.requestId),
              result: {
                agentCapabilities: {
                  auth: {},
                  loadSession: false,
                  mcpCapabilities: { acp: false, http: false, sse: false },
                  promptCapabilities: {
                    audio: false,
                    embeddedContext: false,
                    image: false,
                  },
                  sessionCapabilities: { delete: {} },
                },
                authMethods: [],
                protocolVersion: 1,
              },
            },
            protocolVersion: 1,
            type: "agent.acp.initialize.response",
          })
          return
        }
        if (message.type === "agent.acp.session.new.request") {
          context.send({
            agent: "gemini",
            payload: {
              requestId: String(message.requestId),
              result: { sessionId: "acp-session-1" },
            },
            protocolVersion: 1,
            type: "agent.acp.session.new.response",
          })
          return
        }
        if (message.type === "agent.acp.session.prompt.request") {
          context.send({
            agent: "gemini",
            options: [
              { kind: "allow_once", name: "Allow once", optionId: "provider-allow" },
              { kind: "reject_once", name: "Deny", optionId: "provider-deny" },
            ],
            protocolVersion: 1,
            requestId: "permission-1",
            sessionId: "acp-session-1",
            toolCall: { title: "Run command", toolCallId: "tool-1" },
            type: "agent.acp.session.request_permission.request",
          })
          context.send({
            agent: "gemini",
            payload: {
              requestId: String(message.requestId),
              result: { stopReason: "end_turn" },
            },
            protocolVersion: 1,
            type: "agent.acp.session.prompt.response",
          })
        }
      }
    )
    const manager = { handleAcp } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")
    const created = await adapter.create({
      ...input("gemini"),
      onEvent: (event) => events.push(event),
    })

    await adapter.startTurn({
      agentId: "gemini",
      agentSessionId: created.sessionId,
      clientMessageId: "message-1",
      content: [{ text: "hello", type: "text" }],
      cwd: "/repo",
      threadId: input("gemini").threadId,
    })
    expect(events.find((event) => event.type === "interaction-requested")).toMatchObject({
      interaction: {
        id: "provider:gemini:permission-1",
        options: expect.arrayContaining([
          expect.objectContaining({ id: "provider-allow", label: "Allow once" }),
        ]),
        title: "Run command",
      },
      type: "interaction-requested",
    })

    await adapter.respondToInteraction(
      {
        agentId: "gemini",
        agentSessionId: created.sessionId,
        cwd: "/repo",
        threadId: input("gemini").threadId,
      },
      "provider:gemini:permission-1",
      { outcome: "allow_once", type: "permission" }
    )
    expect(messages.at(-1)).toMatchObject({
      payload: {
        requestId: "permission-1",
        result: { outcome: { optionId: "provider-allow", outcome: "selected" } },
      },
      type: "agent.acp.session.request_permission.response",
    })
  })

  it("uses valid top-level Pi RPC parameters", async () => {
    const handlePi = vi.fn(
      async (message: Record<string, unknown>, context: AgentMessageContext) => {
        context.send({
          payload: { requestId: String(message.requestId) },
          type: "agent.pi.prompt.response",
        })
      }
    )
    const manager = { handlePi } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "pi")
    await adapter.create(input("pi"))

    await expect(
      adapter.startTurn({
        agentId: "pi",
        agentSessionId: null,
        clientMessageId: "message-1",
        content: [{ text: "hello", type: "text" }],
        cwd: "/repo",
        threadId: input("pi").threadId,
      })
    ).resolves.toEqual({ turnId: "message-1" })
    expect(handlePi.mock.calls[0]?.[0]).toMatchObject({
      message: "hello",
      type: "agent.pi.prompt.request",
    })
    expect(handlePi.mock.calls[0]?.[0]).not.toHaveProperty("payload")
  })

  it("bridges Claude canUseTool through a Thread interaction", async () => {
    const events: ThreadProviderEvent[] = []
    let context: AgentMessageContext | undefined
    const handleClaude = vi.fn(
      async (message: Record<string, unknown>, nextContext: AgentMessageContext) => {
        context = nextContext
        nextContext.send({
          payload: {
            requestId: String(message.requestId),
            result: { queryId: String(message.queryId) },
          },
          type: "agent.claude.query.start.response",
        })
      }
    )
    const manager = { handleClaude } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "claude")
    await adapter.create({ ...input("claude"), onEvent: (event) => events.push(event) })
    await adapter.startTurn({
      agentId: "claude",
      agentSessionId: null,
      clientMessageId: "message-1",
      content: [{ text: "hello", type: "text" }],
      cwd: "/repo",
      threadId: input("claude").threadId,
    })

    const controller = new AbortController()
    const permission = context?.requestClaudePermission?.({
      input: { command: "pnpm test" },
      requestId: "permission-1",
      signal: controller.signal,
      toolName: "Bash",
      toolUseID: "tool-1",
    })
    expect(events.at(-1)).toMatchObject({
      interaction: { id: "provider:claude:permission-1", kind: "permission" },
      type: "interaction-requested",
    })
    await adapter.respondToInteraction(
      {
        agentId: "claude",
        agentSessionId: null,
        cwd: "/repo",
        threadId: input("claude").threadId,
      },
      "provider:claude:permission-1",
      { outcome: "allow_once", type: "permission" }
    )
    await expect(permission).resolves.toMatchObject({ behavior: "allow", toolUseID: "tool-1" })
  })

  it("bridges all OpenCode questions and answers", async () => {
    const events: ThreadProviderEvent[] = []
    const calls: Record<string, unknown>[] = []
    let send: AgentMessageContext["send"] | undefined
    const handleOpenCode = vi.fn(
      async (message: Record<string, unknown>, context: AgentMessageContext) => {
        calls.push(message)
        if (message.type === "agent.opencode.call.request") {
          const payload = message.payload as Record<string, unknown>
          const operation = String(payload.operation)
          context.send({
            payload: {
              data: operation === "POST /session" ? { id: "opencode-session-1" } : true,
              headers: {},
              ok: true,
              status: 200,
            },
            requestId: String(message.requestId),
            type: "agent.opencode.call.response",
          })
          return
        }
        send = context.send
        context.send({
          payload: { subscriptionId: "thread:01984de2-8f74-7c91-a3b2-5c5e937cf399" },
          requestId: String(message.requestId),
          type: "agent.opencode.event.subscribe.response",
        })
      }
    )
    const manager = { handleOpenCode } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "opencode")
    await adapter.create({ ...input("opencode"), onEvent: (event) => events.push(event) })

    send?.({
      payload: {
        event: {
          properties: {
            id: "question-1",
            questions: [
              {
                custom: false,
                header: "Language",
                multiple: false,
                options: [{ description: "Typed JavaScript", label: "TypeScript" }],
                question: "Which language?",
              },
              {
                custom: true,
                header: "Tests",
                multiple: true,
                options: [{ description: "Unit tests", label: "Vitest" }],
                question: "Which test tools?",
              },
            ],
            sessionID: "opencode-session-1",
          },
          type: "question.asked",
        },
        subscriptionId: "thread:01984de2-8f74-7c91-a3b2-5c5e937cf399",
      },
      type: "agent.opencode.event.notification",
    })
    expect(events.at(-1)).toMatchObject({
      interaction: { id: "provider:opencode:question-1", questions: [{}, {}] },
      type: "interaction-requested",
    })

    await adapter.respondToInteraction(
      {
        agentId: "opencode",
        agentSessionId: "opencode-session-1",
        cwd: "/repo",
        threadId: input("opencode").threadId,
      },
      "provider:opencode:question-1",
      { answers: [["TypeScript"], ["Vitest", "Playwright"]], type: "answers" }
    )
    expect(calls.at(-1)).toMatchObject({
      payload: {
        body: { answers: [["TypeScript"], ["Vitest", "Playwright"]] },
        operation: "POST /question/question-1/reply",
      },
    })
  })
})
