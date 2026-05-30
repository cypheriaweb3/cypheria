import type {
  ImageModelV3,
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FilePart,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  ProviderV3,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from "@ai-sdk/provider"

import type {
  ClientRequest,
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
    params: Extract<ClientRequest, { readonly method: M }>["params"],
    options?: { readonly retryOnOverload?: boolean }
  ): Promise<TResponse>
  on(type: "notification", handler: (event: ServerNotification) => void): () => void
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
  readonly onSessionCreated?: (session: CodexAppServerAiSdkSession) => void
  readonly reasoningEffort?: Exclude<ReasoningEffort, "none" | "minimal">
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

const emptyUsage = (): LanguageModelV3Usage => ({
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

const finishReasonFromStatus = (
  status: v2.TurnStatus,
  error: v2.TurnError | null
): LanguageModelV3FinishReason => {
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

const unsupportedWarnings = (options: LanguageModelV3CallOptions): SharedV3Warning[] => {
  const warnings: SharedV3Warning[] = []
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
  add(options.tools?.length ? options.tools : undefined, "tools")
  add(options.toolChoice, "toolChoice")
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
  options: SharedV3ProviderOptions | undefined
): CodexAppServerProviderCallSettings | undefined => {
  const value = options?.[providerId] ?? options?.codex
  return isObject(value) ? (value as CodexAppServerProviderCallSettings) : undefined
}

const isImageMediaType = (mediaType: string | undefined): boolean =>
  typeof mediaType === "string" && mediaType.toLowerCase().startsWith("image/")

const fileUrlToPath = (url: URL): string => {
  const path = decodeURIComponent(url.pathname)
  return url.hostname ? `//${url.hostname}${path}` : path
}

const toImageInput = (
  part: LanguageModelV3FilePart,
  warnings: SharedV3Warning[]
): v2.UserInput | undefined => {
  if (!isImageMediaType(part.mediaType)) {
    warnings.push({
      message: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
      type: "other",
    })
    return undefined
  }

  const data = part.data
  if (data instanceof URL) {
    if (data.protocol === "file:") {
      return { path: fileUrlToPath(data), type: "localImage" }
    }
    return { type: "image", url: data.href }
  }

  if (typeof data === "string") {
    if (data.startsWith("file://")) {
      return { path: fileUrlToPath(new URL(data)), type: "localImage" }
    }
    if (data.startsWith("data:") || data.startsWith("http://") || data.startsWith("https://")) {
      return { type: "image", url: data }
    }
    return { type: "image", url: `data:${part.mediaType};base64,${data}` }
  }

  const bytes = Array.from(data, (byte) => String.fromCharCode(byte)).join("")
  return { type: "image", url: `data:${part.mediaType};base64,${btoa(bytes)}` }
}

const formatToolResultOutput = (output: LanguageModelV3ToolResultOutput): string => {
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
          if (part.type === "file-data") {
            return part.filename
              ? `[file: ${part.filename}, ${part.mediaType}]`
              : `[file: ${part.mediaType}]`
          }
          if (part.type === "file-url") {
            return `[file: ${part.url}]`
          }
          return "[file]"
        })
        .join("\n")
  }
}

const systemPromptFromMessages = (prompt: LanguageModelV3Message[]): string | undefined => {
  const parts = prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
  return parts.length ? parts.join("\n\n") : undefined
}

const latestUserMessages = (prompt: LanguageModelV3Message[]): LanguageModelV3Message[] => {
  const messages: LanguageModelV3Message[] = []
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
  prompt: LanguageModelV3Message[],
  warnings: SharedV3Warning[]
): { readonly images: LanguageModelV3FilePart[]; readonly text: string } => {
  const lines: string[] = []
  let images: LanguageModelV3FilePart[] = []

  for (const message of prompt) {
    if (message.role === "system") {
      continue
    }

    if (message.role === "user") {
      const textParts: string[] = []
      const messageImages: LanguageModelV3FilePart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          textParts.push(part.text)
        } else if (part.type === "file" && isImageMediaType(part.mediaType)) {
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
      const imageNote = messageImages.length ? `[${messageImages.length} image(s) attached]` : ""
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
            return `Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`
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
        lines.push(`Tool Result (${part.toolName}): ${formatToolResultOutput(part.output)}`)
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
  prompt: LanguageModelV3Message[],
  threadMode: CodexAppServerThreadMode
): {
  readonly input: v2.UserInput[]
  readonly systemPrompt?: string
  readonly warnings: SharedV3Warning[]
} => {
  const warnings: SharedV3Warning[] = []
  const systemPrompt = systemPromptFromMessages(prompt)
  const input: v2.UserInput[] = []

  if (threadMode === "stateless") {
    const transcript = transcriptFromMessages(prompt, warnings)
    if (transcript.text.trim()) {
      input.push({ text: transcript.text, text_elements: [], type: "text" })
    }
    for (const image of transcript.images) {
      const imageInput = toImageInput(image, warnings)
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
      } else {
        const imageInput = toImageInput(part, warnings)
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

const sandboxPolicyFromMode = (mode?: CodexAppServerSandboxMode): v2.SandboxPolicy => {
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

const threadMetadata = (threadId: string, turnId?: string) => ({
  [providerId]: {
    sessionId: threadId,
    threadId,
    ...(turnId ? { turnId } : {}),
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
      return { result: { action: item.action, query: item.query } }
    default:
      return { result: toAiSdkJsonValue(item) }
  }
}

const isToolItem = (item: v2.ThreadItem): boolean =>
  item.type === "commandExecution" ||
  item.type === "fileChange" ||
  item.type === "mcpToolCall" ||
  item.type === "dynamicToolCall" ||
  item.type === "webSearch"

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

class CodexAppServerLanguageModel implements LanguageModelV3 {
  readonly provider = providerId
  readonly specificationVersion = "v3"
  readonly supportedUrls = {}
  #session: CodexAppServerAiSdkSession | null = null

  constructor(
    readonly modelId: string,
    private readonly settings: CodexAppServerProviderSettings
  ) {}

  getSession(): CodexAppServerAiSdkSession | null {
    return this.#session
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { stream } = await this.doStream(options)
    const reader = stream.getReader()
    const content: LanguageModelV3Content[] = []
    const textById = new Map<string, string>()
    const reasoningById = new Map<string, string>()
    let finishReason: LanguageModelV3FinishReason = { raw: undefined, unified: "other" }
    let usage = emptyUsage()
    let warnings: SharedV3Warning[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value.type === "stream-start") {
        warnings = value.warnings
      } else if (value.type === "text-delta") {
        textById.set(value.id, `${textById.get(value.id) ?? ""}${value.delta}`)
      } else if (value.type === "reasoning-delta") {
        reasoningById.set(value.id, `${reasoningById.get(value.id) ?? ""}${value.delta}`)
      } else if (
        value.type === "tool-call" ||
        value.type === "tool-result" ||
        value.type === "tool-approval-request"
      ) {
        content.push(value)
      } else if (value.type === "finish") {
        finishReason = value.finishReason
        usage = value.usage
      }
    }

    for (const text of textById.values()) {
      if (text) {
        content.push({ text, type: "text" })
      }
    }
    for (const text of reasoningById.values()) {
      if (text) {
        content.push({ text, type: "reasoning" })
      }
    }

    return {
      content,
      finishReason,
      providerMetadata: this.#session
        ? threadMetadata(this.#session.threadId, this.#session.turnId ?? undefined)
        : undefined,
      response: {
        id: this.#session?.turnId ?? undefined,
        modelId: this.modelId,
        timestamp: new Date(),
      },
      usage,
      warnings,
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const callOptions = getProviderOptions(options.providerOptions)
    const settings = mergeSettings(this.settings, callOptions)
    const threadMode = settings.threadMode ?? defaultThreadMode
    const converted = convertPrompt(options.prompt, threadMode)
    const warnings = [...unsupportedWarnings(options), ...converted.warnings]

    const shouldReuseThread =
      threadMode !== "stateless" && (settings.resumeThreadId || this.#session)
    if (shouldReuseThread && converted.systemPrompt) {
      warnings.push({
        message: "System prompt is ignored when reusing an existing Codex app-server thread.",
        type: "other",
      })
    }

    let threadId: string
    if (threadMode === "stateless" || (!settings.resumeThreadId && !this.#session)) {
      const response = await settings.bridge.request<"thread/start", ThreadStartResponse>(
        "thread/start",
        {
          approvalPolicy: settings.approvalPolicy ?? "on-request",
          approvalsReviewer: settings.approvalsReviewer,
          baseInstructions: settings.baseInstructions,
          config: settings.config,
          cwd: settings.cwd,
          developerInstructions: buildDeveloperInstructions(settings, converted.systemPrompt),
          model: this.modelId,
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
        approvalPolicy: settings.approvalPolicy ?? "on-request",
        approvalsReviewer: settings.approvalsReviewer,
        cwd: settings.cwd,
        effort: settings.reasoningEffort,
        input: converted.input,
        model: this.modelId,
        outputSchema,
        sandboxPolicy: sandboxPolicyFromMode(settings.sandboxMode),
        serviceTier: settings.serviceTier,
        summary: settings.reasoningSummary,
        threadId,
      },
      { retryOnOverload: true }
    )
    const turnId = turnResponse.turn.id
    session._setTurnId(turnId)

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        const emitRaw = (notification: ServerNotification) => {
          if (options.includeRawChunks) {
            controller.enqueue({ rawValue: notification, type: "raw" })
          }
        }
        const textIds = new Set<string>()
        const reasoningIds = new Set<string>()
        const toolIds = new Set<string>()
        const sameTurn = (params: { readonly threadId: string; readonly turnId: string }) =>
          params.threadId === threadId && params.turnId === turnId
        const unsubscribe = settings.bridge.on("notification", (notification) => {
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
              toolIds.add(params.item.id)
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
                providerMetadata: threadMetadata(threadId, turnId),
                type: "finish",
                usage: emptyUsage(),
              })
              unsubscribe()
              if (threadMode === "stateless") {
                this.#session = null
              }
              controller.close()
              break
            }
          }
        })

        controller.enqueue({ type: "stream-start", warnings })
        controller.enqueue({
          id: turnId,
          modelId: this.modelId,
          timestamp: new Date(),
          type: "response-metadata",
        })

        options.abortSignal?.addEventListener("abort", () => {
          void session.interrupt().finally(() => {
            unsubscribe()
            controller.close()
          })
        })
      },
    })

    return { stream }
  }
}

export type CodexAppServerProvider = ProviderV3 & {
  (modelId: string, settings?: CodexAppServerProviderCallSettings): LanguageModelV3
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
      }) as (modelId: string) => ImageModelV3,
      languageModel: createModel,
      listModels: (params?: v2.ModelListParams) =>
        settings.bridge.request<"model/list", ModelListResponse>("model/list", params ?? {}),
      specificationVersion: "v3" as const,
    }
  ) as CodexAppServerProvider
}
