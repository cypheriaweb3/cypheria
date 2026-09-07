import type {
  ImageModelV4,
  JSONValue,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
  ProviderV4,
  SharedV4ProviderOptions,
  SharedV4Warning,
} from "@ai-sdk/provider"

import type {
  ClientRequest,
  CodexClientRequestParams,
  CodexJsonValue,
  CodexServerNotificationByMethod,
  ReasoningEffort,
  ReasoningSummary,
  ServerNotification,
  v2,
} from "./index.js"

export type CodexAppServerProviderBridge = {
  request<M extends ClientRequest["method"], TResponse = CodexJsonValue>(
    method: M,
    params: CodexClientRequestParams<M>,
    options?: { readonly retryOnOverload?: boolean }
  ): Promise<TResponse>
  on(type: "notification", handler: (event: ServerNotification) => void): () => void
  onError?: (handler: (error: unknown) => void) => () => void
}

export type CodexAppServerThreadMode = "persistent" | "stateless"
export type CodexAppServerSandboxMode = v2.SandboxMode | "full-access"

export type CodexAppServerProviderSettings = {
  readonly approvalPolicy?: v2.AskForApproval
  readonly approvalsReviewer?: v2.ApprovalsReviewer
  readonly baseInstructions?: string
  readonly bridge: CodexAppServerProviderBridge
  readonly config?: Record<string, AppServerJsonValue>
  readonly cwd?: string
  readonly developerInstructions?: string
  readonly dynamicTools?: readonly v2.DynamicToolSpec[]
  readonly modelProvider?: string
  readonly onSessionCreated?: (session: CodexAppServerAiSdkSession) => void
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningSummary?: ReasoningSummary
  readonly resumeThreadId?: string
  readonly sandboxMode?: CodexAppServerSandboxMode
  readonly serviceTier?: string
  readonly threadMode?: CodexAppServerThreadMode
}

export type CodexAppServerProviderCallSettings = Omit<
  CodexAppServerProviderSettings,
  "bridge" | "onSessionCreated"
> & {
  readonly onSessionCreated?: (session: CodexAppServerAiSdkSession) => void
}

export type CodexAppServerProviderOptions = CodexAppServerProviderCallSettings

type ThreadStartResponse = v2.ThreadStartResponse
type ThreadResumeResponse = v2.ThreadResumeResponse
type TurnStartResponse = v2.TurnStartResponse
type TurnSteerResponse = v2.TurnSteerResponse
type TurnInterruptResponse = v2.TurnInterruptResponse
type ModelListResponse = v2.ModelListResponse

type AppServerJsonValue =
  | AppServerJsonValue[]
  | boolean
  | null
  | number
  | string
  | { [key: string]: AppServerJsonValue | undefined }

const providerId = "cypheria.codex"
const defaultThreadMode: CodexAppServerThreadMode = "persistent"

const emptyUsage = (): LanguageModelV4Usage => ({
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: undefined,
    total: undefined,
  },
  outputTokens: {
    reasoning: undefined,
    text: undefined,
    total: undefined,
  },
})

const usageFromTokenBreakdown = (
  usage: v2.TokenUsageBreakdown | undefined
): LanguageModelV4Usage => {
  if (!usage) return emptyUsage()
  return {
    inputTokens: {
      cacheRead: usage.cachedInputTokens,
      cacheWrite: usage.cacheWriteInputTokens,
      noCache: Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens
      ),
      total: usage.inputTokens,
    },
    outputTokens: {
      reasoning: usage.reasoningOutputTokens,
      text: Math.max(0, usage.outputTokens - usage.reasoningOutputTokens),
      total: usage.outputTokens,
    },
    raw: usage,
  }
}

const finishReasonFromStatus = (
  status: v2.TurnStatus,
  error: v2.TurnError | null
): LanguageModelV4FinishReason => {
  if (status === "completed") {
    return { raw: status, unified: "stop" }
  }

  if (status === "failed") {
    return {
      raw: error?.message ? `${status}: ${error.message}` : status,
      unified: "error",
    }
  }

  return { raw: status, unified: "other" }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAppServerJsonValue = (value: unknown): value is AppServerJsonValue => {
  if (value === null) {
    return true
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return true
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isAppServerJsonValue)
  }
  if (isObject(value)) {
    return Object.values(value).every(isAppServerJsonValue)
  }
  return false
}

const toAppServerJsonValue = (value: unknown): AppServerJsonValue => {
  if (isAppServerJsonValue(value)) {
    return value
  }
  return String(value)
}

const toAiSdkJsonValue = (value: unknown): NonNullable<JSONValue> => {
  if (value === null || value === undefined) {
    return "null"
  }
  if (isAppServerJsonValue(value)) {
    return value as NonNullable<JSONValue>
  }
  return String(value)
}

const safeJsonStringify = (value: unknown): string => {
  if (value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

const unsupportedWarnings = (options: LanguageModelV4CallOptions): SharedV4Warning[] => {
  const warnings: SharedV4Warning[] = []
  const add = (value: unknown, feature: string) => {
    if (value !== undefined) {
      warnings.push({
        details: "Codex app-server does not expose this AI SDK setting directly.",
        feature,
        type: "unsupported",
      })
    }
  }

  add(options.maxOutputTokens, "maxOutputTokens")
  add(options.temperature, "temperature")
  add(options.topP, "topP")
  add(options.topK, "topK")
  add(options.presencePenalty, "presencePenalty")
  add(options.frequencyPenalty, "frequencyPenalty")
  add(options.stopSequences?.length ? options.stopSequences : undefined, "stopSequences")
  add(options.seed, "seed")
  add(options.headers, "headers")
  add(options.tools?.length ? options.tools : undefined, "tools")
  add(options.toolChoice, "toolChoice")
  add(
    options.responseFormat?.type === "json" ? options.responseFormat.name : undefined,
    "responseFormat.name"
  )
  add(
    options.responseFormat?.type === "json" ? options.responseFormat.description : undefined,
    "responseFormat.description"
  )
  return warnings
}

const mergeSettings = (
  base: CodexAppServerProviderSettings,
  call?: CodexAppServerProviderCallSettings
): CodexAppServerProviderSettings => ({
  ...base,
  ...call,
  config: call?.config ? { ...(base.config ?? {}), ...call.config } : base.config,
})

const getProviderOptions = (
  options: SharedV4ProviderOptions | undefined
): CodexAppServerProviderCallSettings | undefined => {
  const value = options?.[providerId] ?? options?.codex
  return isObject(value) ? (value as CodexAppServerProviderCallSettings) : undefined
}

const isImageMediaType = (mediaType: string | undefined): boolean =>
  typeof mediaType === "string" &&
  (mediaType.toLowerCase() === "image" || mediaType.toLowerCase().startsWith("image/"))

const isAudioMediaType = (mediaType: string | undefined): boolean =>
  typeof mediaType === "string" &&
  (mediaType.toLowerCase() === "audio" || mediaType.toLowerCase().startsWith("audio/"))

const fileUrlToPath = (url: URL): string => {
  const path = decodeURIComponent(url.pathname)
  return url.hostname ? `//${url.hostname}${path}` : path
}

const toImageInput = (
  part: LanguageModelV4FilePart,
  warnings: SharedV4Warning[]
): v2.UserInput | undefined => {
  if (!isImageMediaType(part.mediaType)) {
    warnings.push({
      message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
      type: "other",
    })
    return undefined
  }

  const data = part.data
  if (data.type === "url") {
    if (data.url.protocol === "file:") {
      return { path: fileUrlToPath(data.url), type: "localImage" }
    }
    warnings.push({
      details: "Codex image inputs accept data URLs or local files, not remote URLs.",
      feature: "file.data.url",
      type: "unsupported",
    })
    return undefined
  }
  if (data.type !== "data") {
    warnings.push({
      type: "unsupported",
      feature: `file.data.${data.type}`,
      details: "Codex image inputs require a URL or inline image bytes.",
    })
    return undefined
  }
  if (part.mediaType === "image" || part.mediaType === "image/*") {
    warnings.push({
      type: "unsupported",
      feature: "file.mediaType",
      details: "Inline image bytes require a concrete media type such as image/png.",
    })
    return undefined
  }
  const base64 =
    typeof data.data === "string"
      ? data.data
      : btoa(Array.from(data.data, (byte) => String.fromCharCode(byte)).join(""))
  return { type: "image", url: `data:${part.mediaType};base64,${base64}` }
}

const supportedAudioMediaTypes = new Set([
  "audio/m4a",
  "audio/mp3",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wave",
  "audio/wav",
  "audio/webm",
])

const toAudioInput = (
  part: LanguageModelV4FilePart,
  warnings: SharedV4Warning[]
): v2.UserInput | undefined => {
  const data = part.data
  if (data.type === "url") {
    if (data.url.protocol === "file:") {
      return { path: fileUrlToPath(data.url), type: "localAudio" }
    }
    warnings.push({
      details: "Codex audio inputs accept data URLs or local files, not remote URLs.",
      feature: "file.data.url",
      type: "unsupported",
    })
    return undefined
  }
  if (data.type !== "data") {
    warnings.push({
      details: "Codex audio inputs require inline bytes or a local file.",
      feature: `file.data.${data.type}`,
      type: "unsupported",
    })
    return undefined
  }
  const mediaType = part.mediaType.toLowerCase()
  if (!supportedAudioMediaTypes.has(mediaType)) {
    warnings.push({
      message: `Unsupported audio mediaType "${part.mediaType}".`,
      type: "other",
    })
    return undefined
  }
  const base64 =
    typeof data.data === "string"
      ? data.data
      : btoa(Array.from(data.data, (byte) => String.fromCharCode(byte)).join(""))
  return { type: "audio", url: `data:${mediaType};base64,${base64}` }
}

const toUserInput = (
  part: LanguageModelV4FilePart,
  warnings: SharedV4Warning[]
): v2.UserInput | undefined => {
  if (isImageMediaType(part.mediaType)) return toImageInput(part, warnings)
  if (isAudioMediaType(part.mediaType)) return toAudioInput(part, warnings)
  warnings.push({
    message: `Unsupported file mediaType "${part.mediaType}"; image/* and supported audio/* are accepted.`,
    type: "other",
  })
  return undefined
}

const formatToolResultOutput = (
  output: LanguageModelV4ToolResultOutput,
  warnings: SharedV4Warning[]
): string => {
  switch (output.type) {
    case "text":
      return output.value
    case "json":
    case "error-json":
      return safeJsonStringify(output.value)
    case "execution-denied":
      return output.reason ? `Execution denied: ${output.reason}` : "Execution denied"
    case "error-text":
      return output.value
    case "content":
      return output.value
        .map((part) => {
          if (part.type === "text") {
            return part.text
          }
          if (part.type === "file") {
            if (part.data.type === "text") {
              return part.data.text
            }
            if (part.data.type === "url") {
              return `[file: ${part.data.url.href}]`
            }
            warnings.push({
              type: "unsupported",
              feature: `tool-result.file.${part.data.type}`,
              details:
                "Tool result files are represented as text placeholders, not uploaded to Codex.",
            })
            return part.filename
              ? `[file: ${part.filename}, ${part.mediaType}]`
              : `[file: ${part.mediaType}]`
          }
          warnings.push({
            type: "unsupported",
            feature: "tool-result.custom",
            details: "Codex app-server cannot replay custom tool content.",
          })
          return "[custom content]"
        })
        .join("\n")
  }
}

const systemPromptFromMessages = (prompt: LanguageModelV4Message[]): string | undefined => {
  const parts = prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
  return parts.length ? parts.join("\n\n") : undefined
}

const latestUserMessages = (prompt: LanguageModelV4Message[]): LanguageModelV4Message[] => {
  const messages: LanguageModelV4Message[] = []
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]
    if (!message) {
      continue
    }
    if (message.role !== "user") {
      if (messages.length) {
        break
      }
      continue
    }
    messages.push(message)
  }
  return messages.reverse()
}

const transcriptFromMessages = (
  prompt: LanguageModelV4Message[],
  warnings: SharedV4Warning[]
): { readonly images: LanguageModelV4FilePart[]; readonly text: string } => {
  const lines: string[] = []
  let images: LanguageModelV4FilePart[] = []

  for (const message of prompt) {
    if (message.role === "system") {
      continue
    }

    if (message.role === "user") {
      const textParts: string[] = []
      const messageImages: LanguageModelV4FilePart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          textParts.push(part.text)
        } else if (part.type === "file" && part.data.type === "text") {
          textParts.push(part.data.text)
        } else if (
          part.type === "file" &&
          (isImageMediaType(part.mediaType) || isAudioMediaType(part.mediaType))
        ) {
          messageImages.push(part)
        } else if (part.type === "file") {
          warnings.push({
            message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
            type: "other",
          })
        }
      }
      if (messageImages.length) {
        images = messageImages
      }
      const imageNote = messageImages.length
        ? `[${messageImages.length} media file(s) attached]`
        : ""
      const text = [...textParts, imageNote].filter(Boolean).join("\n")
      if (text) {
        lines.push(`User: ${text}`)
      }
      continue
    }

    if (message.role === "assistant") {
      const parts = message.content
        .map((part) => {
          if (part.type === "text") {
            return part.text
          }
          if (part.type === "reasoning") {
            return `Reasoning: ${part.text}`
          }
          if (part.type === "tool-call") {
            return `Tool Call (${part.toolName}): ${safeJsonStringify(part.input)}`
          }
          if (part.type === "tool-result") {
            return `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output, warnings)}`
          }
          if (part.type === "custom" || part.type === "reasoning-file") {
            warnings.push({
              type: "unsupported",
              feature: part.type,
              details: "Codex app-server cannot replay this assistant content.",
            })
            return ""
          }
          return part.type === "file" ? `[file: ${part.mediaType}]` : ""
        })
        .filter(Boolean)
      if (parts.length) {
        lines.push(`Assistant: ${parts.join("\n")}`)
      }
      continue
    }

    for (const part of message.content) {
      if (part.type === "tool-result") {
        lines.push(
          `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output, warnings)}`
        )
      } else {
        const decision = part.approved ? "approved" : "denied"
        const reason = part.reason ? ` (${part.reason})` : ""
        lines.push(`Tool Approval (${part.approvalId}): ${decision}${reason}`)
      }
    }
  }

  return { images, text: lines.join("\n\n") }
}

const convertPrompt = (
  prompt: LanguageModelV4Message[],
  threadMode: CodexAppServerThreadMode
): {
  readonly input: v2.UserInput[]
  readonly systemPrompt?: string
  readonly warnings: SharedV4Warning[]
} => {
  const warnings: SharedV4Warning[] = []
  const systemPrompt = systemPromptFromMessages(prompt)
  const input: v2.UserInput[] = []

  if (threadMode === "stateless") {
    const transcript = transcriptFromMessages(prompt, warnings)
    if (transcript.text.trim()) {
      input.push({ text: transcript.text, text_elements: [], type: "text" })
    }
    for (const image of transcript.images) {
      const imageInput = toUserInput(image, warnings)
      if (imageInput) {
        input.push(imageInput)
      }
    }
    return { input, systemPrompt, warnings }
  }

  for (const message of latestUserMessages(prompt)) {
    if (message.role !== "user") {
      continue
    }
    for (const part of message.content) {
      if (part.type === "text") {
        input.push({ text: part.text, text_elements: [], type: "text" })
      } else if (part.data.type === "text") {
        input.push({ text: part.data.text, text_elements: [], type: "text" })
      } else {
        const imageInput = toUserInput(part, warnings)
        if (imageInput) {
          input.push(imageInput)
        }
      }
    }
  }

  return { input, systemPrompt, warnings }
}

const buildDeveloperInstructions = (
  settings: CodexAppServerProviderSettings,
  systemPrompt?: string
): string | undefined => {
  const parts = [settings.developerInstructions, systemPrompt].filter(Boolean)
  return parts.length ? parts.join("\n\n") : undefined
}

const normalizeSandboxMode = (mode?: CodexAppServerSandboxMode): v2.SandboxMode => {
  if (mode === "full-access") {
    return "danger-full-access"
  }
  return mode ?? "workspace-write"
}

const sandboxPolicyFromMode = (mode?: CodexAppServerSandboxMode): v2.SandboxPolicy | undefined => {
  if (!mode) return undefined
  switch (normalizeSandboxMode(mode)) {
    case "danger-full-access":
      return { type: "dangerFullAccess" }
    case "read-only":
      return { networkAccess: false, type: "readOnly" }
    case "workspace-write":
      return {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        type: "workspaceWrite",
        writableRoots: [],
      }
  }
}

const threadMetadata = (threadId: string, turnId?: string, usage?: v2.ThreadTokenUsage) => ({
  [providerId]: {
    sessionId: threadId,
    threadId,
    ...(turnId ? { turnId } : {}),
    ...(usage
      ? {
          modelContextWindow: usage.modelContextWindow,
          totalUsage: usage.total,
        }
      : {}),
  },
})

const resolveToolName = (
  item: v2.ThreadItem
): { readonly dynamic: boolean; readonly toolName: string } => {
  switch (item.type) {
    case "commandExecution":
      return { dynamic: true, toolName: "command" }
    case "fileChange":
      return { dynamic: true, toolName: "fileChange" }
    case "mcpToolCall":
      return { dynamic: true, toolName: `${item.server}.${item.tool}` }
    case "dynamicToolCall":
      return {
        dynamic: true,
        toolName: item.namespace ? `${item.namespace}.${item.tool}` : item.tool,
      }
    case "webSearch":
      return { dynamic: true, toolName: "webSearch" }
    case "collabAgentToolCall":
      return { dynamic: true, toolName: `collaboration.${item.tool}` }
    case "functionCallOutput":
      return {
        dynamic: true,
        toolName: item.namespace ? `${item.namespace}.${item.name}` : item.name,
      }
    default:
      return { dynamic: false, toolName: item.type }
  }
}

const itemInput = (item: v2.ThreadItem): string => {
  switch (item.type) {
    case "commandExecution":
      return JSON.stringify({ command: item.command, cwd: item.cwd })
    case "fileChange":
      return JSON.stringify({ changes: item.changes })
    case "mcpToolCall":
    case "dynamicToolCall":
      return safeJsonStringify(item.arguments)
    case "webSearch":
      return JSON.stringify({ query: item.query })
    case "collabAgentToolCall":
      return JSON.stringify({
        model: item.model,
        prompt: item.prompt,
        reasoningEffort: item.reasoningEffort,
        receiverThreadIds: item.receiverThreadIds,
      })
    case "functionCallOutput":
      return "{}"
    default:
      return "{}"
  }
}

const itemResult = (
  item: v2.ThreadItem
): { readonly isError?: boolean; readonly result: NonNullable<JSONValue> } => {
  switch (item.type) {
    case "commandExecution":
      return {
        isError: item.status === "failed",
        result: {
          exitCode: item.exitCode,
          output: item.aggregatedOutput ?? "",
          status: item.status,
        },
      }
    case "fileChange":
      return { result: { changes: item.changes, status: item.status } }
    case "mcpToolCall":
      return {
        isError: item.status === "failed" || item.error !== null,
        result: item.result
          ? toAiSdkJsonValue(item.result)
          : toAiSdkJsonValue(item.error ?? item.status),
      }
    case "dynamicToolCall":
      return {
        isError: item.success === false,
        result: {
          contentItems: item.contentItems,
          status: item.status,
          success: item.success,
        },
      }
    case "webSearch":
      return { result: { action: item.action, query: item.query, results: item.results } }
    case "collabAgentToolCall":
      return {
        isError: item.status === "failed",
        result: { agentsStates: item.agentsStates, status: item.status },
      }
    case "functionCallOutput":
      return { result: toAiSdkJsonValue(item.output) }
    default:
      return { result: toAiSdkJsonValue(item) }
  }
}

const isToolItem = (item: v2.ThreadItem): boolean =>
  item.type === "commandExecution" ||
  item.type === "fileChange" ||
  item.type === "mcpToolCall" ||
  item.type === "dynamicToolCall" ||
  item.type === "webSearch" ||
  item.type === "collabAgentToolCall" ||
  item.type === "functionCallOutput"

const customContentFromItem = (
  item: v2.ThreadItem
): Extract<LanguageModelV4Content, { type: "custom" }> => ({
  kind: `cypheria.codex-${item.type}`,
  providerMetadata: { [providerId]: { item: toAiSdkJsonValue(item) } },
  type: "custom",
})

const sourcesFromWebSearch = (item: Extract<v2.ThreadItem, { type: "webSearch" }>) => {
  const candidates: unknown[] = [...(item.results ?? [])]
  if (item.action?.type === "openPage" && item.action.url) {
    candidates.push({ url: item.action.url })
  }
  const seen = new Set<string>()
  return candidates.flatMap(
    (candidate, index): Array<Extract<LanguageModelV4Content, { type: "source" }>> => {
      if (!isObject(candidate) || typeof candidate.url !== "string" || seen.has(candidate.url)) {
        return []
      }
      seen.add(candidate.url)
      return [
        {
          id: `${item.id}-source-${index}`,
          sourceType: "url",
          title: typeof candidate.title === "string" ? candidate.title : undefined,
          type: "source",
          url: candidate.url,
        },
      ]
    }
  )
}

const imageFileFromItem = (
  item: Extract<v2.ThreadItem, { type: "imageGeneration" }>
): Extract<LanguageModelV4Content, { type: "file" }> | undefined => {
  if (!item.result || item.failure) return undefined
  const match = /^data:(image\/[^;]+);base64,(.+)$/su.exec(item.result)
  return {
    data: { data: match?.[2] ?? item.result, type: "data" },
    mediaType: match?.[1] ?? "image/png",
    providerMetadata: {
      [providerId]: {
        itemId: item.id,
        revisedPrompt: item.revisedPrompt,
        savedPath: item.savedPath ?? null,
        transparentBackground: item.transparentBackground ?? null,
      },
    },
    type: "file",
  }
}

export class CodexAppServerAiSdkSession {
  #active = false
  #turnId: string | null = null

  constructor(
    private readonly bridge: CodexAppServerProviderBridge,
    readonly threadId: string
  ) {}

  get turnId(): string | null {
    return this.#turnId
  }

  isActive(): boolean {
    return this.#active
  }

  async injectMessage(content: string | v2.UserInput[]): Promise<void> {
    const input =
      typeof content === "string"
        ? [{ text: content, text_elements: [], type: "text" as const }]
        : content

    if (this.#active && this.#turnId) {
      const response = await this.bridge.request<"turn/steer", TurnSteerResponse>("turn/steer", {
        expectedTurnId: this.#turnId,
        input,
        threadId: this.threadId,
      })
      this.#turnId = response.turnId
      return
    }

    const response = await this.bridge.request<"turn/start", TurnStartResponse>("turn/start", {
      input,
      threadId: this.threadId,
    })
    this._setTurnId(response.turn.id)
  }

  async interrupt(): Promise<void> {
    if (!this.#active || !this.#turnId) {
      return
    }

    await this.bridge.request<"turn/interrupt", TurnInterruptResponse>("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.#turnId,
    })
    this.#active = false
  }

  _setInactive(): void {
    this.#active = false
  }

  _setTurnId(turnId: string): void {
    this.#turnId = turnId
    this.#active = true
  }
}

class CodexAppServerLanguageModel implements LanguageModelV4 {
  readonly provider = providerId
  readonly specificationVersion = "v4"
  readonly supportedUrls = {}
  #session: CodexAppServerAiSdkSession | null = null

  constructor(
    readonly modelId: string,
    private readonly settings: CodexAppServerProviderSettings
  ) {}

  getSession(): CodexAppServerAiSdkSession | null {
    return this.#session
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const { stream } = await this.doStream(options)
    const reader = stream.getReader()
    const content: LanguageModelV4Content[] = []
    const contentIndexById = new Map<string, number>()
    let finishReason: LanguageModelV4FinishReason = { raw: undefined, unified: "other" }
    let usage = emptyUsage()
    let warnings: SharedV4Warning[] = []
    let providerMetadata: LanguageModelV4GenerateResult["providerMetadata"]
    let responseId: string | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value.type === "stream-start") {
        warnings = value.warnings
      } else if (value.type === "response-metadata") {
        responseId = value.id
      } else if (value.type === "text-start") {
        contentIndexById.set(value.id, content.length)
        content.push({ text: "", type: "text" })
      } else if (value.type === "text-delta") {
        const index = contentIndexById.get(value.id)
        if (index === undefined) {
          contentIndexById.set(value.id, content.length)
          content.push({ text: value.delta, type: "text" })
        } else {
          const current = content[index]
          if (current?.type === "text") {
            content[index] = { ...current, text: `${current.text}${value.delta}` }
          }
        }
      } else if (value.type === "reasoning-start") {
        contentIndexById.set(value.id, content.length)
        content.push({ text: "", type: "reasoning" })
      } else if (value.type === "reasoning-delta") {
        const index = contentIndexById.get(value.id)
        if (index === undefined) {
          contentIndexById.set(value.id, content.length)
          content.push({ text: value.delta, type: "reasoning" })
        } else {
          const current = content[index]
          if (current?.type === "reasoning") {
            content[index] = { ...current, text: `${current.text}${value.delta}` }
          }
        }
      } else if (
        value.type === "tool-call" ||
        value.type === "tool-result" ||
        value.type === "tool-approval-request" ||
        value.type === "file" ||
        value.type === "reasoning-file" ||
        value.type === "source" ||
        value.type === "custom"
      ) {
        content.push(value)
      } else if (value.type === "finish") {
        finishReason = value.finishReason
        usage = value.usage
        providerMetadata = value.providerMetadata
      }
    }

    return {
      content: content.filter(
        (part) => (part.type !== "text" && part.type !== "reasoning") || part.text.length > 0
      ),
      finishReason,
      providerMetadata:
        providerMetadata ??
        (this.#session
          ? threadMetadata(this.#session.threadId, this.#session.turnId ?? undefined)
          : undefined),
      response: {
        id: responseId ?? this.#session?.turnId ?? undefined,
        modelId: this.modelId,
        timestamp: new Date(),
      },
      usage,
      warnings,
    }
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const callOptions = getProviderOptions(options.providerOptions)
    const settings = mergeSettings(this.settings, callOptions)
    const threadMode = settings.threadMode ?? defaultThreadMode
    const converted = convertPrompt(options.prompt, threadMode)
    const warnings = [...unsupportedWarnings(options), ...converted.warnings]
    if (options.responseFormat?.type === "json" && !options.responseFormat.schema) {
      warnings.push({
        message: "Codex structured output requires a JSON Schema; JSON mode was not constrained.",
        type: "other",
      })
    }
    if (!converted.input.length) {
      throw new Error("Codex app-server requires at least one supported user input part.")
    }

    const shouldReuseThread =
      threadMode !== "stateless" && (settings.resumeThreadId || this.#session)
    if (shouldReuseThread && converted.systemPrompt) {
      warnings.push({
        message: "System prompt is ignored when reusing an existing Codex app-server thread.",
        type: "other",
      })
    }

    const startsNewThread =
      threadMode === "stateless" || (!settings.resumeThreadId && !this.#session)
    let threadId: string
    if (startsNewThread) {
      const response = await settings.bridge.request<"thread/start", ThreadStartResponse>(
        "thread/start",
        {
          approvalPolicy: settings.approvalPolicy ?? "on-request",
          approvalsReviewer: settings.approvalsReviewer,
          baseInstructions: settings.baseInstructions,
          config: settings.config,
          cwd: settings.cwd,
          developerInstructions: buildDeveloperInstructions(settings, converted.systemPrompt),
          dynamicTools: settings.dynamicTools ? [...settings.dynamicTools] : undefined,
          model: this.modelId,
          modelProvider: settings.modelProvider,
          sandbox: normalizeSandboxMode(settings.sandboxMode),
          serviceTier: settings.serviceTier,
        },
        { retryOnOverload: true }
      )
      threadId = response.thread.id
    } else if (settings.resumeThreadId) {
      const response = await settings.bridge.request<"thread/resume", ThreadResumeResponse>(
        "thread/resume",
        {
          approvalPolicy: settings.approvalPolicy,
          approvalsReviewer: settings.approvalsReviewer,
          baseInstructions: settings.baseInstructions,
          config: settings.config,
          cwd: settings.cwd,
          developerInstructions: settings.developerInstructions,
          model: this.modelId,
          modelProvider: settings.modelProvider,
          sandbox: settings.sandboxMode ? normalizeSandboxMode(settings.sandboxMode) : undefined,
          serviceTier: settings.serviceTier,
          threadId: settings.resumeThreadId,
        },
        { retryOnOverload: true }
      )
      threadId = response.thread.id
    } else {
      threadId = this.#session?.threadId ?? ""
    }

    const session = new CodexAppServerAiSdkSession(settings.bridge, threadId)
    this.#session = session
    settings.onSessionCreated?.(session)

    const outputSchema =
      options.responseFormat?.type === "json" && options.responseFormat.schema
        ? toAppServerJsonValue(options.responseFormat.schema)
        : undefined

    const turnResponse = await settings.bridge.request<"turn/start", TurnStartResponse>(
      "turn/start",
      {
        approvalPolicy: startsNewThread
          ? (settings.approvalPolicy ?? "on-request")
          : settings.approvalPolicy,
        approvalsReviewer: settings.approvalsReviewer,
        cwd: settings.cwd,
        effort:
          settings.reasoningEffort ??
          (options.reasoning === "provider-default" ? undefined : options.reasoning),
        input: converted.input,
        model: this.modelId,
        outputSchema,
        sandboxPolicy: sandboxPolicyFromMode(
          startsNewThread ? (settings.sandboxMode ?? "workspace-write") : settings.sandboxMode
        ),
        serviceTier: settings.serviceTier,
        summary: settings.reasoningSummary,
        threadId,
      },
      { retryOnOverload: true }
    )
    const turnId = turnResponse.turn.id
    session._setTurnId(turnId)

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        const emitRaw = (notification: ServerNotification) => {
          if (options.includeRawChunks) {
            controller.enqueue({ rawValue: notification, type: "raw" })
          }
        }
        const textIds = new Set<string>()
        const reasoningIds = new Set<string>()
        const toolIds = new Map<string, { dynamic: boolean; toolName: string }>()
        const progressById = new Map<string, string>()
        let latestTokenUsage: v2.ThreadTokenUsage | undefined
        const sameTurn = (params: { readonly threadId: string; readonly turnId: string }) =>
          params.threadId === threadId && params.turnId === turnId
        let unsubscribeNotification: () => void = () => undefined
        let unsubscribeError: () => void = () => undefined
        const cleanup = () => {
          unsubscribeNotification()
          unsubscribeError()
        }
        unsubscribeNotification = settings.bridge.on("notification", (notification) => {
          emitRaw(notification)
          switch (notification.method) {
            case "item/agentMessage/delta": {
              const params =
                notification.params as CodexServerNotificationByMethod<"item/agentMessage/delta">["params"]
              if (!sameTurn(params)) {
                return
              }
              if (!textIds.has(params.itemId)) {
                textIds.add(params.itemId)
                controller.enqueue({ id: params.itemId, type: "text-start" })
              }
              controller.enqueue({ delta: params.delta, id: params.itemId, type: "text-delta" })
              break
            }
            case "item/reasoning/textDelta":
            case "item/reasoning/summaryTextDelta": {
              const params = notification.params as
                | CodexServerNotificationByMethod<"item/reasoning/textDelta">["params"]
                | CodexServerNotificationByMethod<"item/reasoning/summaryTextDelta">["params"]
              if (!sameTurn(params)) {
                return
              }
              if (!reasoningIds.has(params.itemId)) {
                reasoningIds.add(params.itemId)
                controller.enqueue({ id: params.itemId, type: "reasoning-start" })
              }
              controller.enqueue({
                delta: params.delta,
                id: params.itemId,
                type: "reasoning-delta",
              })
              break
            }
            case "item/started": {
              const params =
                notification.params as CodexServerNotificationByMethod<"item/started">["params"]
              if (!sameTurn(params) || !isToolItem(params.item)) {
                return
              }
              const tool = resolveToolName(params.item)
              toolIds.set(params.item.id, tool)
              controller.enqueue({
                dynamic: tool.dynamic,
                id: params.item.id,
                providerExecuted: true,
                toolName: tool.toolName,
                type: "tool-input-start",
              })
              controller.enqueue({
                delta: itemInput(params.item),
                id: params.item.id,
                type: "tool-input-delta",
              })
              controller.enqueue({ id: params.item.id, type: "tool-input-end" })
              controller.enqueue({
                dynamic: tool.dynamic,
                input: itemInput(params.item),
                providerExecuted: true,
                toolCallId: params.item.id,
                toolName: tool.toolName,
                type: "tool-call",
              })
              break
            }
            case "item/commandExecution/outputDelta":
            case "item/fileChange/outputDelta":
            case "item/mcpToolCall/progress": {
              const params = notification.params as
                | CodexServerNotificationByMethod<"item/commandExecution/outputDelta">["params"]
                | CodexServerNotificationByMethod<"item/fileChange/outputDelta">["params"]
                | CodexServerNotificationByMethod<"item/mcpToolCall/progress">["params"]
              if (!sameTurn(params)) return
              const tool = toolIds.get(params.itemId)
              if (!tool) return
              const delta = "delta" in params ? params.delta : params.message
              const progress = `${progressById.get(params.itemId) ?? ""}${delta}`
              progressById.set(params.itemId, progress)
              controller.enqueue({
                dynamic: tool.dynamic,
                preliminary: true,
                result: { output: progress, status: "inProgress" },
                toolCallId: params.itemId,
                toolName: tool.toolName,
                type: "tool-result",
              })
              break
            }
            case "thread/tokenUsage/updated": {
              const params =
                notification.params as CodexServerNotificationByMethod<"thread/tokenUsage/updated">["params"]
              if (!sameTurn(params)) return
              latestTokenUsage = params.tokenUsage
              break
            }
            case "error": {
              const params =
                notification.params as CodexServerNotificationByMethod<"error">["params"]
              if (!sameTurn(params) || params.willRetry) return
              controller.enqueue({ error: new Error(params.error.message), type: "error" })
              break
            }
            case "item/completed": {
              const params =
                notification.params as CodexServerNotificationByMethod<"item/completed">["params"]
              if (!sameTurn(params)) {
                return
              }
              if (params.item.type === "agentMessage") {
                if (!textIds.has(params.item.id) && params.item.text) {
                  controller.enqueue({ id: params.item.id, type: "text-start" })
                  controller.enqueue({
                    delta: params.item.text,
                    id: params.item.id,
                    type: "text-delta",
                  })
                }
                controller.enqueue({ id: params.item.id, type: "text-end" })
                return
              }
              if (params.item.type === "reasoning") {
                if (!reasoningIds.has(params.item.id)) {
                  const text = [...params.item.summary, ...params.item.content].join("\n")
                  if (text) {
                    controller.enqueue({ id: params.item.id, type: "reasoning-start" })
                    controller.enqueue({ delta: text, id: params.item.id, type: "reasoning-delta" })
                  }
                }
                controller.enqueue({ id: params.item.id, type: "reasoning-end" })
                return
              }
              if (isToolItem(params.item)) {
                const tool = resolveToolName(params.item)
                const result = itemResult(params.item)
                if (!toolIds.has(params.item.id)) {
                  controller.enqueue({
                    dynamic: tool.dynamic,
                    input: itemInput(params.item),
                    providerExecuted: true,
                    toolCallId: params.item.id,
                    toolName: tool.toolName,
                    type: "tool-call",
                  })
                }
                controller.enqueue({
                  dynamic: tool.dynamic,
                  isError: result.isError,
                  result: result.result,
                  toolCallId: params.item.id,
                  toolName: tool.toolName,
                  type: "tool-result",
                })
                if (params.item.type === "webSearch") {
                  for (const source of sourcesFromWebSearch(params.item)) {
                    controller.enqueue(source)
                  }
                }
                return
              }
              if (params.item.type === "imageGeneration") {
                const file = imageFileFromItem(params.item)
                if (file) controller.enqueue(file)
                else controller.enqueue(customContentFromItem(params.item))
                return
              }
              if (params.item.type !== "userMessage" && params.item.type !== "hookPrompt") {
                controller.enqueue(customContentFromItem(params.item))
              }
              break
            }
            case "turn/completed": {
              const params =
                notification.params as CodexServerNotificationByMethod<"turn/completed">["params"]
              if (params.threadId !== threadId || params.turn.id !== turnId) {
                return
              }
              session._setInactive()
              controller.enqueue({
                finishReason: finishReasonFromStatus(params.turn.status, params.turn.error),
                providerMetadata: threadMetadata(threadId, turnId, latestTokenUsage),
                type: "finish",
                usage: usageFromTokenBreakdown(latestTokenUsage?.last),
              })
              cleanup()
              if (threadMode === "stateless") {
                this.#session = null
              }
              controller.close()
              break
            }
          }
        })
        unsubscribeError =
          settings.bridge.onError?.((error) => {
            session._setInactive()
            controller.enqueue({ error, type: "error" })
            cleanup()
            controller.close()
          }) ?? (() => undefined)

        controller.enqueue({ type: "stream-start", warnings })
        controller.enqueue({
          id: turnId,
          modelId: this.modelId,
          timestamp: new Date(),
          type: "response-metadata",
        })

        const abort = () => {
          void session.interrupt().finally(() => {
            cleanup()
            controller.close()
          })
        }
        if (options.abortSignal?.aborted) abort()
        else options.abortSignal?.addEventListener("abort", abort, { once: true })
      },
    })

    return { stream }
  }
}

export type CodexAppServerProvider = ProviderV4 & {
  (modelId: string, settings?: CodexAppServerProviderCallSettings): LanguageModelV4
  readonly listModels: (params?: v2.ModelListParams) => Promise<ModelListResponse>
}

export const createCodexAppServerProvider = (
  settings: CodexAppServerProviderSettings
): CodexAppServerProvider => {
  const createModel = (modelId: string, callSettings?: CodexAppServerProviderCallSettings) =>
    new CodexAppServerLanguageModel(modelId, mergeSettings(settings, callSettings))

  return Object.assign(
    (modelId: string, callSettings?: CodexAppServerProviderCallSettings) =>
      createModel(modelId, callSettings),
    {
      embeddingModel: () => {
        throw new Error("Codex app-server provider does not support embedding models")
      },
      imageModel: (() => {
        throw new Error("Codex app-server provider does not support image models")
      }) as (modelId: string) => ImageModelV4,
      languageModel: createModel,
      listModels: (params?: v2.ModelListParams) =>
        settings.bridge.request<"model/list", ModelListResponse>("model/list", params ?? {}),
      specificationVersion: "v4" as const,
    }
  ) as CodexAppServerProvider
}
