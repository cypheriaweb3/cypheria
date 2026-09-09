import type { ChatTransport, InferUIMessageChunk } from "ai"
import type {
  CodexChatEvent,
  CodexChatFollowUp,
  CodexChatStart,
  CodexUiMessage,
} from "../../ipc/src/index.js"

export type CodexChatOptions = Omit<CodexChatStart, "chatId" | "messages" | "requestId">

export const interruptActiveCodexTurns = (
  messages: readonly CodexUiMessage[],
  completedAtMs = Date.now()
): CodexUiMessage[] => {
  const completedAt = completedAtMs / 1_000
  return messages.map((message) => {
    const activeTurnIds = new Set(
      message.parts.flatMap((part) =>
        part.type === "data-codex-turn" && part.data.status === "inProgress" ? [part.data.id] : []
      )
    )
    if (!activeTurnIds.size) return message

    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type === "data-codex-turn" && activeTurnIds.has(part.data.id)) {
          return {
            ...part,
            data: {
              ...part.data,
              completedAt,
              durationMs:
                part.data.startedAt === null
                  ? null
                  : Math.max(0, Math.round((completedAt - part.data.startedAt) * 1_000)),
              status: "interrupted" as const,
            },
          }
        }
        if (part.type === "data-codex-item" && activeTurnIds.has(part.data.turnId)) {
          return {
            ...part,
            data: {
              ...part.data,
              completedAtMs,
              lifecycle: "completed" as const,
            },
          }
        }
        return part
      }),
    }
  })
}

export class CodexIpcChatTransport implements ChatTransport<CodexUiMessage> {
  #requestId: string | null = null

  constructor(
    private readonly getOptions: () => CodexChatOptions,
    private readonly onThreadCreated?: (threadId: string) => void
  ) {}

  async sendMessages({
    abortSignal,
    chatId,
    messages,
  }: Parameters<ChatTransport<CodexUiMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<InferUIMessageChunk<CodexUiMessage>>
  > {
    const api = window.cypheria?.codex
    if (!api) {
      throw new Error("Codex is only available in the Cypheria desktop app.")
    }

    const requestId = crypto.randomUUID()
    this.#requestId = requestId
    let disposeActiveRequest: (() => boolean) | null = null
    return new globalThis.ReadableStream<InferUIMessageChunk<CodexUiMessage>>({
      start: async (controller) => {
        let closed = false
        let unsubscribe: () => void = () => undefined
        const abort = () => {
          if (!dispose()) return
          void api.interruptChat(requestId)
          controller.close()
        }
        const dispose = () => {
          if (closed) return false
          closed = true
          if (this.#requestId === requestId) this.#requestId = null
          abortSignal?.removeEventListener("abort", abort)
          unsubscribe()
          disposeActiveRequest = null
          return true
        }
        const close = () => {
          if (!dispose()) return false
          controller.close()
          return true
        }
        const fail = (error: unknown) => {
          if (!dispose()) return
          controller.error(error)
        }
        const onEvent = (event: CodexChatEvent) => {
          if (event.requestId !== requestId || closed) return
          if (event.type === "chunk") {
            controller.enqueue(event.chunk as InferUIMessageChunk<CodexUiMessage>)
          } else if (event.type === "error") {
            fail(new Error(event.message))
          } else {
            const threadId = event.threadId
            if (close() && threadId) this.onThreadCreated?.(threadId)
          }
        }
        disposeActiveRequest = dispose

        try {
          const removeListener = api.onChatEvent(onEvent)
          unsubscribe = removeListener
          if (closed) removeListener()
          abortSignal?.addEventListener("abort", abort, { once: true })
          if (abortSignal?.aborted) {
            abort()
            return
          }
          await api.startChat({
            ...this.getOptions(),
            chatId,
            messages: messages as unknown as CodexChatStart["messages"],
            requestId,
          })
        } catch (error) {
          fail(error)
        }
      },
      cancel: async () => {
        if (disposeActiveRequest?.()) await api.interruptChat(requestId)
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<InferUIMessageChunk<CodexUiMessage>> | null> {
    return null
  }

  async steer(input: CodexChatFollowUp): Promise<void> {
    const api = window.cypheria?.codex
    if (!api || !this.#requestId) throw new Error("There is no active turn to steer.")
    const { steered } = await api.steerChat(this.#requestId, input)
    if (!steered) throw new Error("The active turn finished before the message could be steered.")
  }
}
