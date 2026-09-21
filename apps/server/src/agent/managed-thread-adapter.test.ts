import type { AgentId } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { ThreadHarnessCreateInput, ThreadHarnessEvent } from "../thread/harness-adapter.js"
import type {
  AgentManager,
  AgentMessageContext,
  AgentRuntimeServerMessage,
} from "./agent-manager.js"
import { ManagedThreadAdapter } from "./managed-thread-adapter.js"

const input = (agentId: AgentId): ThreadHarnessCreateInput => ({
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

  it("preserves Codex permission, question, and elicitation response details", async () => {
    const events: ThreadHarnessEvent[] = []
    const responses: Record<string, unknown>[] = []
    let turnContext: AgentMessageContext | undefined
    const handleCodex = vi.fn(
      async (message: Record<string, unknown>, context: AgentMessageContext) => {
        if (message.type === "agent.codex.thread.start.request") {
          context.send({
            payload: {
              requestId: message.requestId,
              thread: { id: "codex-thread-1", turns: [] },
            },
            type: "agent.codex.thread.start.response",
          } as unknown as AgentRuntimeServerMessage)
          return
        }
        if (message.type === "agent.codex.turn.start.request") {
          turnContext = context
          context.send({
            payload: {
              requestId: message.requestId,
              turn: { id: "turn-1", items: [], status: "inProgress" },
            },
            type: "agent.codex.turn.start.response",
          } as unknown as AgentRuntimeServerMessage)
          return
        }
        responses.push(message)
      }
    )
    const manager = { handleCodex } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "codex")
    const created = await adapter.create({
      ...input("codex"),
      onEvent: (event) => events.push(event),
    })
    const context = {
      agentId: "codex" as const,
      agentSessionId: created.sessionId,
      cwd: "/repo",
      threadId: input("codex").threadId,
    }
    await adapter.startTurn({
      ...context,
      clientMessageId: "message-1",
      content: [{ text: "hello", type: "text" }],
    })

    turnContext?.send({
      cwd: "/repo",
      environmentId: null,
      itemId: "item-1",
      permissions: {
        fileSystem: { read: ["/repo"], write: null },
        network: { enabled: true },
      },
      reason: "Install dependencies",
      requestId: "permission-1",
      startedAtMs: 1,
      threadId: "codex-thread-1",
      turnId: "turn-1",
      type: "agent.codex.item.permissions.request_approval.request",
    } as unknown as AgentRuntimeServerMessage)
    expect(events.at(-1)).toMatchObject({
      interaction: {
        kind: "permission",
        harness: {
          agentId: "codex",
          nativeType: "agent.codex.item.permissions.request_approval.request",
        },
      },
    })
    await adapter.respondToInteraction(context, "harness:codex:permission-1", {
      outcome: "allow_always",
      permissions: { network: { enabled: true } },
      scope: "session",
      strictAutoReview: true,
      type: "permission",
    })
    expect(responses.at(-1)).toMatchObject({
      payload: {
        permissions: { network: { enabled: true } },
        requestId: "permission-1",
        scope: "session",
        strictAutoReview: true,
      },
      type: "agent.codex.item.permissions.request_approval.response",
    })

    turnContext?.send({
      autoResolutionMs: null,
      isBlocking: true,
      itemId: "item-2",
      questions: [
        {
          header: "Database",
          id: "database",
          isOther: true,
          isSecret: false,
          options: [{ description: "Local", label: "SQLite" }],
          question: "Which database?",
        },
      ],
      requestId: "question-1",
      threadId: "codex-thread-1",
      turnId: "turn-1",
      type: "agent.codex.item.tool.request_user_input.request",
    } as unknown as AgentRuntimeServerMessage)
    expect(events.at(-1)).toMatchObject({
      interaction: { kind: "question", questions: [{ id: "database" }] },
    })
    await adapter.respondToInteraction(context, "harness:codex:question-1", {
      answers: { database: ["SQLite"] },
      type: "answers",
    })
    expect(responses.at(-1)).toMatchObject({
      payload: {
        answers: { database: { answers: ["SQLite"] } },
        requestId: "question-1",
      },
      type: "agent.codex.item.tool.request_user_input.response",
    })

    turnContext?.send({
      _meta: null,
      message: "Enter credentials",
      mode: "form",
      requestId: "elicitation-1",
      requestedSchema: { properties: {}, type: "object" },
      serverName: "example",
      threadId: "codex-thread-1",
      turnId: "turn-1",
      type: "agent.codex.mcp_server.elicitation.request.request",
    } as unknown as AgentRuntimeServerMessage)
    await adapter.respondToInteraction(context, "harness:codex:elicitation-1", {
      action: "accept",
      content: { token: "provided" },
      type: "elicitation",
    })
    expect(responses.at(-1)).toMatchObject({
      payload: {
        action: "accept",
        content: { token: "provided" },
        requestId: "elicitation-1",
      },
      type: "agent.codex.mcp_server.elicitation.request.response",
    })
  })

  it("prefers ACP v2 and accepts its baseline session surface without delete", async () => {
    const messages: Record<string, unknown>[] = []
    const events: ThreadHarnessEvent[] = []
    const manager = {
      handleAcp: vi.fn(
        async (
          message: Record<string, unknown>,
          context: { send: (message: AgentRuntimeServerMessage) => void }
        ) => {
          messages.push(message)
          if (message.type === "agent.acp.initialize.request") {
            context.send({
              agent: "gemini",
              payload: {
                requestId: message.requestId,
                result: {
                  capabilities: { session: { prompt: { image: {} } } },
                  info: { name: "test", version: "1" },
                  protocolVersion: 2,
                },
              },
              protocolVersion: 2,
              type: "agent.acp.initialize.response",
            } as AgentRuntimeServerMessage)
          } else if (message.type === "agent.acp.session.new.request") {
            context.send({
              agent: "gemini",
              payload: { requestId: message.requestId, result: { sessionId: "acp-v2-session" } },
              protocolVersion: 2,
              type: "agent.acp.session.new.response",
            } as AgentRuntimeServerMessage)
          } else if (message.type === "agent.acp.session.prompt.request") {
            context.send({
              agent: "gemini",
              payload: { requestId: message.requestId, result: null },
              protocolVersion: 2,
              type: "agent.acp.session.prompt.response",
            } as AgentRuntimeServerMessage)
            context.send({
              agent: "gemini",
              payload: {
                sessionId: "acp-v2-session",
                update: {
                  sessionUpdate: "state_update",
                  state: "idle",
                  stopReason: "end_turn",
                },
              },
              protocolVersion: 2,
              type: "agent.acp.session.update.notification",
            } as AgentRuntimeServerMessage)
          }
        }
      ),
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")

    const created = await adapter.create({
      ...input("gemini"),
      onEvent: (event) => events.push(event),
    })
    expect(created).toMatchObject({
      capabilities: { promptContent: expect.arrayContaining(["text", "image"]) },
      sessionId: "acp-v2-session",
    })
    await adapter.startTurn({
      agentId: "gemini",
      agentSessionId: created.sessionId,
      clientMessageId: "message-1",
      content: [{ text: "hello", type: "text" }],
      cwd: "/repo",
      threadId: input("gemini").threadId,
    })
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocolVersion: 2, type: "agent.acp.initialize.request" }),
        expect.objectContaining({ protocolVersion: 2, type: "agent.acp.session.new.request" }),
        expect.objectContaining({ protocolVersion: 2, type: "agent.acp.session.prompt.request" }),
      ])
    )
    expect(events).toContainEqual({ turnId: "active", type: "turn-completed" })
  })

  it("retries initialization on a fresh v1 runtime for a misreported v2 response", async () => {
    const messages: Record<string, unknown>[] = []
    const disposeSession = vi.fn(async () => undefined)
    const manager = {
      disposeSession,
      handleAcp: vi.fn(
        async (
          message: Record<string, unknown>,
          context: { send: (message: AgentRuntimeServerMessage) => void }
        ) => {
          messages.push(message)
          if (message.type === "agent.acp.initialize.request") {
            if (message.protocolVersion === 2) {
              context.send({
                agent: "gemini",
                payload: {
                  error: {
                    code: -32_099,
                    message:
                      "ACP agent returned v1 initialize fields while claiming protocol version 2",
                  },
                  requestId: message.requestId,
                },
                protocolVersion: 2,
                type: "agent.acp.initialize.response",
              } as AgentRuntimeServerMessage)
              return
            }
            context.send({
              agent: "gemini",
              payload: {
                requestId: message.requestId,
                result: {
                  agentCapabilities: { sessionCapabilities: {} },
                  agentInfo: { name: "v1-agent", version: "1" },
                  protocolVersion: 1,
                },
              },
              protocolVersion: 1,
              type: "agent.acp.initialize.response",
            } as AgentRuntimeServerMessage)
          } else if (message.type === "agent.acp.session.new.request") {
            context.send({
              agent: "gemini",
              payload: { requestId: message.requestId, result: { sessionId: "fallback-session" } },
              protocolVersion: 1,
              type: "agent.acp.session.new.response",
            } as AgentRuntimeServerMessage)
          }
        }
      ),
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")

    await expect(adapter.create(input("gemini"))).resolves.toMatchObject({
      sessionId: "fallback-session",
    })
    expect(disposeSession).toHaveBeenCalledTimes(1)
    expect(messages.filter((message) => message.type === "agent.acp.initialize.request")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ info: expect.any(Object) }),
        protocolVersion: 2,
      }),
      expect.objectContaining({
        payload: expect.objectContaining({ clientInfo: expect.any(Object) }),
        protocolVersion: 1,
      }),
    ])
  })

  it("bridges ACP permission options with their harness option IDs", async () => {
    const events: ThreadHarnessEvent[] = []
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
        if (message.type === "agent.acp.session.set_config_option.request") {
          context.send({
            agent: "gemini",
            payload: { requestId: String(message.requestId), result: { configOptions: [] } },
            protocolVersion: 1,
            type: "agent.acp.session.set_config_option.response",
          })
          return
        }
        if (message.type === "agent.acp.session.prompt.request") {
          context.send({
            agent: "gemini",
            payload: {
              options: [
                { kind: "allow_once", name: "Allow once", optionId: "native-allow" },
                { kind: "reject_once", name: "Deny", optionId: "native-deny" },
              ],
              sessionId: "acp-session-1",
              toolCall: { title: "Run command", toolCallId: "tool-1" },
            },
            protocolVersion: 1,
            requestId: "permission-1",
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
    const manager = {
      defaultsFor: () => ({ showThoughts: true }),
      handleAcp,
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")
    const created = await adapter.create({
      ...input("gemini"),
      onEvent: (event) => events.push(event),
    })
    expect(messages[0]).toMatchObject({
      protocolVersion: 2,
      type: "agent.acp.initialize.request",
    })
    expect(messages).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          configId: "showThoughts",
          type: "boolean",
          value: true,
        }),
        protocolVersion: 1,
        type: "agent.acp.session.set_config_option.request",
      })
    )

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
        id: "harness:gemini:permission-1",
        options: expect.arrayContaining([
          expect.objectContaining({ id: "native-allow", label: "Allow once" }),
        ]),
        title: "Run command",
      },
      type: "interaction-requested",
    })
    expect(events).toContainEqual({ turnId: "message-1", type: "turn-completed" })

    await adapter.respondToInteraction(
      {
        agentId: "gemini",
        agentSessionId: created.sessionId,
        cwd: "/repo",
        threadId: input("gemini").threadId,
      },
      "harness:gemini:permission-1",
      { outcome: "allow_once", type: "permission" }
    )
    expect(messages.at(-1)).toMatchObject({
      payload: {
        requestId: "permission-1",
        result: { outcome: { optionId: "native-allow", outcome: "selected" } },
      },
      type: "agent.acp.session.request_permission.response",
    })
  })

  it("uses valid top-level Pi RPC parameters", async () => {
    const handlePi = vi.fn(
      async (message: Record<string, unknown>, context: AgentMessageContext) => {
        context.send({
          payload: { requestId: String(message.requestId) },
          type: String(message.type).replace(/\.request$/u, ".response"),
        } as AgentRuntimeServerMessage)
      }
    )
    const manager = {
      defaultsFor: () => ({ model: "anthropic/claude-test", thinkingLevel: "high" }),
      handlePi,
    } as unknown as AgentManager
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
    expect(handlePi.mock.calls.map(([message]) => message.type)).toEqual([
      "agent.pi.model.set.request",
      "agent.pi.thinking_level.set.request",
      "agent.pi.prompt.request",
    ])
    expect(handlePi.mock.calls[2]?.[0]).toMatchObject({
      message: "hello",
      type: "agent.pi.prompt.request",
    })
    expect(handlePi.mock.calls[2]?.[0]).not.toHaveProperty("payload")
  })

  it("bridges Claude canUseTool through a Thread interaction", async () => {
    const events: ThreadHarnessEvent[] = []
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
    const manager = {
      defaultsFor: () => ({
        effort: "high",
        maxThinkingTokens: 8192,
        model: "claude-test",
        permissionMode: "plan",
        thinkingMode: "enabled",
      }),
      handleClaude,
    } as unknown as AgentManager
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
    expect(handleClaude.mock.calls[0]?.[0]).toMatchObject({
      options: {
        effort: "high",
        model: "claude-test",
        permissionMode: "plan",
        thinking: { budgetTokens: 8192, type: "enabled" },
      },
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
      interaction: { id: "harness:claude:permission-1", kind: "permission" },
      type: "interaction-requested",
    })
    await adapter.respondToInteraction(
      {
        agentId: "claude",
        agentSessionId: null,
        cwd: "/repo",
        threadId: input("claude").threadId,
      },
      "harness:claude:permission-1",
      { outcome: "allow_once", type: "permission" }
    )
    await expect(permission).resolves.toMatchObject({ behavior: "allow", toolUseID: "tool-1" })
  })

  it("bridges OpenCode v2 forms and answers", async () => {
    const events: ThreadHarnessEvent[] = []
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
              data: operation === "session.create" ? { id: "opencode-session-1" } : true,
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
          created: Date.now(),
          data: {
            form: {
              fields: [
                {
                  custom: false,
                  description: "Which language?",
                  key: "language",
                  options: [
                    {
                      description: "Typed JavaScript",
                      label: "TypeScript",
                      value: "typescript",
                    },
                  ],
                  title: "Language",
                  type: "string",
                },
                {
                  custom: true,
                  description: "Which test tools?",
                  key: "tests",
                  options: [{ description: "Unit tests", label: "Vitest", value: "vitest" }],
                  title: "Tests",
                  type: "multiselect",
                },
              ],
              id: "form-1",
              sessionID: "opencode-session-1",
              title: "Project setup",
            },
          },
          id: "event-1",
          type: "form.created",
        },
        subscriptionId: "thread:01984de2-8f74-7c91-a3b2-5c5e937cf399",
      },
      type: "agent.opencode.event.notification",
    })
    expect(events.at(-1)).toMatchObject({
      interaction: { id: "harness:opencode:form-1", questions: [{}, {}] },
      type: "interaction-requested",
    })

    await adapter.respondToInteraction(
      {
        agentId: "opencode",
        agentSessionId: "opencode-session-1",
        cwd: "/repo",
        threadId: input("opencode").threadId,
      },
      "harness:opencode:form-1",
      { answers: [["typescript"], ["vitest", "playwright"]], type: "answers" }
    )
    expect(calls.at(-1)).toMatchObject({
      payload: {
        body: {
          answer: { language: "typescript", tests: ["vitest", "playwright"] },
          formID: "form-1",
          sessionID: "opencode-session-1",
        },
        operation: "session.form.reply",
      },
    })
  })
})
