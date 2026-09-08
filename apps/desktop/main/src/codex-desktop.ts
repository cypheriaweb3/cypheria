import { randomUUID } from "node:crypto"
import {
  type CodexAppServerAiSdkSession,
  type CodexAppServerBridge,
  CodexTurnProjector,
  type CodexTurnSnapshot,
  type CodexTurnUpdate,
  codexGeneratedImageData,
  createCodexAppServerProvider,
  type v2,
} from "@cypheria/codex-bridge"
import { convertToModelMessages, streamText, toUIMessageStream, type UIMessageChunk } from "ai"
import type { WebContents } from "electron"
import type {
  CodexAccountView,
  CodexChatEvent,
  CodexChatFollowUp,
  CodexChatStart,
  CodexLoginRequest,
  CodexLoginResult,
  CodexModelSettings,
  CodexModelView,
  CodexThreadDetailView,
  CodexThreadView,
  CodexUiDataTypes,
  CodexUiMessage,
} from "../../ipc/src/index.js"
import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

type ActiveChat = {
  readonly abortController: AbortController
  session?: CodexAppServerAiSdkSession
}

const permissionSettings = (
  selection: CodexChatStart["permissionSelection"]
): Pick<
  Parameters<typeof createCodexAppServerProvider>[0],
  "approvalPolicy" | "approvalsReviewer" | "permissionProfile" | "sandboxMode"
> => {
  if (!selection || selection.kind === "custom" || selection.kind === "server-default") return {}
  if (selection.kind === "profile") return { permissionProfile: selection.profileId }
  switch (selection.agentMode) {
    case "read-only":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissionProfile: ":read-only",
      }
    case "auto":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissionProfile: ":workspace",
      }
    case "granular":
      return {
        approvalPolicy: {
          granular: {
            mcp_elicitations: false,
            request_permissions: true,
            rules: false,
            sandbox_approval: false,
            skill_approval: false,
          },
        },
        approvalsReviewer: "user",
        permissionProfile: ":workspace",
      }
    case "guardian-approvals":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        permissionProfile: ":workspace",
      }
    case "full-access":
      return {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        permissionProfile: ":danger-full-access",
      }
  }
}

const activeChats = new Map<string, ActiveChat>()
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
const OPENAI_API_KEY_VALIDATION_TIMEOUT_MS = 10_000

type ApiKeyValidationFetch = (input: string | Request, init?: RequestInit) => Promise<Response>

const readOpenAiErrorMessage = async (response: Response): Promise<string | null> => {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message.trim() || null
    }
  } catch {
    // OpenAI may return an empty or non-JSON response through an intermediary.
  }
  return null
}

const sendChatEvent = (sender: WebContents, event: CodexChatEvent): void => {
  if (!sender.isDestroyed()) {
    sender.send(CYPHERIA_IPC_CHANNELS.codexChatEvent, event)
  }
}

export const readCodexAccount = async (bridge: CodexAppServerBridge): Promise<CodexAccountView> => {
  const response = await bridge.request<"account/read", v2.GetAccountResponse>("account/read", {
    refreshToken: false,
  })
  const account = response.account
  return {
    email: account?.type === "chatgpt" ? account.email : null,
    planType: account?.type === "chatgpt" ? String(account.planType) : null,
    requiresOpenaiAuth: response.requiresOpenaiAuth,
    type: account?.type ?? null,
  }
}

export const validateOpenAiApiKey = async (
  apiKey: string,
  fetcher: ApiKeyValidationFetch = fetch
): Promise<void> => {
  let response: Response
  try {
    response = await fetcher(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "GET",
      signal: AbortSignal.timeout(OPENAI_API_KEY_VALIDATION_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("OpenAI API key validation timed out. Try again.")
    }
    throw new Error("Could not validate the OpenAI API key. Check your connection and try again.")
  }

  if (response.ok) {
    await response.body?.cancel()
    return
  }

  const detail = await readOpenAiErrorMessage(response)
  const requestId = response.headers.get("x-request-id")
  const suffix = [detail, requestId ? `Request ID: ${requestId}` : null]
    .filter((part): part is string => part !== null)
    .join(" ")
  throw new Error(
    suffix
      ? `OpenAI API key validation failed (HTTP ${response.status}): ${suffix}`
      : `OpenAI API key validation failed (HTTP ${response.status}).`
  )
}

export const startCodexLogin = async (
  bridge: CodexAppServerBridge,
  request: CodexLoginRequest,
  validateApiKey: (apiKey: string) => Promise<void> = validateOpenAiApiKey
): Promise<CodexLoginResult> => {
  if (request.type === "apiKey") {
    await validateApiKey(request.apiKey)
  }
  const params: v2.LoginAccountParams =
    request.type === "chatgpt"
      ? {
          appBrand: "codex",
          codexStreamlinedLogin: true,
          type: "chatgpt",
          useHostedLoginSuccessPage: true,
        }
      : request
  const response = await bridge.request<"account/login/start", v2.LoginAccountResponse>(
    "account/login/start",
    params
  )
  if (response.type === "apiKey") return response
  if (response.type === "chatgpt") return response
  throw new Error(`Unsupported Codex login response: ${response.type}`)
}

export const cancelCodexLogin = async (
  bridge: CodexAppServerBridge,
  loginId: string
): Promise<boolean> => {
  const response = await bridge.request<"account/login/cancel", v2.CancelLoginAccountResponse>(
    "account/login/cancel",
    { loginId }
  )
  return response.status === "canceled"
}

export const logoutCodexAccount = async (bridge: CodexAppServerBridge): Promise<void> => {
  await bridge.request<"account/logout", v2.LogoutAccountResponse>("account/logout", undefined)
}

export const listCodexModels = async (
  bridge: CodexAppServerBridge,
  includeHidden = false
): Promise<CodexModelView[]> => {
  const provider = createCodexAppServerProvider({ bridge })
  const models: v2.Model[] = []
  let cursor: string | null = null
  do {
    const response = await provider.listModels({ cursor, includeHidden, limit: 100 })
    models.push(...response.data)
    cursor = response.nextCursor
  } while (cursor)

  return models.map((model) => ({
    defaultReasoningEffort: model.defaultReasoningEffort,
    defaultServiceTier: model.defaultServiceTier,
    description: model.description,
    displayName: model.displayName,
    hidden: model.hidden,
    id: model.id,
    inputModalities: model.inputModalities.map(String),
    isDefault: model.isDefault,
    model: model.model,
    reasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
      description: effort.description,
      value: effort.reasoningEffort,
    })),
    serviceTiers: model.serviceTiers,
  }))
}

const normalizeProvider = (provider: unknown): CodexModelSettings["provider"] => {
  if (provider === "amazon-bedrock" || provider === "ollama" || provider === "lmstudio") {
    return provider
  }
  return "openai"
}

export const readCodexModelSettings = async (
  bridge: CodexAppServerBridge
): Promise<CodexModelSettings> => {
  const response = await bridge.request<"config/read", v2.ConfigReadResponse>("config/read", {
    includeLayers: false,
  })
  return {
    model: response.config.model,
    provider: normalizeProvider(response.config.model_provider),
    reasoningEffort: response.config.model_reasoning_effort,
    serviceTier: response.config.service_tier,
  }
}

export const writeCodexModelSettings = async (
  bridge: CodexAppServerBridge,
  settings: CodexModelSettings
): Promise<CodexModelSettings> => {
  await bridge.request<"config/batchWrite", v2.ConfigWriteResponse>("config/batchWrite", {
    edits: [
      { keyPath: "model_provider", mergeStrategy: "replace", value: settings.provider },
      { keyPath: "model", mergeStrategy: "replace", value: settings.model },
      {
        keyPath: "model_reasoning_effort",
        mergeStrategy: "replace",
        value: settings.reasoningEffort,
      },
      { keyPath: "service_tier", mergeStrategy: "replace", value: settings.serviceTier },
    ],
    reloadUserConfig: true,
  })
  return readCodexModelSettings(bridge)
}

export const listCodexThreads = async (
  bridge: CodexAppServerBridge,
  options: {
    readonly archived?: boolean
    readonly cursor?: string | null
    readonly limit?: number
    readonly searchTerm?: string
    readonly sectionId?: string | null
    readonly sortDirection?: "asc" | "desc"
    readonly sortKey?: "created_at" | "updated_at" | "recency_at" | "section_position"
  }
): Promise<{ data: CodexThreadView[]; nextCursor: string | null }> => {
  const response = await bridge.request<"thread/list", v2.ThreadListResponse>("thread/list", {
    archived: options.archived ?? false,
    cursor: options.cursor,
    limit: options.limit ?? 100,
    searchTerm: options.searchTerm,
    ...(Object.hasOwn(options, "sectionId") ? { sectionId: options.sectionId } : {}),
    sortDirection: options.sortDirection ?? "desc",
    sortKey: options.sortKey ?? "updated_at",
  })
  return {
    data: response.data.map((thread) => ({
      cwd: thread.cwd,
      id: thread.id,
      modelProvider: thread.modelProvider,
      projectId: thread.projectId,
      sectionId: thread.section?.id ?? null,
      sectionName: thread.section?.name ?? null,
      status: thread.status.type,
      title: thread.name?.trim() || thread.preview.trim() || "Untitled chat",
      updatedAt: thread.updatedAt,
    })),
    nextCursor: response.nextCursor,
  }
}

const toCodexProjectView = (project: v2.Project) => ({
  createdAt: project.createdAt,
  id: project.id,
  name: project.name,
  position: project.position,
  recencyAt: project.recencyAt,
  roots: project.roots.map(({ path }) => path),
  updatedAt: project.updatedAt,
})

export const listCodexProjects = async (
  bridge: CodexAppServerBridge,
  options: {
    readonly cursor?: string | null
    readonly limit?: number
    readonly sortDirection?: "asc" | "desc"
    readonly sortKey?: "position" | "recencyAt"
  } = {}
) => {
  const response = await bridge.request<"project/list", v2.ProjectListResponse>("project/list", {
    cursor: options.cursor,
    limit: options.limit ?? 100,
    sortDirection: options.sortDirection,
    sortKey: options.sortKey,
  })
  return { data: response.data.map(toCodexProjectView), nextCursor: response.nextCursor }
}

export const createCodexProject = async (
  bridge: CodexAppServerBridge,
  input: { readonly name: string; readonly root: string }
) => {
  const response = await bridge.request<"project/create", v2.ProjectCreateResponse>(
    "project/create",
    {
      idempotencyKey: randomUUID(),
      name: input.name,
      roots: [{ path: input.root }],
    }
  )
  return toCodexProjectView(response.project)
}

export const updateCodexProject = async (
  bridge: CodexAppServerBridge,
  input: { readonly id: string; readonly name: string }
) => {
  const response = await bridge.request<"project/update", v2.ProjectUpdateResponse>(
    "project/update",
    { name: input.name, projectId: input.id }
  )
  return toCodexProjectView(response.project)
}

export const deleteCodexProject = async (bridge: CodexAppServerBridge, projectId: string) => {
  await bridge.request<"project/delete", v2.ProjectDeleteResponse>("project/delete", { projectId })
  return { deleted: true as const }
}

const toCodexThreadSectionView = (section: v2.ThreadSection) => ({
  id: section.id,
  name: section.name,
})

export const listCodexThreadSections = async (
  bridge: CodexAppServerBridge,
  options: { readonly cursor?: string | null; readonly limit?: number } = {}
) => {
  const response = await bridge.request<"threadSection/list", v2.ThreadSectionListResponse>(
    "threadSection/list",
    { cursor: options.cursor, limit: options.limit ?? 100 }
  )
  return { data: response.data.map(toCodexThreadSectionView), nextCursor: response.nextCursor }
}

export const createCodexThreadSection = async (bridge: CodexAppServerBridge, name: string) => {
  const response = await bridge.request<"threadSection/create", v2.ThreadSectionCreateResponse>(
    "threadSection/create",
    { name }
  )
  return toCodexThreadSectionView(response.section)
}

export const updateCodexThreadSection = async (
  bridge: CodexAppServerBridge,
  input: { readonly id: string; readonly name: string }
) => {
  const response = await bridge.request<"threadSection/update", v2.ThreadSectionUpdateResponse>(
    "threadSection/update",
    { name: input.name, sectionId: input.id }
  )
  return toCodexThreadSectionView(response.section)
}

export const deleteCodexThreadSection = async (bridge: CodexAppServerBridge, sectionId: string) => {
  await bridge.request<"threadSection/delete", v2.ThreadSectionDeleteResponse>(
    "threadSection/delete",
    { sectionId }
  )
  return { deleted: true as const }
}

export const moveCodexThreadToSection = async (
  bridge: CodexAppServerBridge,
  input: {
    readonly beforeThreadId?: string | null
    readonly sectionId: string | null
    readonly threadId: string
  }
) => {
  await bridge.request<"thread/section/move", v2.ThreadSectionMoveResponse>(
    "thread/section/move",
    input
  )
  return { moved: true as const }
}

const turnUpdatePart = (update: CodexTurnUpdate): CodexUiMessage["parts"][number] => {
  switch (update.type) {
    case "turn":
      return { data: update.data, id: update.id, type: "data-codex-turn" }
    case "item":
      return { data: update.data, id: update.id, type: "data-codex-item" }
    case "diff":
      return { data: update.data, id: update.id, type: "data-codex-diff" }
    case "plan":
      return { data: update.data, id: update.id, type: "data-codex-plan" }
    case "model-reroute":
      return { data: update.data, id: update.id, type: "data-codex-model-reroute" }
    case "event":
      return { data: update.data, id: update.id, type: "data-codex-event" }
  }
}

const turnUpdateChunk = (
  update: CodexTurnUpdate
): UIMessageChunk<CodexTurnSnapshot, CodexUiDataTypes> =>
  turnUpdatePart(update) as UIMessageChunk<CodexTurnSnapshot, CodexUiDataTypes>

const historyItemMetadata = (item: v2.ThreadItem) => ({
  "cypheria.codex": { item },
})

const customHistoryPart = (item: v2.ThreadItem): CodexUiMessage["parts"][number] =>
  ({
    kind: `cypheria.codex-${item.type}`,
    providerMetadata: historyItemMetadata(item),
    type: "custom",
  }) as CodexUiMessage["parts"][number]

const historyToolPart = (item: v2.ThreadItem): CodexUiMessage["parts"][number] | undefined => {
  let toolName: string
  let input: unknown
  let output: unknown
  let errorText: string | undefined

  switch (item.type) {
    case "commandExecution":
      toolName = "command"
      input = { command: item.command, cwd: item.cwd }
      output = { exitCode: item.exitCode, output: item.aggregatedOutput ?? "", status: item.status }
      if (item.status === "failed") errorText = item.aggregatedOutput ?? "Command failed"
      break
    case "fileChange":
      toolName = "fileChange"
      input = { changes: item.changes }
      output = { changes: item.changes, status: item.status }
      if (item.status === "failed") errorText = "File change failed"
      break
    case "mcpToolCall":
      toolName = `${item.server}.${item.tool}`
      input = item.arguments
      output = item.result ?? item.status
      if (item.error) errorText = JSON.stringify(item.error)
      break
    case "dynamicToolCall":
      toolName = item.namespace ? `${item.namespace}.${item.tool}` : item.tool
      input = item.arguments
      output = { contentItems: item.contentItems, status: item.status, success: item.success }
      if (item.success === false) errorText = "Tool call failed"
      break
    case "webSearch":
      toolName = "webSearch"
      input = { query: item.query }
      output = { action: item.action, results: item.results }
      break
    case "collabAgentToolCall":
      toolName = `collaboration.${item.tool}`
      input = { model: item.model, prompt: item.prompt, receiverThreadIds: item.receiverThreadIds }
      output = { agentsStates: item.agentsStates, status: item.status }
      if (item.status === "failed") errorText = "Collaboration call failed"
      break
    case "functionCallOutput":
      toolName = item.namespace ? `${item.namespace}.${item.name}` : item.name
      input = {}
      output = item.output
      break
    default:
      return undefined
  }

  return {
    callProviderMetadata: historyItemMetadata(item),
    errorText,
    input,
    output,
    providerExecuted: true,
    resultProviderMetadata: historyItemMetadata(item),
    state: errorText ? "output-error" : "output-available",
    toolCallId: item.id,
    toolName,
    type: "dynamic-tool",
  } as CodexUiMessage["parts"][number]
}

const historyPartsFromItem = (item: v2.ThreadItem): CodexUiMessage["parts"] => {
  if (item.type === "agentMessage") {
    return item.text
      ? [{ providerMetadata: historyItemMetadata(item), text: item.text, type: "text" }]
      : []
  }
  if (item.type === "reasoning") {
    const text = [...item.summary, ...item.content].join("\n")
    return text
      ? [
          {
            id: item.id,
            providerMetadata: historyItemMetadata(item),
            state: "done",
            text,
            type: "reasoning",
          },
        ]
      : []
  }
  if (item.type === "imageGeneration" && item.result && !item.failure) {
    const image = codexGeneratedImageData(item)
    if (!image) return []
    return [
      {
        mediaType: image.mediaType,
        providerMetadata: { "cypheria.codex": { item, itemId: item.id } },
        type: "file",
        url: image.url,
      },
    ]
  }
  const tool = historyToolPart(item)
  return tool ? [tool] : [customHistoryPart(item)]
}

const userHistoryParts = (
  item: Extract<v2.ThreadItem, { type: "userMessage" }>
): CodexUiMessage["parts"] =>
  item.content.map((content): CodexUiMessage["parts"][number] => {
    switch (content.type) {
      case "text":
        return { text: content.text, type: "text" }
      case "image":
        return { mediaType: "image/*", type: "file", url: content.url }
      case "audio":
        return { mediaType: "audio/*", type: "file", url: content.url }
      case "skill":
        return { text: `$${content.name}`, type: "text" }
      case "mention":
        return { text: `@${content.name}`, type: "text" }
      case "localImage":
      case "localAudio":
        return customHistoryPart(item)
    }
    return customHistoryPart(item)
  })

export const mapCodexTurnsToUiMessages = (
  threadId: string,
  turns: readonly v2.Turn[]
): CodexUiMessage[] => {
  const messages: CodexUiMessage[] = []
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        messages.push({ id: item.id, parts: userHistoryParts(item), role: "user" })
      }
    }

    const projector = new CodexTurnProjector(threadId, turn)
    const updates = projector.initialUpdates()
    const metadata = updates.find(
      (update): update is Extract<CodexTurnUpdate, { type: "turn" }> => update.type === "turn"
    )?.data
    const parts: CodexUiMessage["parts"] = updates.map(turnUpdatePart)
    for (const item of turn.items) {
      if (item.type !== "userMessage" && item.type !== "hookPrompt") {
        parts.push(...historyPartsFromItem(item))
      }
    }
    messages.push({ id: turn.id, metadata, parts, role: "assistant" })
  }
  return messages
}

export const mapCodexThreadItemsToUiMessages = (
  entries: readonly v2.ThreadItemEntry[]
): CodexUiMessage[] => {
  const turns = new Map<string, v2.Turn>()
  for (const entry of entries) {
    const turn = turns.get(entry.turnId) ?? {
      completedAt: null,
      durationMs: null,
      error: null,
      id: entry.turnId,
      items: [],
      itemsView: "full" as const,
      startedAt: null,
      status: "completed" as const,
    }
    turn.items.push(entry.item)
    turns.set(entry.turnId, turn)
  }
  return mapCodexTurnsToUiMessages("unknown", [...turns.values()])
}

export const readCodexThread = async (
  bridge: CodexAppServerBridge,
  threadId: string
): Promise<CodexThreadDetailView> => {
  const { thread } = await bridge.request<"thread/read", v2.ThreadReadResponse>("thread/read", {
    includeTurns: false,
    threadId,
  })
  const turns: v2.Turn[] = []
  let cursor: string | null | undefined
  do {
    const page = await bridge.request<"thread/turns/list", v2.ThreadTurnsListResponse>(
      "thread/turns/list",
      { cursor, itemsView: "full", limit: 100, sortDirection: "asc", threadId }
    )
    turns.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)

  return {
    cwd: thread.cwd,
    id: thread.id,
    messages: mapCodexTurnsToUiMessages(threadId, turns) as CodexThreadDetailView["messages"],
    projectId: thread.projectId,
    title: thread.name?.trim() || thread.preview.trim() || "Untitled chat",
  }
}

const runChat = async (
  bridge: CodexAppServerBridge,
  sender: WebContents,
  requestId: string,
  request: CodexChatStart,
  activeChat: ActiveChat,
  dynamicTools?: readonly v2.DynamicToolSpec[]
): Promise<void> => {
  let threadId: string | undefined = request.resumeThreadId
  let streamStarted = false
  const pendingTurnChunks: UIMessageChunk<CodexTurnSnapshot, CodexUiDataTypes>[] = []
  const emitTurnUpdate = (update: CodexTurnUpdate) => {
    const chunk = turnUpdateChunk(update)
    if (streamStarted) {
      sendChatEvent(sender, { chunk, requestId, type: "chunk" })
    } else {
      pendingTurnChunks.push(chunk)
    }
  }
  try {
    const permissions = permissionSettings(request.permissionSelection)
    const provider = createCodexAppServerProvider({
      ...permissions,
      bridge,
      cwd: request.cwd,
      dynamicTools,
      modelProvider: request.provider,
      onSessionCreated: (session) => {
        activeChat.session = session
        threadId = session.threadId
      },
      onTurnUpdate: emitTurnUpdate,
      reasoningEffort: request.reasoningEffort,
      projectId: request.projectId,
      resumeThreadId: request.resumeThreadId,
      serviceTier: request.serviceTier,
      threadMode: "persistent",
    })
    const result = streamText({
      abortSignal: activeChat.abortController.signal,
      messages: await convertToModelMessages(request.messages as CodexUiMessage[]),
      model: provider(request.model),
    })
    const reader = toUIMessageStream({
      sendSources: true,
      stream: result.fullStream,
    }).getReader()
    while (true) {
      const part = await reader.read()
      if (part.done) break
      sendChatEvent(sender, { chunk: part.value, requestId, type: "chunk" })
      if (part.value.type === "start") {
        streamStarted = true
        for (const chunk of pendingTurnChunks.splice(0)) {
          sendChatEvent(sender, { chunk, requestId, type: "chunk" })
        }
      }
    }
    sendChatEvent(sender, { requestId, threadId, type: "done" })
  } catch (error) {
    sendChatEvent(sender, {
      message: error instanceof Error ? error.message : String(error),
      requestId,
      type: "error",
    })
  } finally {
    activeChats.delete(requestId)
  }
}

export const startCodexChat = (
  bridge: CodexAppServerBridge,
  sender: WebContents,
  request: CodexChatStart,
  dynamicTools?: readonly v2.DynamicToolSpec[]
): string => {
  const requestId = request.requestId
  const activeChat: ActiveChat = { abortController: new AbortController() }
  activeChats.set(requestId, activeChat)
  void runChat(bridge, sender, requestId, request, activeChat, dynamicTools)
  return requestId
}

export const interruptCodexChat = async (requestId: string): Promise<boolean> => {
  const activeChat = activeChats.get(requestId)
  if (!activeChat) return false
  activeChat.abortController.abort()
  await activeChat.session?.interrupt()
  activeChats.delete(requestId)
  return true
}

const followUpUserInput = (input: CodexChatFollowUp): v2.UserInput[] => {
  const userInput: v2.UserInput[] = []
  if (input.text.trim()) {
    userInput.push({ text: input.text.trim(), text_elements: [], type: "text" })
  }
  for (const file of input.files) {
    if (file.mediaType.toLowerCase().startsWith("image/")) {
      userInput.push({ type: "image", url: file.url })
    } else if (file.mediaType.toLowerCase().startsWith("audio/")) {
      userInput.push({ type: "audio", url: file.url })
    } else {
      throw new Error(
        `Follow-up attachment "${file.filename ?? file.mediaType}" is not supported by Codex.`
      )
    }
  }
  return userInput
}

export const steerCodexChat = async (
  requestId: string,
  input: CodexChatFollowUp
): Promise<boolean> => {
  const session = activeChats.get(requestId)?.session
  if (!session?.isActive()) return false
  await session.injectMessage(followUpUserInput(input))
  return true
}

export const queueCodexThreadMessage = async (
  bridge: CodexAppServerBridge,
  threadId: string,
  clientUserMessageId: string,
  input: CodexChatFollowUp
): Promise<string> => {
  const response = await bridge.request<"thread/queue/add", v2.ThreadQueueAddResponse>(
    "thread/queue/add",
    { clientUserMessageId, input: followUpUserInput(input), threadId }
  )
  return response.queuedSubmission.id
}
