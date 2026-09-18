import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CodexUiMessage } from "../../ipc/src/index.js"

const mocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(async (messages: unknown) => messages),
  createCodex: vi.fn(),
  ensureCypheriaClient: vi.fn(),
  steerTurn: vi.fn(),
  streamText: vi.fn(),
  toUIMessageStream: vi.fn(({ stream }: { stream: ReadableStream<unknown> }) => stream),
}))

vi.mock("@cypheria/ai-sdk-provider/codex", () => ({ createCodex: mocks.createCodex }))
vi.mock("./cypheria-client.js", () => ({
  ensureCypheriaClient: mocks.ensureCypheriaClient,
}))
vi.mock("ai", () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  streamText: mocks.streamText,
  toUIMessageStream: mocks.toUIMessageStream,
}))

import { CypheriaChatTransport, interruptActiveCodexTurns } from "./codex-chat.js"

const startStream = async (transport: CypheriaChatTransport, abortSignal?: AbortSignal) => {
  const stream = await transport.sendMessages({
    abortSignal,
    chatId: "chat-1",
    messageId: undefined,
    messages: [],
    trigger: "submit-message",
  })
  return stream
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  const client = { id: "client", threads: { steerTurn: mocks.steerTurn } }
  const provider = vi.fn((model: string, settings: unknown) => ({ model, settings }))
  mocks.ensureCypheriaClient.mockResolvedValue(client)
  mocks.createCodex.mockReturnValue(provider)
  mocks.streamText.mockReturnValue({
    fullStream: new ReadableStream({ start: (controller) => controller.close() }),
  })
})

describe("CypheriaChatTransport", () => {
  it("uses the shared client provider with the latest persistent thread options", async () => {
    const onThreadCreated = vi.fn()
    let model = "gpt-before-send"
    const transport = new CypheriaChatTransport(
      () => ({
        cwd: "/repo",
        model,
        projectId: "project-1",
        provider: "openai",
        resumeThreadId: "thread-1",
        sectionId: "section-1",
      }),
      onThreadCreated
    )
    model = "gpt-after-send"
    const stream = await startStream(transport)
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    const provider = mocks.createCodex.mock.results[0]?.value
    expect(mocks.createCodex).toHaveBeenCalledWith({
      client: expect.objectContaining({ id: "client" }),
    })
    expect(provider).toHaveBeenCalledWith("gpt-after-send", {
      cwd: "/repo",
      onThreadCreated: expect.any(Function),
      projectId: "project-1",
      sectionId: "section-1",
      threadId: "thread-1",
      threadMode: "persistent",
    })
  })

  it("forwards caller aborts to the AI SDK provider stream", async () => {
    const abortController = new AbortController()
    mocks.streamText.mockReturnValue({
      fullStream: new ReadableStream({ start: () => undefined }),
    })
    const transport = new CypheriaChatTransport(() => ({
      model: "gpt-test",
      provider: "openai",
    }))
    const stream = await startStream(transport, abortController.signal)
    abortController.abort("stop")
    const options = mocks.streamText.mock.calls[0]?.[0]
    expect(options.abortSignal.aborted).toBe(true)
    await stream.cancel()
  })

  it("steers the active thread through the shared Thread protocol", async () => {
    const transport = new CypheriaChatTransport(() => ({
      model: "gpt-test",
      provider: "openai",
      resumeThreadId: "thread-1",
    }))
    await transport.steer({ files: [], text: "late" })
    expect(mocks.steerTurn).toHaveBeenCalledWith({
      clientMessageId: expect.any(String),
      content: [{ text: "late", type: "text" }],
      threadId: "thread-1",
    })
  })
})

describe("interruptActiveCodexTurns", () => {
  it("optimistically completes only the active turn and its items", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant" as const,
        parts: [
          {
            data: {
              completedAt: null,
              durationMs: null,
              error: null,
              id: "turn-1",
              itemsView: "full" as const,
              startedAt: 10,
              status: "inProgress" as const,
              threadId: "thread-1",
            },
            type: "data-codex-turn" as const,
          },
          {
            data: {
              completedAtMs: null,
              item: {
                aggregatedOutput: null,
                command: "sleep 20",
                commandActions: [],
                cwd: "/tmp",
                durationMs: null,
                exitCode: null,
                id: "item-1",
                pluginId: null,
                processId: null,
                scriptPath: null,
                source: "agent" as const,
                status: "inProgress" as const,
                type: "commandExecution" as const,
              },
              lifecycle: "started" as const,
              order: 0,
              progress: "",
              startedAtMs: 10_000,
              terminalInteractions: [],
              threadId: "thread-1",
              turnId: "turn-1",
            },
            id: "item-1",
            type: "data-codex-item" as const,
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant" as const,
        parts: [
          {
            data: {
              completedAt: 9,
              durationMs: 1_000,
              error: null,
              id: "turn-2",
              itemsView: "full" as const,
              startedAt: 8,
              status: "completed" as const,
              threadId: "thread-1",
            },
            type: "data-codex-turn" as const,
          },
        ],
      },
    ] satisfies CodexUiMessage[]

    const result = interruptActiveCodexTurns(messages, 12_500)

    expect(result[0]?.parts[0]).toMatchObject({
      data: { completedAt: 12.5, durationMs: 2_500, status: "interrupted" },
    })
    expect(result[0]?.parts[1]).toMatchObject({
      data: { completedAtMs: 12_500, lifecycle: "completed" },
    })
    expect(result[1]).toBe(messages[1])
  })
})
