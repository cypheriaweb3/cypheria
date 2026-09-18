import { createAcp } from "@cypheria/ai-sdk-provider/acp"
import { createClaude } from "@cypheria/ai-sdk-provider/claude"
import { createCodex } from "@cypheria/ai-sdk-provider/codex"
import { createOpenCode } from "@cypheria/ai-sdk-provider/opencode"
import { createPi } from "@cypheria/ai-sdk-provider/pi"
import { type AgentId, isRegistryAgentId, type ThreadInputBlock } from "@cypheria/protocol"
import {
  type ChatTransport,
  convertToModelMessages,
  type InferUIMessageChunk,
  streamText,
  toUIMessageStream,
} from "ai"
import type { CodexChatFollowUp, CodexChatStart, CodexUiMessage } from "../../ipc/src/index.js"
import { ensureCypheriaClient } from "./cypheria-client.js"

export type CodexChatOptions = Omit<CodexChatStart, "chatId" | "messages" | "requestId"> & {
  agentId?: AgentId
  sectionId?: string
}

const createProvider = (
  agentId: AgentId,
  client: Awaited<ReturnType<typeof ensureCypheriaClient>>
) => {
  switch (agentId) {
    case "codex":
      return createCodex({ client })
    case "claude":
      return createClaude({ client })
    case "pi":
      return createPi({ client })
    case "opencode":
      return createOpenCode({ client })
    default:
      if (!isRegistryAgentId(agentId)) throw new Error(`Unsupported Cypheria agent: ${agentId}`)
      return createAcp({ agentId, client })
  }
}

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

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (const value of bytes) binary += String.fromCharCode(value)
  return globalThis.btoa(binary)
}

const followUpContent = async (input: CodexChatFollowUp): Promise<ThreadInputBlock[]> => {
  const content: ThreadInputBlock[] = input.text ? [{ text: input.text, type: "text" }] : []
  for (const file of input.files) {
    if (!file.url.startsWith("data:") && !file.url.startsWith("blob:")) {
      content.push({ name: file.filename ?? null, type: "resource-link", uri: file.url })
      continue
    }
    const data = file.url.startsWith("data:")
      ? (() => {
          const separator = file.url.indexOf(",")
          const metadata = file.url.slice(0, separator)
          const value = file.url.slice(separator + 1)
          return metadata.endsWith(";base64")
            ? value
            : bytesToBase64(new TextEncoder().encode(decodeURIComponent(value)))
        })()
      : bytesToBase64(new Uint8Array(await (await fetch(file.url)).arrayBuffer()))
    if (file.mediaType.startsWith("image/")) {
      content.push({ data, mimeType: file.mediaType, type: "image" })
    } else if (file.mediaType.startsWith("audio/")) {
      content.push({ data, mimeType: file.mediaType, type: "audio" })
    } else {
      content.push({
        data,
        mimeType: file.mediaType,
        name: file.filename ?? null,
        type: "embedded-resource",
        uri: `inline-base64:${file.filename ?? "attachment"}`,
      })
    }
  }
  return content
}

export class CypheriaChatTransport implements ChatTransport<CodexUiMessage> {
  #abortController: AbortController | null = null
  #threadId: string | null = null

  constructor(
    private readonly getOptions: () => CodexChatOptions,
    private readonly onThreadCreated?: (threadId: string) => void
  ) {}

  async sendMessages({
    abortSignal,
    messages,
  }: Parameters<ChatTransport<CodexUiMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<InferUIMessageChunk<CodexUiMessage>>
  > {
    const client = await ensureCypheriaClient()
    const options = this.getOptions()
    const agentId = options.agentId ?? "codex"
    this.#threadId = options.resumeThreadId ?? this.#threadId
    const controller = new AbortController()
    this.#abortController = controller
    const abort = () => controller.abort(abortSignal?.reason)
    abortSignal?.addEventListener("abort", abort, { once: true })
    if (abortSignal?.aborted) abort()
    const provider = createProvider(agentId, client)
    const result = streamText({
      abortSignal: controller.signal,
      messages: await convertToModelMessages(messages),
      model: provider(options.model, {
        cwd: options.cwd,
        onThreadCreated: (thread) => {
          this.#threadId = thread.id
          this.onThreadCreated?.(thread.id)
        },
        projectId: options.projectId,
        sectionId: options.sectionId,
        threadId: this.#threadId ?? undefined,
        threadMode: "persistent",
      }),
    })
    const stream = toUIMessageStream({ sendSources: true, stream: result.fullStream })
    return stream.pipeThrough(
      new TransformStream({
        flush: () => {
          abortSignal?.removeEventListener("abort", abort)
          if (this.#abortController === controller) this.#abortController = null
        },
        transform: (chunk, output) => output.enqueue(chunk as InferUIMessageChunk<CodexUiMessage>),
      })
    )
  }

  async reconnectToStream(): Promise<ReadableStream<InferUIMessageChunk<CodexUiMessage>> | null> {
    return null
  }

  async steer(input: CodexChatFollowUp): Promise<void> {
    const threadId = this.#threadId ?? this.getOptions().resumeThreadId
    if (!threadId) throw new Error("There is no active Cypheria thread to steer.")
    const client = await ensureCypheriaClient()
    await client.threads.steerTurn({
      clientMessageId: crypto.randomUUID(),
      content: await followUpContent(input),
      threadId,
    })
  }
}
