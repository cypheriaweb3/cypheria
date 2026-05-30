import { describe, expect, it } from "vitest"

import type {
  CodexAppServerAiSdkSession,
  CodexAppServerProviderBridge,
  ServerNotification,
  v2,
} from "./index.js"
import { createCodexAppServerProvider } from "./index.js"

class FakeBridge implements CodexAppServerProviderBridge {
  readonly notifications = new Set<(event: ServerNotification) => void>()
  readonly requests: Array<{ readonly method: string; readonly params: unknown }> = []

  async request<M extends string, TResponse = unknown>(
    method: M,
    params: unknown
  ): Promise<TResponse> {
    this.requests.push({ method, params })

    if (method === "thread/start") {
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: "/tmp",
        instructionSources: [],
        model: "gpt-5.2-codex",
        modelProvider: "openai",
        reasoningEffort: "medium",
        sandbox: { type: "dangerFullAccess" },
        serviceTier: null,
        thread: thread("thread-1"),
      } satisfies v2.ThreadStartResponse as TResponse
    }

    if (method === "thread/resume") {
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: "/tmp",
        instructionSources: [],
        model: "gpt-5.2-codex",
        modelProvider: "openai",
        reasoningEffort: "medium",
        sandbox: { type: "dangerFullAccess" },
        serviceTier: null,
        thread: thread("thread-resumed"),
      } satisfies v2.ThreadResumeResponse as TResponse
    }

    if (method === "turn/start") {
      return { turn: turn("turn-1", "inProgress") } satisfies v2.TurnStartResponse as TResponse
    }

    if (method === "turn/steer") {
      return { turnId: "turn-1" } satisfies v2.TurnSteerResponse as TResponse
    }

    if (method === "turn/interrupt") {
      return {} satisfies v2.TurnInterruptResponse as TResponse
    }

    if (method === "model/list") {
      return { data: [], nextCursor: null } satisfies v2.ModelListResponse as TResponse
    }

    throw new Error(`Unexpected request: ${method}`)
  }

  on(type: "notification", handler: (event: ServerNotification) => void): () => void {
    expect(type).toBe("notification")
    this.notifications.add(handler)
    return () => this.notifications.delete(handler)
  }

  emit(notification: ServerNotification): void {
    for (const handler of this.notifications) {
      handler(notification)
    }
  }
}

const thread = (id: string): v2.Thread => ({
  agentNickname: null,
  agentRole: null,
  cliVersion: "test",
  createdAt: 0,
  cwd: "/tmp",
  ephemeral: false,
  forkedFromId: null,
  gitInfo: null,
  id,
  modelProvider: "openai",
  name: null,
  path: null,
  preview: "",
  sessionId: id,
  source: { custom: "appServer" },
  status: { activeFlags: [], type: "active" },
  threadSource: null,
  turns: [],
  updatedAt: 0,
})

const turn = (id: string, status: v2.TurnStatus): v2.Turn => ({
  completedAt: status === "inProgress" ? null : 1,
  durationMs: null,
  error: null,
  id,
  items: [],
  itemsView: "full",
  startedAt: 0,
  status,
})

describe("Codex app-server AI SDK provider", () => {
  it("starts a thread and turn, then streams app-server deltas as AI SDK parts", async () => {
    const bridge = new FakeBridge()
    const provider = createCodexAppServerProvider({ bridge, cwd: "/tmp/project" })
    const model = provider("gpt-5.2-codex")

    const result = await model.doStream({
      prompt: [
        { content: "You are helpful.", role: "system" },
        { content: [{ text: "Hello", type: "text" }], role: "user" },
      ],
    })

    const reader = result.stream.getReader()
    const first = await reader.read()
    const second = await reader.read()

    bridge.emit({
      method: "item/agentMessage/delta",
      params: { delta: "Hi", itemId: "item-1", threadId: "thread-1", turnId: "turn-1" },
    })
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })

    const streamed: unknown[] = [first.value, second.value]
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      streamed.push(next.value)
    }

    expect(bridge.requests.map((request) => request.method)).toEqual(["thread/start", "turn/start"])
    expect(bridge.requests[0]?.params).toMatchObject({
      cwd: "/tmp/project",
      developerInstructions: "You are helpful.",
      model: "gpt-5.2-codex",
    })
    expect(bridge.requests[1]?.params).toMatchObject({
      input: [{ text: "Hello", text_elements: [], type: "text" }],
      threadId: "thread-1",
    })
    expect(streamed).toEqual([
      { type: "stream-start", warnings: [] },
      expect.objectContaining({ id: "turn-1", type: "response-metadata" }),
      { id: "item-1", type: "text-start" },
      { delta: "Hi", id: "item-1", type: "text-delta" },
      expect.objectContaining({
        finishReason: { raw: "completed", unified: "stop" },
        type: "finish",
      }),
    ])
  })

  it("uses turn/steer for mid-execution session injection", async () => {
    const bridge = new FakeBridge()
    let session: CodexAppServerAiSdkSession | undefined
    const provider = createCodexAppServerProvider({
      bridge,
      onSessionCreated: (created) => {
        session = created
      },
    })

    const stream = await provider("gpt-5.2-codex").doStream({
      prompt: [{ content: [{ text: "Start", type: "text" }], role: "user" }],
    })
    await stream.stream.getReader().read()
    await session?.injectMessage("continue")

    expect(bridge.requests.map((request) => request.method)).toEqual([
      "thread/start",
      "turn/start",
      "turn/steer",
    ])
    expect(bridge.requests.at(-1)?.params).toMatchObject({
      expectedTurnId: "turn-1",
      input: [{ text: "continue", text_elements: [], type: "text" }],
      threadId: "thread-1",
    })
  })
})
