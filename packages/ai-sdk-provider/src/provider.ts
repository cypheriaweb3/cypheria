import type {
  EmbeddingModelV4,
  ImageModelV4,
  JSONObject,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
  ProviderV4,
  SharedV4ProviderMetadata,
  SharedV4Warning,
} from "@ai-sdk/provider"
import type { CypheriaApi } from "@cypheria/client"
import type { AgentId, ThreadInputBlock, ThreadTimelineItem, ThreadView } from "@cypheria/protocol"

export type CypheriaThreadMode = "persistent" | "ephemeral"

export type CypheriaAgentProviderCallSettings = {
  readonly cwd?: string
  readonly onThreadCreated?: (thread: ThreadView) => void
  readonly projectId?: string
  readonly sectionId?: string
  readonly threadId?: string
  readonly threadMode?: CypheriaThreadMode
}

export type CypheriaAgentProviderSettings = CypheriaAgentProviderCallSettings & {
  readonly agentId: AgentId
  readonly client: Pick<CypheriaApi, "on" | "threads">
}

export type CypheriaAgentProvider = ProviderV4 & {
  (modelId: string, settings?: CypheriaAgentProviderCallSettings): CypheriaAgentLanguageModel
  languageModel(
    modelId: string,
    settings?: CypheriaAgentProviderCallSettings
  ): CypheriaAgentLanguageModel
}

const emptyUsage = (): LanguageModelV4Usage => ({
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: undefined,
    total: undefined,
  },
  outputTokens: { reasoning: undefined, text: undefined, total: undefined },
})

const toJson = (value: unknown): JSONObject => {
  try {
    const json = JSON.parse(JSON.stringify(value)) as unknown
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as JSONObject)
      : { value: json as JSONObject[string] }
  } catch {
    return { value: String(value) }
  }
}

const providerMetadata = (
  agentId: AgentId,
  modelId: string,
  values: JSONObject = {}
): SharedV4ProviderMetadata => ({
  cypheria: { agentId, modelId, ...values },
})

const warningsFor = (options: LanguageModelV4CallOptions): SharedV4Warning[] => {
  const warnings: SharedV4Warning[] = []
  for (const feature of [
    "frequencyPenalty",
    "maxOutputTokens",
    "presencePenalty",
    "seed",
    "stopSequences",
    "temperature",
    "toolChoice",
    "tools",
    "topK",
    "topP",
  ] as const) {
    if (options[feature] !== undefined) {
      warnings.push({
        details: "Cypheria server-owned agents do not expose this option through Thread turns yet.",
        feature,
        type: "unsupported",
      })
    }
  }
  if (options.responseFormat?.type === "json") {
    warnings.push({
      details: "The response schema is not yet forwarded by the Cypheria Thread protocol.",
      feature: "responseFormat",
      type: "unsupported",
    })
  }
  return warnings
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (const value of bytes) binary += String.fromCharCode(value)
  return globalThis.btoa(binary)
}

const fileToBlock = async (
  part: Extract<LanguageModelV4Message, { role: "user" }>["content"][number]
): Promise<ThreadInputBlock> => {
  if (part.type === "text") return { text: part.text, type: "text" }
  const name = part.filename ?? null
  if (part.data.type === "url") {
    const url = part.data.url.toString()
    if (!url.startsWith("blob:") && !url.startsWith("data:")) {
      return { name, type: "resource-link", uri: url }
    }
    const data = bytesToBase64(new Uint8Array(await (await fetch(url)).arrayBuffer()))
    if (part.mediaType.startsWith("image/")) {
      return { data, mimeType: part.mediaType, type: "image" }
    }
    if (part.mediaType.startsWith("audio/")) {
      return { data, mimeType: part.mediaType, type: "audio" }
    }
    return {
      data,
      mimeType: part.mediaType,
      name,
      type: "embedded-resource",
      uri: `inline-base64:${part.filename ?? "attachment"}`,
    }
  }
  if (part.data.type === "text") {
    return {
      data: part.data.text,
      mimeType: part.mediaType,
      name,
      type: "embedded-resource",
      uri: `inline-text:${part.filename ?? "attachment"}`,
    }
  }
  if (part.data.type === "reference") {
    return {
      text: `[provider file reference: ${JSON.stringify(part.data.reference)}]`,
      type: "text",
    }
  }
  const data = typeof part.data.data === "string" ? part.data.data : bytesToBase64(part.data.data)
  if (part.mediaType.startsWith("image/")) return { data, mimeType: part.mediaType, type: "image" }
  if (part.mediaType.startsWith("audio/")) return { data, mimeType: part.mediaType, type: "audio" }
  return {
    data,
    mimeType: part.mediaType,
    name,
    type: "embedded-resource",
    uri: `inline-base64:${part.filename ?? "attachment"}`,
  }
}

const messageText = (message: LanguageModelV4Message): string => {
  if (message.role === "system") return message.content
  return message.content
    .flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") return [part.text]
      if (part.type === "tool-call") {
        return [`[tool call ${part.toolName} (${part.toolCallId})] ${JSON.stringify(part.input)}`]
      }
      if (part.type === "tool-result") {
        return [
          `[tool result ${part.toolName} (${part.toolCallId})] ${JSON.stringify(part.output)}`,
        ]
      }
      if (part.type === "tool-approval-response") {
        return [`[tool approval ${part.approvalId}] ${part.approved ? "approved" : "denied"}`]
      }
      return []
    })
    .join("\n")
}

const promptToBlocks = async (
  prompt: LanguageModelV4CallOptions["prompt"],
  includeHistory: boolean
): Promise<ThreadInputBlock[]> => {
  const selected = includeHistory
    ? prompt
    : (() => {
        const last = prompt.findLast((message) => message.role !== "system")
        return last ? [last] : prompt.slice(-1)
      })()
  const blocks: ThreadInputBlock[] = []
  for (const message of selected) {
    if (message.role === "user") {
      blocks.push(...(await Promise.all(message.content.map(fileToBlock))))
      continue
    }
    const text = messageText(message)
    if (text)
      blocks.push({ text: includeHistory ? `[${message.role}]\n${text}` : text, type: "text" })
  }
  return blocks.length > 0 ? blocks : [{ text: "", type: "text" }]
}

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return JSON.stringify(String(value))
  }
}

type StreamState = {
  readonly emittedToolCalls: Set<string>
  readonly emittedToolResults: Set<string>
  readonly reasoning: Map<string, string>
  readonly text: Map<string, string>
}

const deltaFor = (
  values: Map<string, string>,
  id: string,
  next: string,
  append: boolean
): string => {
  const previous = values.get(id) ?? ""
  const combined = append ? previous + next : next
  values.set(id, combined)
  return combined.startsWith(previous) ? combined.slice(previous.length) : ""
}

const timelineParts = (
  item: ThreadTimelineItem,
  state: StreamState,
  metadata: SharedV4ProviderMetadata
): LanguageModelV4StreamPart[] => {
  switch (item.type) {
    case "message": {
      if (item.role !== "assistant") return []
      const first = !state.text.has(item.itemId)
      const delta = deltaFor(state.text, item.itemId, item.text, item.operation === "append")
      return [
        ...(first
          ? [{ id: item.itemId, providerMetadata: metadata, type: "text-start" } as const]
          : []),
        ...(delta
          ? [{ delta, id: item.itemId, providerMetadata: metadata, type: "text-delta" } as const]
          : []),
      ]
    }
    case "reasoning": {
      const first = !state.reasoning.has(item.itemId)
      const delta = deltaFor(state.reasoning, item.itemId, item.text, item.operation === "append")
      return [
        ...(first
          ? [{ id: item.itemId, providerMetadata: metadata, type: "reasoning-start" } as const]
          : []),
        ...(delta
          ? [
              {
                delta,
                id: item.itemId,
                providerMetadata: metadata,
                type: "reasoning-delta",
              } as const,
            ]
          : []),
      ]
    }
    case "tool": {
      const parts: LanguageModelV4StreamPart[] = []
      if (!state.emittedToolCalls.has(item.itemId)) {
        state.emittedToolCalls.add(item.itemId)
        parts.push({
          dynamic: true,
          input: stringify(item.input),
          providerExecuted: true,
          providerMetadata: metadata,
          toolCallId: item.itemId,
          toolName: item.name,
          type: "tool-call",
        })
      }
      if (
        !state.emittedToolResults.has(item.itemId) &&
        ["cancelled", "completed", "failed"].includes(item.status)
      ) {
        state.emittedToolResults.add(item.itemId)
        parts.push({
          dynamic: true,
          isError: item.status === "failed",
          providerMetadata: metadata,
          result: JSON.parse(stringify(item.output ?? item.error ?? null)),
          toolCallId: item.itemId,
          toolName: item.name,
          type: "tool-result",
        })
      }
      return parts
    }
    case "artifact": {
      try {
        return [
          {
            data: { type: "url", url: new URL(item.uri) },
            mediaType: item.mimeType ?? "application/octet-stream",
            providerMetadata: metadata,
            type: "file",
          },
        ]
      } catch {
        return []
      }
    }
    case "error":
      return [{ error: new Error(`${item.code}: ${item.message}`), type: "error" }]
    default:
      return [
        {
          kind: `cypheria.${item.type}`,
          providerMetadata: {
            cypheria: { ...metadata.cypheria, item: toJson(item) },
          },
          type: "custom",
        },
      ]
  }
}

const endOpenParts = (state: StreamState): LanguageModelV4StreamPart[] => [
  ...Array.from(state.reasoning.keys(), (id) => ({ id, type: "reasoning-end" as const })),
  ...Array.from(state.text.keys(), (id) => ({ id, type: "text-end" as const })),
]

export class CypheriaAgentLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const
  readonly supportedUrls: Record<string, RegExp[]> = {}
  readonly provider: string
  readonly modelId: string
  readonly #settings: CypheriaAgentProviderSettings
  #persistentThreadId: string | undefined
  #turnCount = 0

  constructor(modelId: string, settings: CypheriaAgentProviderSettings) {
    this.modelId = modelId
    this.provider = `cypheria.${settings.agentId}`
    this.#settings = settings
    this.#persistentThreadId = settings.threadId
    if (settings.threadMode === "ephemeral" && settings.threadId) {
      throw new Error("threadId cannot be combined with ephemeral threadMode")
    }
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const { stream } = await this.doStream(options)
    const content: LanguageModelV4Content[] = []
    const text = new Map<string, string>()
    const reasoning = new Map<string, string>()
    let finishReason: LanguageModelV4GenerateResult["finishReason"] = {
      raw: "unknown",
      unified: "other",
    }
    let usage = emptyUsage()
    let metadata: SharedV4ProviderMetadata | undefined
    for await (const part of stream) {
      if (part.type === "text-delta") text.set(part.id, (text.get(part.id) ?? "") + part.delta)
      else if (part.type === "text-end") {
        const value = text.get(part.id)
        if (value !== undefined)
          content.push({ providerMetadata: part.providerMetadata, text: value, type: "text" })
      } else if (part.type === "reasoning-delta") {
        reasoning.set(part.id, (reasoning.get(part.id) ?? "") + part.delta)
      } else if (part.type === "reasoning-end") {
        const value = reasoning.get(part.id)
        if (value !== undefined)
          content.push({ providerMetadata: part.providerMetadata, text: value, type: "reasoning" })
      } else if (
        part.type === "tool-call" ||
        part.type === "tool-result" ||
        part.type === "custom" ||
        part.type === "file" ||
        part.type === "source" ||
        part.type === "reasoning-file" ||
        part.type === "tool-approval-request"
      ) {
        content.push(part)
      } else if (part.type === "finish") {
        finishReason = part.finishReason
        usage = part.usage
        metadata = part.providerMetadata
      } else if (part.type === "error") throw part.error
    }
    return {
      content,
      finishReason,
      providerMetadata: metadata,
      usage,
      warnings: warningsFor(options),
    }
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const settings = this.#settings
    const mode = settings.threadMode ?? "persistent"
    const includeHistory =
      mode === "ephemeral" || (!this.#persistentThreadId && this.#turnCount === 0)
    const thread = await this.#ensureThread(mode)
    const clientMessageId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `message-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const content = await promptToBlocks(options.prompt, includeHistory)
    const state: StreamState = {
      emittedToolCalls: new Set(),
      emittedToolResults: new Set(),
      reasoning: new Map(),
      text: new Map(),
    }
    let turnId: string | undefined
    let settled = false
    let started = false
    let removeAbort: () => void = () => {}
    const unsubscribers: Array<() => void> = []

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings: warningsFor(options) })
        const metadataFor = (item?: ThreadTimelineItem) =>
          providerMetadata(settings.agentId, this.modelId, {
            ...(item ? { item: toJson(item) } : {}),
            threadId: thread.id,
            ...(turnId ? { turnId } : {}),
          })
        const cleanup = async (): Promise<void> => {
          for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
          removeAbort()
          if (mode === "ephemeral")
            await settings.client.threads.delete(thread.id).catch(() => undefined)
        }
        const finish = async (raw: string, unified: "error" | "other" | "stop") => {
          if (settled) return
          settled = true
          for (const part of endOpenParts(state)) controller.enqueue(part)
          controller.enqueue({
            finishReason: { raw, unified },
            providerMetadata: metadataFor(),
            type: "finish",
            usage: emptyUsage(),
          })
          await cleanup()
          controller.close()
        }
        unsubscribers.push(
          settings.client.on("thread.timeline.appended.notification", (message) => {
            if (message.payload.threadId !== thread.id) return
            if (turnId && message.payload.row.turnId && message.payload.row.turnId !== turnId)
              return
            for (const part of timelineParts(
              message.payload.row.item,
              state,
              metadataFor(message.payload.row.item)
            )) {
              controller.enqueue(part)
            }
          }),
          settings.client.on("thread.updated.notification", (message) => {
            if (message.payload.id !== thread.id || !started) return
            if (message.payload.state === "errored") void finish("errored", "error")
            else if (!message.payload.activeTurn && message.payload.state === "idle")
              void finish("completed", "stop")
          }),
          settings.client.on("thread.deleted.notification", (message) => {
            if (message.payload.threadId !== thread.id) return
            controller.enqueue({ error: new Error("Cypheria thread was deleted"), type: "error" })
            void finish("deleted", "error")
          })
        )
        const abort = () => {
          void settings.client.threads
            .cancelTurn(thread.id, turnId)
            .catch(() => undefined)
            .finally(() => finish("cancelled", "other"))
        }
        options.abortSignal?.addEventListener("abort", abort, { once: true })
        removeAbort = () => options.abortSignal?.removeEventListener("abort", abort)
        if (options.abortSignal?.aborted) {
          abort()
          return
        }
        void settings.client.threads
          .startTurn({ clientMessageId, content, threadId: thread.id })
          .then((result) => {
            turnId = result.turnId
            started = true
            this.#turnCount += 1
            controller.enqueue({
              id: turnId,
              modelId: this.modelId,
              timestamp: new Date(),
              type: "response-metadata",
            })
            if (!result.thread.activeTurn && result.thread.state === "idle") {
              void finish("completed", "stop")
            }
          })
          .catch((error) => {
            controller.enqueue({ error, type: "error" })
            void finish("errored", "error")
          })
      },
      cancel: async () => {
        if (!settled)
          await settings.client.threads.cancelTurn(thread.id, turnId).catch(() => undefined)
        for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
        removeAbort()
        if (mode === "ephemeral")
          await settings.client.threads.delete(thread.id).catch(() => undefined)
      },
    })
    return { request: { body: { agentId: settings.agentId, threadId: thread.id } }, stream }
  }

  async #ensureThread(mode: CypheriaThreadMode): Promise<ThreadView> {
    const id = mode === "persistent" ? this.#persistentThreadId : undefined
    if (id) {
      const current = await this.#settings.client.threads.get(id)
      if (current.state === "stopped")
        return (await this.#settings.client.threads.resume(id)).thread
      return current
    }
    const created = await this.#settings.client.threads.create({
      agentId: this.#settings.agentId,
      cwd: this.#settings.cwd ?? null,
      ...(this.#settings.projectId
        ? { projectPlacement: { projectId: this.#settings.projectId } }
        : {}),
      ...(this.#settings.sectionId
        ? { sectionPlacement: { sectionId: this.#settings.sectionId } }
        : {}),
    })
    if (mode === "persistent") this.#persistentThreadId = created.thread.id
    this.#settings.onThreadCreated?.(created.thread)
    if (this.modelId && this.modelId !== "default") {
      return this.#settings.client.threads.updateConfig({
        model: this.modelId,
        threadId: created.thread.id,
      })
    }
    return created.thread
  }
}

const mergeSettings = (
  settings: CypheriaAgentProviderSettings,
  callSettings: CypheriaAgentProviderCallSettings | undefined
): CypheriaAgentProviderSettings => ({ ...settings, ...callSettings })

export const createCypheriaAgentProvider = (
  settings: CypheriaAgentProviderSettings
): CypheriaAgentProvider => {
  const languageModel = (modelId: string, callSettings?: CypheriaAgentProviderCallSettings) =>
    new CypheriaAgentLanguageModel(modelId, mergeSettings(settings, callSettings))
  return Object.assign(
    (modelId: string, callSettings?: CypheriaAgentProviderCallSettings) =>
      languageModel(modelId, callSettings),
    {
      embeddingModel: (() => {
        throw new Error("Cypheria agent providers do not support embedding models")
      }) as (modelId: string) => EmbeddingModelV4,
      imageModel: (() => {
        throw new Error("Cypheria agent providers do not support image models")
      }) as (modelId: string) => ImageModelV4,
      languageModel,
      specificationVersion: "v4" as const,
    }
  ) as CypheriaAgentProvider
}
