import { afterEach, describe, expect, it, vi } from "vitest"
import type { CodexChatEvent, CodexChatStart, CodexUiMessage } from "../../ipc/src/index.js"
import { CodexIpcChatTransport, interruptActiveCodexTurns } from "./codex-chat.js"

const installCodexApi = () => {
  let listener: ((event: CodexChatEvent) => void) | null = null
  const unsubscribe = vi.fn()
  const interruptChat = vi.fn(async () => ({ interrupted: true }))
  const startChat = vi.fn(async (_request: CodexChatStart) => undefined)
  const steerChat = vi.fn(async () => ({ steered: true }))
  const onChatEvent = vi.fn((next: (event: CodexChatEvent) => void) => {
    listener = next
    return unsubscribe
  })
  vi.stubGlobal("window", {
    cypheria: {
      codex: { interruptChat, onChatEvent, startChat, steerChat },
    },
  })
  return {
    emit: (event: CodexChatEvent) => listener?.(event),
    interruptChat,
    startChat,
    unsubscribe,
  }
}

const startStream = async (transport: CodexIpcChatTransport, abortSignal?: AbortSignal) => {
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
  vi.unstubAllGlobals()
})

describe("CodexIpcChatTransport", () => {
  it("releases the event and abort listeners when a request completes", async () => {
    const api = installCodexApi()
    const onThreadCreated = vi.fn()
    const abortController = new AbortController()
    const removeAbortListener = vi.spyOn(abortController.signal, "removeEventListener")
    const transport = new CodexIpcChatTransport(
      () => ({ model: "gpt-test", provider: "openai" }),
      onThreadCreated
    )
    const stream = await startStream(transport, abortController.signal)
    await vi.waitFor(() => expect(api.startChat).toHaveBeenCalledOnce())
    const requestId = api.startChat.mock.calls[0]?.[0].requestId

    api.emit({ requestId, threadId: "thread-1", type: "done" } as CodexChatEvent)

    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.unsubscribe).toHaveBeenCalledOnce()
    expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(onThreadCreated).toHaveBeenCalledWith("thread-1")
    await expect(transport.steer({ files: [], text: "late" })).rejects.toThrow(
      "There is no active turn to steer."
    )
  })

  it("cleans up and interrupts exactly once when the stream is cancelled", async () => {
    const api = installCodexApi()
    const transport = new CodexIpcChatTransport(() => ({
      model: "gpt-test",
      provider: "openai",
    }))
    const stream = await startStream(transport)
    await vi.waitFor(() => expect(api.startChat).toHaveBeenCalledOnce())
    const requestId = api.startChat.mock.calls[0]?.[0].requestId

    await stream.cancel()
    await stream.cancel()

    expect(api.unsubscribe).toHaveBeenCalledOnce()
    expect(api.interruptChat).toHaveBeenCalledOnce()
    expect(api.interruptChat).toHaveBeenCalledWith(requestId)
  })

  it("cleans up an already-aborted request without starting the chat", async () => {
    const api = installCodexApi()
    const abortController = new AbortController()
    abortController.abort()
    const transport = new CodexIpcChatTransport(() => ({
      model: "gpt-test",
      provider: "openai",
    }))
    const stream = await startStream(transport, abortController.signal)

    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.startChat).not.toHaveBeenCalled()
    expect(api.unsubscribe).toHaveBeenCalledOnce()
    expect(api.interruptChat).toHaveBeenCalledOnce()
  })

  it("reuses one transport while reading the latest options for each request", async () => {
    const api = installCodexApi()
    let model = "gpt-before-send"
    const transport = new CodexIpcChatTransport(() => ({ model, provider: "openai" }))
    model = "gpt-first-request"

    const firstStream = await startStream(transport)
    await vi.waitFor(() => expect(api.startChat).toHaveBeenCalledOnce())
    const firstRequest = api.startChat.mock.calls[0]?.[0]
    expect(firstRequest?.model).toBe("gpt-first-request")
    api.emit({
      requestId: firstRequest?.requestId,
      threadId: "thread-1",
      type: "done",
    } as CodexChatEvent)
    await expect(firstStream.getReader().read()).resolves.toEqual({ done: true, value: undefined })

    model = "gpt-second-request"
    const secondStream = await startStream(transport)
    await vi.waitFor(() => expect(api.startChat).toHaveBeenCalledTimes(2))
    const secondRequest = api.startChat.mock.calls[1]?.[0]
    expect(secondRequest?.model).toBe("gpt-second-request")
    expect(secondRequest?.requestId).not.toBe(firstRequest?.requestId)
    api.emit({
      requestId: secondRequest?.requestId,
      threadId: "thread-1",
      type: "done",
    } as CodexChatEvent)
    await expect(secondStream.getReader().read()).resolves.toEqual({ done: true, value: undefined })

    expect(api.unsubscribe).toHaveBeenCalledTimes(2)
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
