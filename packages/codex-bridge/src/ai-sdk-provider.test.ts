import type { LanguageModelV4, ProviderV4 } from "@ai-sdk/provider"
import { describe, expect, it, vi } from "vitest"

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
        itemsBackwardsCursor: null,
        model: "gpt-5.2-codex",
        modelProvider: "openai",
        reasoningEffort: "medium",
        sandbox: { type: "dangerFullAccess" },
        serviceTier: null,
        thread: thread("thread-resumed"),
        turnsBackwardsCursor: null,
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
  historyMode: "legacy",
  id,
  modelProvider: "openai",
  name: null,
  parentThreadId: null,
  path: null,
  preview: "",
  projectId: null,
  recencyAt: null,
  section: null,
  sectionEnteredAt: null,
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
    const provider = createCodexAppServerProvider({
      bridge,
      cwd: "/tmp/project",
      modelProvider: "ollama",
    })
    const v4Provider: ProviderV4 = provider
    const model: LanguageModelV4 = v4Provider.languageModel("gpt-5.2-codex")
    expect(provider.specificationVersion).toBe("v4")
    expect(model.specificationVersion).toBe("v4")

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
      modelProvider: "ollama",
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

  it.each([
    "persistent",
    "stateless",
  ] as const)("converts tagged V4 files in %s mode", async (threadMode) => {
    const bridge = new FakeBridge()
    const { stream } = await createCodexAppServerProvider({ bridge, threadMode })("test").doStream({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "text/plain",
              data: { type: "text", text: "Read this document" },
            },
            { type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } },
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "data", data: new Uint8Array([1, 2, 3]) },
            },
            {
              type: "file",
              mediaType: "image",
              data: { type: "url", url: new URL("https://example.com/image.png") },
            },
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "url", url: new URL("file:///tmp/my%20image.png") },
            },
          ],
        },
      ],
    })
    expect(bridge.requests[1]?.params).toMatchObject({
      input: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Read this document"),
        }),
        { type: "image", url: "data:image/png;base64,AQID" },
        { type: "image", url: "data:image/png;base64,AQID" },
        { type: "image", url: "https://example.com/image.png" },
        { type: "localImage", path: "/tmp/my image.png" },
      ],
    })
    expect((await stream.getReader().read()).value).toEqual({ type: "stream-start", warnings: [] })
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })
  })

  it("warns for unsupported references, media, and ambiguous inline image types", async () => {
    const bridge = new FakeBridge()
    const { stream } = await createCodexAppServerProvider({ bridge })("test").doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe" },
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "reference", reference: { openai: "file-1" } },
            },
            { type: "file", mediaType: "application/pdf", data: { type: "data", data: "AQID" } },
            { type: "file", mediaType: "image", data: { type: "data", data: "AQID" } },
          ],
        },
      ],
    })
    expect(bridge.requests[1]?.params).toMatchObject({
      input: [{ type: "text", text: "Describe", text_elements: [] }],
    })
    expect((await stream.getReader().read()).value).toMatchObject({
      type: "stream-start",
      warnings: [
        { type: "unsupported", feature: "file.data.reference" },
        { type: "other", message: expect.stringContaining("application/pdf") },
        { type: "unsupported", feature: "file.mediaType" },
      ],
    })
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })
  })

  it.each([
    ["none", undefined, "none"],
    ["minimal", undefined, "minimal"],
    ["high", undefined, "high"],
    ["provider-default", undefined, undefined],
    ["low", "xhigh", "xhigh"],
  ] as const)("maps reasoning %s with Codex override %s", async (reasoning, reasoningEffort, expected) => {
    const bridge = new FakeBridge()
    await createCodexAppServerProvider({ bridge, reasoningEffort })("test").doStream({
      reasoning,
      prompt: [{ role: "user", content: [{ type: "text", text: "Think" }] }],
    })
    expect(bridge.requests[1]?.params).toHaveProperty("effort", expected)
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })
  })

  it("converts V4 tool files and warns for unreplayable assistant content", async () => {
    const bridge = new FakeBridge()
    const { stream } = await createCodexAppServerProvider({ bridge, threadMode: "stateless" })(
      "test"
    ).doStream({
      prompt: [
        {
          role: "assistant",
          content: [
            { type: "custom", kind: "example.context" },
            {
              type: "reasoning-file",
              mediaType: "image/png",
              data: { type: "data", data: "AQID" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "read",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "Result" },
                  {
                    type: "file",
                    mediaType: "text/plain",
                    data: { type: "text", text: "Document contents" },
                  },
                  {
                    type: "file",
                    mediaType: "image/png",
                    data: { type: "url", url: new URL("https://example.com/result.png") },
                  },
                  {
                    type: "file",
                    filename: "result.png",
                    mediaType: "image/png",
                    data: { type: "data", data: "AQID" },
                  },
                  {
                    type: "file",
                    mediaType: "image/png",
                    data: { type: "reference", reference: { openai: "file-1" } },
                  },
                  { type: "custom" },
                ],
              },
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: "Continue" }] },
      ],
    })
    expect(bridge.requests[1]?.params).toMatchObject({
      input: [
        {
          type: "text",
          text: "Tool Result (read): Result\nDocument contents\n[file: https://example.com/result.png]\n[file: result.png, image/png]\n[file: image/png]\n[custom content]\n\nUser: Continue",
          text_elements: [],
        },
      ],
    })
    expect((await stream.getReader().read()).value).toMatchObject({
      type: "stream-start",
      warnings: [
        { feature: "custom" },
        { feature: "reasoning-file" },
        { feature: "tool-result.file.data" },
        { feature: "tool-result.file.reference" },
        { feature: "tool-result.custom" },
      ],
    })
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })
  })

  it("collects V4 text and reasoning output for non-streaming generation", async () => {
    const bridge = new FakeBridge()
    const result = createCodexAppServerProvider({ bridge })("test").doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Explain" }] }],
      reasoning: "medium",
    })
    await vi.waitFor(() => expect(bridge.notifications.size).toBe(1))
    bridge.emit({
      method: "item/reasoning/textDelta",
      params: {
        delta: "Thinking",
        itemId: "reason-1",
        contentIndex: 0,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })
    bridge.emit({
      method: "item/agentMessage/delta",
      params: {
        delta: "Answer",
        itemId: "text-1",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })
    bridge.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    })
    expect(await result).toMatchObject({
      content: [
        { type: "text", text: "Answer" },
        { type: "reasoning", text: "Thinking" },
      ],
      finishReason: { raw: "completed", unified: "stop" },
      warnings: [],
    })
    expect(bridge.notifications.size).toBe(0)
  })
})
