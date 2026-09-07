import {
  type CodexAppServerAiSdkSession,
  type CodexAppServerBridge,
  createCodexAppServerProvider,
  type v2,
} from "@cypheria/codex-bridge"
import { convertToModelMessages, streamText, toUIMessageStream, type UIMessage } from "ai"
import type { WebContents } from "electron"
import type {
  CodexAccountView,
  CodexChatEvent,
  CodexChatStart,
  CodexLoginRequest,
  CodexLoginResult,
  CodexModelSettings,
  CodexModelView,
  CodexThreadView,
} from "../../ipc/src/index.js"
import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

type ActiveChat = {
  readonly abortController: AbortController
  session?: CodexAppServerAiSdkSession
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
  }
): Promise<{ data: CodexThreadView[]; nextCursor: string | null }> => {
  const response = await bridge.request<"thread/list", v2.ThreadListResponse>("thread/list", {
    archived: options.archived ?? false,
    cursor: options.cursor,
    limit: options.limit ?? 100,
    searchTerm: options.searchTerm,
    ...(Object.hasOwn(options, "sectionId") ? { sectionId: options.sectionId } : {}),
    sortDirection: "desc",
    sortKey: "updated_at",
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
      title: thread.name?.trim() || thread.preview.trim() || "Untitled task",
      updatedAt: thread.updatedAt,
    })),
    nextCursor: response.nextCursor,
  }
}

const runChat = async (
  bridge: CodexAppServerBridge,
  sender: WebContents,
  requestId: string,
  request: CodexChatStart,
  activeChat: ActiveChat
): Promise<void> => {
  let threadId: string | undefined = request.resumeThreadId
  try {
    const provider = createCodexAppServerProvider({
      approvalPolicy: request.approvalPolicy,
      bridge,
      cwd: request.cwd,
      modelProvider: request.provider,
      onSessionCreated: (session) => {
        activeChat.session = session
        threadId = session.threadId
      },
      reasoningEffort: request.reasoningEffort,
      resumeThreadId: request.resumeThreadId,
      sandboxMode: request.sandboxMode,
      serviceTier: request.serviceTier,
      threadMode: "persistent",
    })
    const result = streamText({
      abortSignal: activeChat.abortController.signal,
      messages: await convertToModelMessages(request.messages as UIMessage[]),
      model: provider(request.model),
    })
    const reader = toUIMessageStream({ stream: result.fullStream }).getReader()
    while (true) {
      const part = await reader.read()
      if (part.done) break
      sendChatEvent(sender, { chunk: part.value, requestId, type: "chunk" })
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
  request: CodexChatStart
): string => {
  const requestId = request.requestId
  const activeChat: ActiveChat = { abortController: new AbortController() }
  activeChats.set(requestId, activeChat)
  void runChat(bridge, sender, requestId, request, activeChat)
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
