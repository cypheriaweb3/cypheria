import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import type { CodexChatEvent, CodexChatStart } from "../../ipc/src/index.js"

export type CodexChatOptions = Omit<CodexChatStart, "chatId" | "messages" | "requestId">

export class CodexIpcChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly getOptions: () => CodexChatOptions) {}

  async sendMessages({
    abortSignal,
    chatId,
    messages,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const api = window.cypheria?.codex
    if (!api) {
      throw new Error("Codex is only available in the Cypheria desktop app.")
    }

    const requestId = crypto.randomUUID()
    return new globalThis.ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          unsubscribe()
          controller.close()
        }
        const onEvent = (event: CodexChatEvent) => {
          if (event.requestId !== requestId || closed) return
          if (event.type === "chunk") {
            controller.enqueue(event.chunk as UIMessageChunk)
          } else if (event.type === "error") {
            closed = true
            unsubscribe()
            controller.error(new Error(event.message))
          } else {
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
          unsubscribe()
          controller.error(error)
        }
      },
      cancel: async () => {
        await api.interruptChat(requestId)
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
