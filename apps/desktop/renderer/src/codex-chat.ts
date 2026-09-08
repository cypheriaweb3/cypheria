import type { ChatTransport, InferUIMessageChunk } from "ai"
import type {
  CodexChatEvent,
  CodexChatFollowUp,
  CodexChatStart,
  CodexUiMessage,
} from "../../ipc/src/index.js"

export type CodexChatOptions = Omit<CodexChatStart, "chatId" | "messages" | "requestId">

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
    return new globalThis.ReadableStream<InferUIMessageChunk<CodexUiMessage>>({
      start: async (controller) => {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          if (this.#requestId === requestId) this.#requestId = null
          unsubscribe()
          controller.close()
        }
        const onEvent = (event: CodexChatEvent) => {
          if (event.requestId !== requestId || closed) return
          if (event.type === "chunk") {
            controller.enqueue(event.chunk as InferUIMessageChunk<CodexUiMessage>)
          } else if (event.type === "error") {
            closed = true
            if (this.#requestId === requestId) this.#requestId = null
            unsubscribe()
            controller.error(new Error(event.message))
          } else {
            if (event.threadId) this.onThreadCreated?.(event.threadId)
            close()
          }
        }
        const unsubscribe = api.onChatEvent(onEvent)
        const abort = () => {
          void api.interruptChat(requestId)
          close()
        }
        abortSignal?.addEventListener("abort", abort, { once: true })

        try {
          await api.startChat({
            ...this.getOptions(),
            chatId,
            messages: messages as unknown as CodexChatStart["messages"],
            requestId,
          })
        } catch (error) {
          closed = true
          if (this.#requestId === requestId) this.#requestId = null
          unsubscribe()
          controller.error(error)
        }
      },
      cancel: async () => {
        await api.interruptChat(requestId)
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
