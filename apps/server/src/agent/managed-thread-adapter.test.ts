import type { AgentId } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { ThreadProviderCreateInput } from "../thread/provider-adapter.js"
import type { AgentManager, AgentRuntimeServerMessage } from "./agent-manager.js"
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
    const handleCodex = vi.fn(async (message: Record<string, unknown>, context: { send: (message: AgentRuntimeServerMessage) => void }) => {
      context.send({
        payload: {
          requestId: message.requestId,
          thread: { id: "01984de2-8f74-7c91-a3b2-5c5e937cf400", turns: [] },
        },
        type: "agent.codex.thread.start.response",
      } as unknown as AgentRuntimeServerMessage)
    })
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
      handleAcp: vi.fn(async (message: Record<string, unknown>, context: { send: (message: AgentRuntimeServerMessage) => void }) => {
        context.send({
          agent: "gemini",
          payload: {
            requestId: message.requestId,
            result: { agentCapabilities: {}, protocolVersion: 1 },
          },
          protocolVersion: 1,
          type: "agent.acp.initialize.response",
        } as AgentRuntimeServerMessage)
      }),
    } as unknown as AgentManager
    const adapter = new ManagedThreadAdapter(manager, "gemini")

    await expect(adapter.create(input("gemini"))).rejects.toThrow(
      "sessionCapabilities.delete"
    )
    expect(disposeSession).toHaveBeenCalledWith(input("gemini").threadId)
  })
})
