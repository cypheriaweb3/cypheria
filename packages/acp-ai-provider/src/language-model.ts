import { type ChildProcess, spawn } from "node:child_process"
import process from "node:process"
import { Readable, Writable } from "node:stream"
import type {
  AcceptNesNotification,
  CloseNesRequest,
  CloseSessionRequest,
  DeleteSessionRequest,
  DidChangeDocumentNotification,
  DidCloseDocumentNotification,
  DidFocusDocumentNotification,
  DidOpenDocumentNotification,
  DidSaveDocumentNotification,
  DisableProviderRequest,
  ForkSessionRequest,
  ListProvidersRequest,
  ListSessionsRequest,
  RejectNesNotification,
  ResumeSessionRequest,
  SetProviderRequest,
  StartNesRequest,
  SuggestNesRequest,
} from "@agentclientprotocol/sdk"
import {
  type AgentCapabilities,
  type ClientCapabilities,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type McpServer,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type SessionConfigOption,
  type SessionConfigOptionCategory,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type Stream,
  type ToolCallContent,
  type ToolCallStatus,
  type UsageUpdate,
} from "@agentclientprotocol/sdk"
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolResult,
  LanguageModelV4Usage,
  SharedV4Warning,
} from "@ai-sdk/provider"
import type { Tool, tool } from "ai"
import z from "zod"
import { getACPDynamicTool } from "./acp-tool.js"
import { ACPClientRuntime } from "./client-runtime.js"
import { convertAiSdkMessagesToAcp, extractACPTools, type ToolsInput } from "./convert-utils.js"
import { ACPDebugLogger } from "./debug.js"
import { formatToolError } from "./format-tool-error.js"
import {
  buildJsonSchemaPrompt,
  createJsonCleanupTransform,
  isJsonResponseFormat,
  stripMarkdownFences,
} from "./json-output.js"
import { ACP_AUTH_REQUIRED_ERROR_CODE, isAuthRequiredError } from "./lazy-auth.js"
import { ToolProxyHost } from "./tool-proxy/mod.js"
import type { ACPEvent, ACPEventListener, ACPProviderSettings } from "./types.js"

type ACPJsonRpcError = {
  code: number
  message: string
  data?: unknown
}

type ACPPromptResponse = PromptResponse

/**
 * How long to wait for an aborted ACP turn to drain (i.e. for the original
 * `session/prompt` to respond with `StopReason::Cancelled`) before giving up.
 * Some agents may not honor `session/cancel`; without a bound the consumer's
 * `ReadableStream.cancel()` could hang forever.
 */
const CANCEL_DRAIN_TIMEOUT_MS = 30_000

/**
 * Races a promise against a timeout, clearing the timer once one of them
 * settles so no dangling timer is left behind.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function getACPResponse(response: ACPPromptResponse) {
  return {
    acp: JSON.parse(JSON.stringify(response)),
  }
}

function getACPMetadata(value: unknown) {
  return { acp: JSON.parse(JSON.stringify(value)) }
}

function getACPPromptMeta(
  options: LanguageModelV4CallOptions
): Record<string, unknown> | undefined {
  const value = options.providerOptions?.acp
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function mapACPContentBlock(content: ContentBlock): LanguageModelV4Content[] {
  const providerMetadata = getACPMetadata(content)
  switch (content.type) {
    case "text":
      return [{ type: "text", text: content.text, providerMetadata }]
    case "image":
    case "audio":
      return [
        {
          type: "file",
          mediaType: content.mimeType,
          data: { type: "data", data: content.data },
          providerMetadata,
        },
      ]
    case "resource_link":
      return [
        {
          type: "source",
          sourceType: "url",
          id: content.uri,
          url: content.uri,
          title: content.title ?? content.name,
          providerMetadata,
        },
      ]
    case "resource":
      if ("blob" in content.resource) {
        return [
          {
            type: "file",
            mediaType: content.resource.mimeType ?? "application/octet-stream",
            data: { type: "data", data: content.resource.blob },
            providerMetadata,
          },
        ]
      }
      return [{ type: "text", text: content.resource.text, providerMetadata }]
    default:
      return []
  }
}

function createAISDKUsage(usage: UsageUpdate | null): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    ...(usage ? { raw: JSON.parse(JSON.stringify(usage)) } : {}),
  }
}

function getCallWarnings(options: LanguageModelV4CallOptions): SharedV4Warning[] {
  const warnings: SharedV4Warning[] = []
  for (const feature of [
    "maxOutputTokens",
    "temperature",
    "stopSequences",
    "topP",
    "topK",
    "presencePenalty",
    "frequencyPenalty",
    "seed",
  ] as const) {
    if (options[feature] !== undefined) {
      warnings.push({
        type: "unsupported",
        feature,
        details: "ACP session/prompt does not define this inference option.",
      })
    }
  }
  if (options.toolChoice && options.toolChoice.type !== "auto") {
    warnings.push({
      type: "unsupported",
      feature: "toolChoice",
      details: "ACP agents choose tools within the prompt turn.",
    })
  }
  if (options.reasoning && options.reasoning !== "provider-default") {
    warnings.push({
      type: "unsupported",
      feature: "reasoning",
      details: "Use an ACP session config option with category thought_level instead.",
    })
  }
  if (isJsonResponseFormat(options.responseFormat)) {
    warnings.push({
      type: "compatibility",
      feature: "responseFormat",
      details: "Structured output is enforced through an ACP prompt instruction.",
    })
  }
  return warnings
}

function toJsonToolResult(value: unknown): LanguageModelV4ToolResult["result"] {
  if (value === null || value === undefined) return "null"

  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return String(value)
    const parsed = JSON.parse(serialized) as unknown
    return parsed === null ? "null" : (parsed as LanguageModelV4ToolResult["result"])
  } catch {
    return String(value)
  }
}

function mapACPStopReasonToAISDK(
  stopReason?: string
): LanguageModelV4GenerateResult["finishReason"]["unified"] {
  switch (stopReason) {
    case "end_turn":
      return "stop"
    case "max_tokens":
    case "max_turn_requests":
      return "length"
    case "refusal":
      return "content-filter"
    case "cancelled":
      return "other"
    default:
      return "other"
  }
}

function toCatchableError(error: unknown, stderrText?: string): Error {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "number" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const jsonRpcError = error as ACPJsonRpcError
    const err = new Error(jsonRpcError.message) as Error & ACPJsonRpcError
    err.name = "ACPError"
    err.code = jsonRpcError.code
    err.data = jsonRpcError.data
    if (stderrText) {
      err.message = `${err.message}\n[agent stderr]\n${stderrText}`
    }
    return err
  }

  if (error instanceof Error) {
    if (stderrText) {
      error.message = `${error.message}\n[agent stderr]\n${stderrText}`
    }
    return error
  }

  const err = new Error(String(error))
  if (stderrText) {
    err.message = `${err.message}\n[agent stderr]\n${stderrText}`
  }
  return err
}

/**
 * The name of the provider tool used to represent ACP agent tool calls.
 */
export const ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME = "acp.acp_provider_agent_dynamic_tool"

export type ProviderAgentDynamicToolInput = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export const providerAgentDynamicToolSchema: z.ZodType<ProviderAgentDynamicToolInput> = z.object({
  toolCallId: z.string().describe("The unique ID of the tool call."),
  toolName: z.string().describe("The name of the tool being called."),
  args: z.record(z.string(), z.unknown()).describe("The input arguments for the tool call."),
})

/**
 * Flattens the selectable values advertised by a `select` session config
 * option into a plain value list (groups are expanded). Returns an empty
 * array when the option does not enumerate concrete values.
 */
function flattenSessionConfigSelectValues(option: SessionConfigOption): string[] {
  if (option.type !== "select") return []
  const values: string[] = []
  for (const entry of option.options) {
    if ("group" in entry) {
      for (const selectOption of entry.options) {
        values.push(selectOption.value)
      }
    } else {
      values.push(entry.value)
    }
  }
  return values
}

/**
 * Implements the AI SDK LanguageModelV4 interface for the
 * Agent Client Protocol (ACP).
 *
 * @see https://ai-sdk.dev/providers/community-providers/custom-providers#reasoning
 */
export class ACPLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const
  readonly provider = "acp"
  modelId: string
  modeId?: string
  // ACP resource_link supports URL references natively. Declaring this keeps
  // AI SDK 7 from downloading the asset before the ACP agent can inspect it.
  readonly supportedUrls: Record<string, RegExp[]> = { "*/*": [/^https?:\/\//] }

  private config: ACPProviderSettings
  private agentProcess: ChildProcess | null = null
  private connection: ACPClientRuntime | null = null
  private sessionId: string | null = null
  private sessionResponse: NewSessionResponse | null = null
  private client: ACPClientRuntime | null = null
  private initializeResponse: InitializeResponse | null = null
  private clientCapabilities: ClientCapabilities | null = null
  private readonly eventListeners = new Set<ACPEventListener>()
  private requestedModelId: string | undefined
  private currentModelId: string | null = null
  private currentModeId: string | null = null
  private latestUsage: UsageUpdate | null = null
  private isFreshSession = true
  private previousPrompt: LanguageModelV4Prompt | undefined

  // Serializes prompt turns across doStream/doGenerate calls. A new turn only
  // starts after the previous one has fully drained (e.g. after abort/cancel).
  private activeTurn: Promise<void> = Promise.resolve()

  // Captured stderr output from the agent process.
  private stderrChunks: string[] = []

  // State for managing stream conversion
  private textBlockIndex = 0
  private thinkBlockIndex = 0
  private currentTextId: string | null = null
  private currentThinkingId: string | null = null
  private toolCallsMap = new Map<
    string,
    {
      index: number
      name: string
      inputStarted?: boolean
      inputEnded?: boolean
      inputAvailable?: boolean
      inputJson?: string
      emitted?: boolean
    }
  >()

  // Tool proxy for host-side tool execution
  private toolProxyHost: ToolProxyHost | null = null

  private debug = new ACPDebugLogger()
  private availableAuthMethodIds: string[] = []

  constructor(
    modelId: string | undefined,
    modeId: string | undefined,
    config: ACPProviderSettings
  ) {
    this.modelId = modelId ?? config.command ?? "acp-agent"
    this.requestedModelId = modelId
    this.modeId = modeId
    this.config = config
    this.debug.ensureAgentMessageLogFile()
  }

  onEvent(listener: ACPEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  private emitEvent(event: ACPEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  getInitializeResponse(): InitializeResponse | null {
    return this.initializeResponse
  }

  getAgentCapabilities(): AgentCapabilities | null {
    return this.initializeResponse?.agentCapabilities ?? null
  }

  setRequestedModelId(modelId: string): void {
    this.modelId = modelId
    this.requestedModelId = modelId
  }

  private async controlConnection(): Promise<ACPClientRuntime> {
    await this.connectClient()
    if (!this.connection) throw new Error("ACP client is not connected")
    return this.connection
  }

  private requireSessionCapability(
    capability: "list" | "delete" | "fork" | "resume" | "close"
  ): void {
    if (!this.initializeResponse?.agentCapabilities?.sessionCapabilities?.[capability]) {
      throw new Error(`The ACP agent does not advertise session.${capability} capability`)
    }
  }

  async listSessions(params: ListSessionsRequest = {}) {
    const connection = await this.controlConnection()
    this.requireSessionCapability("list")
    return connection.listSessions(params)
  }

  async deleteSession(params: DeleteSessionRequest) {
    const connection = await this.controlConnection()
    this.requireSessionCapability("delete")
    return connection.deleteSession(params)
  }

  async forkSession(params: ForkSessionRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireSessionCapability("fork")
    return connection.forkSession(params)
  }

  async resumeSession(params: ResumeSessionRequest) {
    const connection = await this.controlConnection()
    this.requireSessionCapability("resume")
    return connection.resumeSession(params)
  }

  async closeSession(params: CloseSessionRequest) {
    const connection = await this.controlConnection()
    this.requireSessionCapability("close")
    return connection.closeSession(params)
  }

  async logout(): Promise<void> {
    const connection = await this.controlConnection()
    if (!this.initializeResponse?.agentCapabilities?.auth?.logout) {
      throw new Error("The ACP agent does not advertise auth.logout capability")
    }
    await connection.logout()
  }

  private requireExperimentalControls(): void {
    if (this.config.experimental?.controls !== true) {
      throw new Error("This ACP extension requires experimental.controls: true")
    }
  }

  private requireNesCapability(): NonNullable<AgentCapabilities["nes"]> {
    const capability = this.initializeResponse?.agentCapabilities?.nes
    if (!capability) throw new Error("The ACP agent does not advertise NES capability")
    return capability
  }

  private requireNesDocumentEvent(
    event: "didOpen" | "didChange" | "didClose" | "didSave" | "didFocus"
  ): void {
    const capability = this.requireNesCapability().events?.document?.[event]
    if (!capability) {
      throw new Error(`The ACP agent does not advertise NES document.${event} capability`)
    }
  }

  async listProviders(params: ListProvidersRequest = {}) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    if (!this.initializeResponse?.agentCapabilities?.providers) {
      throw new Error("The ACP agent does not advertise providers capability")
    }
    return connection.listProviders(params)
  }

  async setProvider(params: SetProviderRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    if (!this.initializeResponse?.agentCapabilities?.providers) {
      throw new Error("The ACP agent does not advertise providers capability")
    }
    return connection.setProvider(params)
  }

  async disableProvider(params: DisableProviderRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    if (!this.initializeResponse?.agentCapabilities?.providers) {
      throw new Error("The ACP agent does not advertise providers capability")
    }
    return connection.disableProvider(params)
  }

  async startNes(params: StartNesRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesCapability()
    return connection.startNes(params)
  }

  async suggestNes(params: SuggestNesRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesCapability()
    return connection.suggestNes(params)
  }

  async closeNes(params: CloseNesRequest) {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesCapability()
    return connection.closeNes(params)
  }

  async acceptNes(params: AcceptNesNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesCapability()
    await connection.acceptNes(params)
  }

  async rejectNes(params: RejectNesNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesCapability()
    await connection.rejectNes(params)
  }

  async documentDidOpen(params: DidOpenDocumentNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesDocumentEvent("didOpen")
    await connection.didOpen(params)
  }

  async documentDidChange(params: DidChangeDocumentNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesDocumentEvent("didChange")
    await connection.didChange(params)
  }

  async documentDidClose(params: DidCloseDocumentNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesDocumentEvent("didClose")
    await connection.didClose(params)
  }

  async documentDidSave(params: DidSaveDocumentNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesDocumentEvent("didSave")
    await connection.didSave(params)
  }

  async documentDidFocus(params: DidFocusDocumentNotification): Promise<void> {
    const connection = await this.controlConnection()
    this.requireExperimentalControls()
    this.requireNesDocumentEvent("didFocus")
    await connection.didFocus(params)
  }

  async requestExtension<Response = unknown, Params = unknown>(
    method: `_${string}`,
    params?: Params
  ): Promise<Response> {
    const connection = await this.controlConnection()
    return connection.request<Response, Params>(method, params)
  }

  async notifyExtension<Params = unknown>(method: `_${string}`, params?: Params): Promise<void> {
    const connection = await this.controlConnection()
    await connection.notify(method, params)
  }

  private buildClientCapabilities(): ClientCapabilities {
    const configured = this.config.initialize?.clientCapabilities ?? {}
    const handlers = this.config.handlers
    const experimentalUpdates = this.config.experimental?.sessionUpdates === true
    const experimentalControls = this.config.experimental?.controls === true
    const nes = this.config.experimental?.nes
    const elicitation = handlers?.elicitation

    return {
      ...configured,
      fs: {
        ...configured.fs,
        readTextFile: handlers?.fileSystem?.readTextFile !== undefined,
        writeTextFile: handlers?.fileSystem?.writeTextFile !== undefined,
      },
      terminal: handlers?.terminal !== undefined,
      auth: { ...configured.auth, terminal: this.config.terminalAuth === true },
      elicitation: elicitation
        ? {
            ...(elicitation.form !== false ? { form: {} } : {}),
            ...(elicitation.url === true ? { url: {} } : {}),
          }
        : undefined,
      session: {
        ...configured.session,
        configOptions: { ...configured.session?.configOptions, boolean: {} },
        ...(experimentalUpdates ? { compaction: {} } : {}),
      },
      ...(experimentalUpdates ? { plan: {} } : {}),
      ...(experimentalControls
        ? {
            nes: {
              ...configured.nes,
              ...(nes?.jump ? { jump: {} } : {}),
              ...(nes?.rename ? { rename: {} } : {}),
              ...(nes?.searchAndReplace ? { searchAndReplace: {} } : {}),
            },
            positionEncodings: nes?.positionEncodings ?? configured.positionEncodings ?? ["utf-16"],
          }
        : {}),
    }
  }

  private validateSessionFeatures(mcpServers: McpServer[]): void {
    const capabilities = this.initializeResponse?.agentCapabilities
    if (
      (this.config.session.additionalDirectories?.length ?? 0) > 0 &&
      !capabilities?.sessionCapabilities?.additionalDirectories
    ) {
      throw new Error("The ACP agent does not advertise additionalDirectories capability")
    }
    for (const server of mcpServers) {
      if (
        "type" in server &&
        server.type === "http" &&
        capabilities?.mcpCapabilities?.http !== true
      ) {
        throw new Error("The ACP agent does not advertise HTTP MCP support")
      }
      if (
        "type" in server &&
        server.type === "sse" &&
        capabilities?.mcpCapabilities?.sse !== true
      ) {
        throw new Error("The ACP agent does not advertise SSE MCP support")
      }
      if ("type" in server && server.type === "acp") {
        if (this.config.experimental?.controls !== true) {
          throw new Error("ACP-transport MCP requires experimental.controls: true")
        }
        if (capabilities?.mcpCapabilities?.acp !== true) {
          throw new Error("The ACP agent does not advertise ACP MCP support")
        }
        if (!this.config.handlers?.mcp) {
          throw new Error("ACP-transport MCP requires handlers.mcp")
        }
      }
    }
  }

  /**
   * Resets the internal state used for stream conversion.
   */
  private resetStreamState(): void {
    this.textBlockIndex = 0
    this.thinkBlockIndex = 0
    this.currentTextId = null
    this.currentThinkingId = null // Added this line to match state
    this.toolCallsMap.clear()
  }

  /**
   * Claims the model's single active-turn slot.
   *
   * Must be called synchronously before the first `await` of any
   * turn-producing method so that concurrent calls are serialized even when
   * they enter in the same tick. Returns a promise to wait for the previous
   * turn to drain and a function that marks the current turn as finished.
   */
  private beginTurn(): {
    waitForPrevious: Promise<void>
    finishTurn: () => void
  } {
    let finishTurn!: () => void
    const turnDone = new Promise<void>((resolve) => {
      finishTurn = resolve
    })
    const waitForPrevious = this.activeTurn
    this.activeTurn = turnDone
    return { waitForPrevious, finishTurn }
  }

  private hasToolInput(input: unknown): boolean {
    if (input === null || input === undefined) {
      return false
    }
    if (typeof input === "object") {
      return Object.keys(input as object).length > 0
    }
    if (typeof input === "string") {
      return input.length > 0
    }
    return true
  }

  private normalizeToolInput(input: unknown): unknown {
    return input ?? {}
  }

  /**
   * Parses a 'tool_call' notification update into a structured object.
   * Note: We only use rawInput for tool input (content is for UI display).
   */
  private parseToolCall(update: SessionNotification["update"]): {
    toolCallId: string
    toolName: string
    toolInput: unknown
  } {
    if (update.sessionUpdate !== "tool_call") {
      throw new Error("Invalid update type for parseToolCall")
    }

    const toolCallId = update.toolCallId
    const toolName = update.title || update.toolCallId
    // rawInput contains the actual tool parameters
    // content is for UI display (terminals, diffs, text) and should not be used as input
    const toolInput = update.rawInput ?? {}
    return { toolCallId, toolName, toolInput }
  }

  /**
   * Parses a 'tool_call_update' notification update into a structured object.
   * Note: We only use rawOutput for tool result here (content is for UI display).
   * rawInput is handled in handleStreamNotification when emitting tool-call args.
   */
  private parseToolResult(update: SessionNotification["update"]): {
    toolCallId: string
    toolName: string
    toolResult: unknown
    isError: boolean
    status: ToolCallStatus | undefined
  } {
    if (update.sessionUpdate !== "tool_call_update") {
      throw new Error("Invalid update type for parseToolResult")
    }
    const toolCallId = update.toolCallId
    const toolName = update.title || update.toolCallId
    // rawOutput contains the actual tool result
    // content is for UI display (terminals, diffs, text) and should not be used as result
    // caveat: rawOutput may be undefined for some agents
    const toolResult = update.rawOutput ?? update.content ?? null
    const isError = update.status === "failed"
    return {
      toolCallId,
      toolName,
      toolResult,
      isError,
      status: update.status ?? undefined,
    }
  }

  /**
   * Converts AI SDK prompt messages into ACP ContentBlock objects.
   * When session exists, only extracts the last user message (history is in session).
   * Prefixes text with role since ACP ContentBlock has no role field.
   */

  /**
   * Ensures the ACP agent process is running and a session is established.
   * @param acpTools - Tools from streamText options to proxy
   */
  /**
   * Connects to the ACP agent process and initializes the protocol connection.
   * Does NOT start a session.
   */
  async connectClient(): Promise<void> {
    this.debug.ensureAgentMessageLogFile()

    if (this.connection) {
      return
    }

    let stream: Stream
    if (this.config.transport) {
      stream = await this.config.transport.connect()
    } else {
      if (!this.agentProcess) {
        if (!this.config.command) {
          throw new Error("ACP provider requires either command or transport")
        }
        const sessionCwd =
          this.config.session?.cwd || (typeof process.cwd === "function" ? process.cwd() : "/")

        const inheritedEnvironment = this.resolveInheritedEnvironment()
        this.agentProcess = spawn(this.config.command, this.config.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...inheritedEnvironment, ...this.config.env },
          cwd: sessionCwd,
          // Windows GUI hosts (e.g. Electron, /SUBSYSTEM:WINDOWS) have no parent console.
          // `windowsHide: true` prevents CreateProcess from showing an auto-created console window.
          // Ref: https://github.com/nodejs/node/issues/21825
          ...(process.platform === "win32" ? { windowsHide: true } : {}),
        })

        this.stderrChunks = []
        this.agentProcess.stderr?.on("data", (chunk: Uint8Array) => {
          const text = new TextDecoder().decode(chunk)
          this.stderrChunks.push(text)
          // Keep previous terminal visibility behavior
          process.stderr.write(chunk)
        })
      }

      if (!this.agentProcess.stdout || !this.agentProcess.stdin) {
        throw new Error("Failed to spawn agent process with stdio")
      }

      const input = Writable.toWeb(this.agentProcess.stdin) as WritableStream<Uint8Array>
      const output = Readable.toWeb(this.agentProcess.stdout) as ReadableStream<Uint8Array>
      stream = ndJsonStream(input, output)
    }

    if (!stream) throw new Error("Failed to create ACP transport stream")
    this.client = new ACPClientRuntime(
      this.config.handlers ?? {},
      (notification) => {
        this.emitEvent({ type: "session-update", value: notification })
      },
      (notification) => {
        this.emitEvent({ type: "elicitation-complete", value: notification })
      },
      (error) => {
        this.emitEvent({ type: "transport-closed", error })
      },
      (method, params) => {
        this.emitEvent({ type: "client-operation", method, params })
      }
    )
    this.client.connect(stream)
    this.connection = this.client

    if (!this.connection) {
      throw new Error("Connection not initialized")
    }

    this.clientCapabilities = this.buildClientCapabilities()
    const initConfig: InitializeRequest = {
      ...this.config.initialize,
      protocolVersion: this.config.initialize?.protocolVersion ?? PROTOCOL_VERSION,
      clientInfo: this.config.initialize?.clientInfo ?? {
        name: "cypheria-acp-ai-provider",
        title: "Cypheria ACP AI Provider",
        version: "0.0.0",
      },
      clientCapabilities: this.clientCapabilities,
    }

    try {
      const initResult = await this.connection.initialize(initConfig)
      if (initResult.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `Unsupported ACP protocol version ${initResult.protocolVersion}; expected ${PROTOCOL_VERSION}`
        )
      }
      this.initializeResponse = initResult
      const selectedEncoding = initResult.agentCapabilities?.positionEncoding
      const offeredEncodings = this.clientCapabilities.positionEncodings
      if (selectedEncoding && offeredEncodings && !offeredEncodings.includes(selectedEncoding)) {
        throw new Error(
          `ACP agent selected unsupported position encoding ${selectedEncoding}; offered ${offeredEncodings.join(", ")}`
        )
      }
      this.emitEvent({
        type: "initialized",
        value: { initialize: initResult, clientCapabilities: this.clientCapabilities },
      })
      const authMethods = initResult.authMethods ?? []
      this.availableAuthMethodIds = authMethods.map((method: { id: string }) => method.id)

      if (authMethods.length > 0) {
        const configuredAuthMethodId = this.config.authMethodId

        if (!configuredAuthMethodId) {
          const defaultAuthMethodId = this.availableAuthMethodIds[0]
          console.log(
            `[acp-ai-provider] Warning: authMethodId is not configured. Lazy auth will default to the first auth method "${defaultAuthMethodId}".`,
            JSON.stringify(authMethods, null, 2)
          )
        } else if (!this.availableAuthMethodIds.includes(configuredAuthMethodId)) {
          console.log(
            `[acp-ai-provider] Warning: authMethodId "${configuredAuthMethodId}" is not in initialize.authMethods. Lazy auth auto-retry will be skipped unless you call authenticate() with a valid method.`,
            JSON.stringify(authMethods, null, 2)
          )
        } else {
          console.log(
            `[acp-ai-provider] Lazy auth enabled with authMethodId="${configuredAuthMethodId}". Authentication will run only when required (code ${ACP_AUTH_REQUIRED_ERROR_CODE}).`
          )
        }
      }
    } catch (error) {
      throw toCatchableError(error, this.stderrChunks.join(""))
    }
  }

  /**
   * Starts a new session or updates the existing one.
   * Assumes connectClient() has been called.
   */
  async startSession(acpTools?: Array<Tool & { name: string }>): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected")
    }
    const connection = this.connection

    try {
      // Prepare MCP servers list foundation
      const mcpServers = [...(this.config.session?.mcpServers ?? [])]
      let toolsAdded = false

      // Set up tool proxy if tools are present and proxy doesn't exist
      if (acpTools && acpTools.length > 0 && !this.toolProxyHost) {
        this.debug.log(
          "[acp-ai-provider] Setting up tool proxy for client-side tools...",
          acpTools.map((t) => t.name)
        )
        this.toolProxyHost = new ToolProxyHost("acp-ai-sdk-tools")
        toolsAdded = true
      }

      if (this.toolProxyHost && acpTools) {
        this.toolProxyHost.replaceTools(acpTools)
      }

      // Always include proxy config if host is initialized
      // This starts the server if needed and ensures we don't drop the proxy when updating session
      if (this.toolProxyHost) {
        const proxyConfig = await this.toolProxyHost.start()
        mcpServers.push(proxyConfig)
      }
      this.validateSessionFeatures(mcpServers)

      // Check if we need to update existing session (e.g. to enable tools)
      if (this.sessionId && toolsAdded) {
        const sessionResponse = await connection.newSession({
          ...this.config.session,
          cwd: this.config.session?.cwd ?? process.cwd(),
          mcpServers,
        })
        this.sessionResponse = sessionResponse
        this.sessionId = sessionResponse.sessionId
        // Treat as fresh since we are establishing a new session.
        this.isFreshSession = true
        this.previousPrompt = undefined
        this.latestUsage = null

        await this.syncConfiguredModelAndMode()
        await this.applySessionDelay()
        return
      }

      // If session already exists and we didn't just update it, do nothing
      if (this.sessionId) {
        await this.syncConfiguredModelAndMode()
        return
      }

      // Start a fresh session
      if (this.config.existingSessionId) {
        if (this.initializeResponse?.agentCapabilities?.loadSession !== true) {
          throw new Error("The ACP agent does not advertise session/load support")
        }
        // Note: loadSession typically assumes servers are already known or config is separate?
        // Protocol says loadSession usually just resumes.
        // But if we want to Add tools to a loaded session, we might need newSession logic?
        // For now, preserving original logic: loadSession takes mcpServers.
        const loadResponse = await connection.loadSession({
          sessionId: this.config.existingSessionId,
          cwd: this.config.session?.cwd ?? process.cwd(),
          mcpServers,
        })
        this.sessionId = this.config.existingSessionId
        this.sessionResponse = { sessionId: this.config.existingSessionId, ...loadResponse }
        this.isFreshSession = false
      } else {
        const sessionResponse = await connection.newSession({
          ...this.config.session,
          cwd: this.config.session?.cwd ?? process.cwd(),
          mcpServers,
        })
        this.sessionResponse = sessionResponse
        this.sessionId = sessionResponse.sessionId
        this.isFreshSession = true
        this.previousPrompt = undefined
        this.latestUsage = null
      }

      await this.syncConfiguredModelAndMode()
      await this.applySessionDelay()
    } catch (error) {
      throw toCatchableError(error, this.stderrChunks.join(""))
    }
  }

  /**
   * Resets model/mode state from the current session response and re-applies
   * any configured model/mode. Resetting unconditionally prevents a stale
   * currentModelId/currentModeId left over from a previous session from
   * suppressing setModel()/setMode() after the session is re-created.
   */
  private async syncConfiguredModelAndMode(): Promise<void> {
    const { modes } = this.sessionResponse ?? {}
    this.currentModelId = null
    this.currentModeId = modes?.currentModeId ?? null

    if (this.requestedModelId && this.requestedModelId !== this.currentModelId) {
      await this.setModel(this.requestedModelId)
      this.currentModelId = this.requestedModelId
    }
    if (this.modeId && this.modeId !== this.currentModeId) {
      await this.setMode(this.modeId)
      this.currentModeId = this.modeId
    }
  }

  private async applySessionDelay() {
    if (this.config.sessionDelayMs) {
      this.debug.log(
        `[acp-ai-provider] Waiting ${this.config.sessionDelayMs}ms after session setup...`
      )
      await new Promise((resolve) => setTimeout(resolve, this.config.sessionDelayMs))
    }
  }

  private resolveInheritedEnvironment(): NodeJS.ProcessEnv {
    if (this.config.inheritEnv === true) return { ...process.env }
    const names = Array.isArray(this.config.inheritEnv)
      ? this.config.inheritEnv
      : [
          "PATH",
          "HOME",
          "USER",
          "LOGNAME",
          "SHELL",
          "TMPDIR",
          "TEMP",
          "TMP",
          "SystemRoot",
          "ComSpec",
          "PATHEXT",
        ]
    const environment: NodeJS.ProcessEnv = {}
    for (const name of names) {
      const value = process.env[name]
      if (value !== undefined) environment[name] = value
    }
    return environment
  }

  /**
   * Resolves the auth method ID to use for lazy authentication.
   * Returns null if no valid method is available.
   */
  private resolveLazyAuthMethodId(): string | null {
    const configured = this.config.authMethodId
    if (!configured) {
      return this.availableAuthMethodIds[0] ?? null
    }
    if (this.availableAuthMethodIds.length === 0) {
      return configured
    }
    return this.availableAuthMethodIds.includes(configured) ? configured : null
  }

  /**
   * Runs an operation with lazy auth: try once, and if an auth-required error
   * is thrown, authenticate and retry exactly once.
   */
  private async withLazyAuthRetry<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!isAuthRequiredError(error)) {
        throw error
      }

      const methodId = this.resolveLazyAuthMethodId()
      if (!methodId) {
        throw error
      }

      this.debug.log(
        `[acp-ai-provider] Authentication required during ${stage} (code ${ACP_AUTH_REQUIRED_ERROR_CODE}). Running lazy authenticate with methodId="${methodId}" and retrying once...`
      )

      await this.authenticate(methodId)
      return await operation()
    }
  }

  /**
   * Ensures the ACP agent process is running and a session is established.
   *
   * Lazy auth behavior:
   * - first try connect + start session without authenticating
   * - if auth is required (ACP auth-required error), authenticate once and retry once
   *
   * @param acpTools - Tools from streamText options to proxy
   */
  private async ensureConnected(acpTools?: Array<Tool & { name: string }>): Promise<void> {
    await this.withLazyAuthRetry("session setup", async () => {
      await this.connectClient()
      await this.startSession(acpTools)
    })
  }

  /**
   * Clears connection state. Skips if persistSession is enabled.
   */
  private cleanup(): void {
    if (this.config.persistSession) return
    this.forceCleanup()
  }

  /**
   * Returns the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Initializes the session and returns session info (models, modes, meta).
   * Call this before prompting to discover available options.
   *
   * @param tools - Optional tools to register during session initialization.
   */
  async initSession(tools?: ToolsInput): Promise<NewSessionResponse> {
    // This ensures tools have registered execute handlers attached
    const acpTools = extractACPTools(tools, false)

    await this.ensureConnected(acpTools.length > 0 ? acpTools : undefined)
    if (!this.sessionResponse) throw new Error("ACP session initialization returned no response")
    return this.sessionResponse
  }

  /**
   * Triggers ACP authentication manually.
   * Useful when callers catch an auth-required error and want to authenticate then retry.
   */
  async authenticate(methodId: string): Promise<void> {
    await this.connectClient()

    if (!this.connection) {
      throw new Error("Not connected")
    }

    try {
      await this.connection.authenticate({ methodId })
    } catch (error) {
      throw toCatchableError(error, this.stderrChunks.join(""))
    }
  }

  /**
   * Returns the session configuration options advertised by the agent.
   * A category filters by the protocol's semantic category rather than an
   * agent-specific config ID.
   */
  getConfigOptions(category?: SessionConfigOptionCategory): SessionConfigOption[] {
    const configOptions = this.sessionResponse?.configOptions ?? []
    return category === undefined
      ? [...configOptions]
      : configOptions.filter((option) => option.category === category)
  }

  /**
   * Sets an ACP session configuration option by its agent-advertised ID.
   */
  async setConfigOption(
    configId: string,
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    if (!this.connection || !this.sessionId) {
      throw new Error("Not connected. Call initSession() first.")
    }

    const request: SetSessionConfigOptionRequest =
      typeof value === "boolean"
        ? { sessionId: this.sessionId, configId, type: "boolean", value }
        : { sessionId: this.sessionId, configId, value }
    const response = await this.connection.setSessionConfigOption(request)

    if (this.sessionResponse) {
      this.sessionResponse = {
        ...this.sessionResponse,
        configOptions: response.configOptions,
      }
    }

    return response
  }

  /**
   * Sets the single option advertised for a semantic category.
   */
  async setConfigOptionByCategory(
    category: SessionConfigOptionCategory,
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    const matches = this.getConfigOptions(category)
    if (matches.length === 0) {
      throw new Error(`No session config option is available for category "${category}".`)
    }
    if (matches.length > 1) {
      const ids = matches.map((option) => option.id).join(", ")
      throw new Error(
        `Multiple session config options are available for category "${category}": ${ids}. Use setConfigOption() with an explicit config ID.`
      )
    }

    const [match] = matches
    if (!match) throw new Error(`No session config option is available for category "${category}".`)
    return await this.setConfigOption(match.id, value)
  }

  /**
   * Sets the option advertised with the standard `thought_level` category.
   */
  setThoughtLevel(
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    return this.setConfigOptionByCategory("thought_level", value)
  }

  private async promptWithLazyAuthRetry(request: {
    sessionId: string
    prompt: unknown
  }): Promise<ACPPromptResponse> {
    if (!this.connection) {
      throw new Error("Not connected")
    }
    const connection = this.connection

    try {
      const response = await this.withLazyAuthRetry("prompt", () =>
        connection.prompt(request as Parameters<ACPClientRuntime["prompt"]>[0])
      )
      this.debug.appendPromptResponse(response)
      return response
    } catch (error) {
      this.debug.appendPromptError(error)
      throw error
    }
  }

  /**
   * Sets the session mode (e.g., "ask", "plan").
   *
   * Agents built purely on session config options advertise mode selection
   * through a config option (category "mode") instead of the session modes
   * API. Prefer that config option when the agent advertises exactly one,
   * and fall back to the stable session modes API (setSessionMode) for
   * agents that expose `modes` without a config option.
   */
  async setMode(modeId: string): Promise<void> {
    if (!this.connection || !this.sessionId) {
      throw new Error("Not connected. Call preconnect() first.")
    }

    const modeOptions = this.getConfigOptions("mode")
    if (modeOptions.length > 0) {
      if (modeOptions.length > 1) {
        const ids = modeOptions.map((option) => option.id).join(", ")
        throw new Error(
          `Multiple session config options are available for category "mode": ${ids}. Use setConfigOption() with an explicit config ID.`
        )
      }

      const [option] = modeOptions
      if (!option) throw new Error("The advertised mode option is unavailable")
      const availableValues = flattenSessionConfigSelectValues(option)
      if (availableValues.length > 0 && !availableValues.includes(modeId)) {
        const availableList = availableValues.join(", ")
        throw new Error(`Mode "${modeId}" is not available. Available modes: ${availableList}`)
      }

      await this.setConfigOption(option.id, modeId)
      this.currentModeId = modeId
      return
    }

    const availableModes = this.sessionResponse?.modes?.availableModes
    if (availableModes) {
      const foundMode = availableModes.find((m) => m.id === modeId)
      if (!foundMode) {
        const availableList = availableModes.map((m) => m.id).join(", ")
        const currentInfo = this.sessionResponse?.modes?.currentModeId
          ? ` (Current: "${this.sessionResponse.modes.currentModeId}")`
          : ""

        throw new Error(
          `Mode "${modeId}" is not available${currentInfo}. Available modes: ${availableList}`
        )
      }
    } else if ((this.sessionResponse?.configOptions?.length ?? 0) > 0) {
      throw new Error(
        `Mode "${modeId}" cannot be applied: the agent advertises session config options but no mode option with category "mode". Inspect getConfigOptions() and call setConfigOption() with the intended config ID.`
      )
    }

    await this.connection.setSessionMode({ sessionId: this.sessionId, modeId })
    this.currentModeId = modeId
  }

  /**
   * Sets the session model.
   *
   * ACP 1.4 agents advertise model selection through a session config option
   * with category "model". The removed session/set_model extension is not used.
   */
  async setModel(modelId: string): Promise<void> {
    if (!this.connection || !this.sessionId) {
      throw new Error("Not connected. Call preconnect() first.")
    }

    const modelOptions = this.getConfigOptions("model")
    if (modelOptions.length > 0) {
      if (modelOptions.length > 1) {
        const ids = modelOptions.map((option) => option.id).join(", ")
        throw new Error(
          `Multiple session config options are available for category "model": ${ids}. Use setConfigOption() with an explicit config ID.`
        )
      }

      const [option] = modelOptions
      if (!option) throw new Error("The advertised model option is unavailable")
      const availableValues = flattenSessionConfigSelectValues(option)
      if (availableValues.length > 0 && !availableValues.includes(modelId)) {
        const availableList = availableValues.join(", ")
        throw new Error(`Model "${modelId}" is not available. Available models: ${availableList}`)
      }

      await this.setConfigOption(option.id, modelId)
      this.modelId = modelId
      this.requestedModelId = modelId
      this.currentModelId = modelId
      return
    }

    throw new Error(
      `Model "${modelId}" cannot be applied: the agent did not advertise a session config option with category "model".`
    )
  }

  /**
   * Forces cleanup regardless of persistSession setting.
   */
  forceCleanup(): void {
    // Stop tool proxy if running
    if (this.toolProxyHost) {
      this.toolProxyHost.stop()
      this.toolProxyHost = null
    }

    this.connection?.close()
    if (this.config.transport?.close) void this.config.transport.close()

    if (this.agentProcess) {
      this.agentProcess.kill()
      this.agentProcess.stdin?.end()
      this.agentProcess.stdout?.destroy()
      this.agentProcess.stderr?.destroy()
      this.agentProcess = null
    }
    this.connection = null
    this.sessionId = null
    this.sessionResponse = null
    this.client = null
    this.stderrChunks = []
    this.availableAuthMethodIds = []
    this.initializeResponse = null
    this.clientCapabilities = null
    this.latestUsage = null
    this.previousPrompt = undefined
  }

  /**
   * Emits raw content (plan, diffs, terminals) as raw stream parts.
   * Plan data is emitted directly, while diffs and terminals are bound to a toolCallId.
   */
  private emitRawContent(
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    includeRawChunks: boolean,
    data:
      | { type: "plan"; entries: unknown }
      | {
          content: ToolCallContent[]
          toolCallId: string
        }
  ): void {
    if (!includeRawChunks) return
    if ("entries" in data) {
      // Plan data
      controller.enqueue({
        type: "raw",
        rawValue: { type: "plan", entries: data.entries },
      })
      return
    }

    // Preserve every ACP tool content variant losslessly for ACP-aware consumers.
    for (const item of data.content) {
      controller.enqueue({
        type: "raw",
        rawValue: { ...item, toolCallId: data.toolCallId },
      })
    }
  }

  /**
   * Flushes any pending tool calls that haven't emitted tool-call yet.
   * This handles the case where a tool emits {} first, then the next message is a different type.
   */
  private flushPendingToolCalls(
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>
  ): void {
    for (const [toolCallId, toolInfo] of this.toolCallsMap.entries()) {
      if (!toolInfo.emitted) this.emitToolInvocation(controller, toolCallId, toolInfo, {})
    }
  }

  private emitToolInvocation(
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    toolCallId: string,
    toolInfo: {
      name: string
      inputStarted?: boolean
      inputEnded?: boolean
      inputAvailable?: boolean
      inputJson?: string
      emitted?: boolean
    },
    input: unknown
  ): void {
    if (toolInfo.emitted) return
    const inputJson = JSON.stringify({ toolCallId, toolName: toolInfo.name, args: input ?? {} })
    toolInfo.inputAvailable = true
    toolInfo.inputJson = inputJson
    if (toolInfo.inputStarted) {
      controller.enqueue({ type: "tool-input-delta", id: toolCallId, delta: inputJson })
    }
    this.endToolInput(controller, toolCallId, toolInfo)
    controller.enqueue({
      type: "tool-call",
      toolCallId,
      toolName: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
      providerExecuted: true,
      dynamic: true,
      input: inputJson,
    })
    toolInfo.emitted = true
  }

  private endToolInput(
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    toolCallId: string,
    toolInfo: { inputStarted?: boolean; inputEnded?: boolean }
  ): void {
    if (toolInfo.inputStarted && !toolInfo.inputEnded) {
      toolInfo.inputEnded = true
      controller.enqueue({ type: "tool-input-end", id: toolCallId })
    }
  }

  /**
   * Standardized handler for converting SessionNotifications into
   * LanguageModelV4StreamPart objects, pushing them onto a stream controller.
   */
  private handleStreamNotification(
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    notification: SessionNotification,
    includeRawChunks = false
  ): void {
    this.debug.appendAgentMessage(notification)

    const update = notification.update
    switch (update.sessionUpdate) {
      case "config_option_update":
        if (this.sessionResponse && notification.sessionId === this.sessionId) {
          this.sessionResponse = {
            ...this.sessionResponse,
            configOptions: update.configOptions,
          }
        }
        break
      case "plan":
        this.flushPendingToolCalls(controller)
        this.emitRawContent(controller, includeRawChunks, {
          type: "plan",
          entries: update.entries,
        })
        break
      case "agent_thought_chunk": {
        this.flushPendingToolCalls(controller)
        const thoughtMetadata = getACPMetadata(update)
        if (!this.currentThinkingId) {
          this.currentThinkingId = `reasoning - ${this.thinkBlockIndex++} `
          controller.enqueue({
            type: "reasoning-start",
            id: this.currentThinkingId,
            providerMetadata: thoughtMetadata,
          })
        }
        controller.enqueue({
          type: "reasoning-delta",
          id: this.currentThinkingId,
          delta: update.content.type === "text" ? update.content.text : "",
          providerMetadata: thoughtMetadata,
        })
        break
      }

      case "agent_message_chunk": {
        this.flushPendingToolCalls(controller)
        const messageMetadata = getACPMetadata(update)
        if (this.currentThinkingId) {
          controller.enqueue({
            type: "reasoning-end",
            id: this.currentThinkingId,
          })
          this.currentThinkingId = null
        }

        if (update.content.type === "text") {
          const textChunk = update.content.text
          if (!this.currentTextId) {
            this.currentTextId = `text - ${this.textBlockIndex++} `
            controller.enqueue({
              type: "text-start",
              id: this.currentTextId,
              providerMetadata: messageMetadata,
            })
          }
          controller.enqueue({
            type: "text-delta",
            id: this.currentTextId,
            delta: textChunk,
            providerMetadata: messageMetadata,
          })
        } else {
          if (this.currentTextId) {
            controller.enqueue({ type: "text-end", id: this.currentTextId })
            this.currentTextId = null
          }
          for (const part of mapACPContentBlock(update.content)) {
            if (part.type === "text") {
              const id = `text - ${this.textBlockIndex++} `
              controller.enqueue({
                type: "text-start",
                id,
                providerMetadata: part.providerMetadata,
              })
              controller.enqueue({
                type: "text-delta",
                id,
                delta: part.text,
                providerMetadata: part.providerMetadata,
              })
              controller.enqueue({ type: "text-end", id, providerMetadata: part.providerMetadata })
            } else if (
              part.type === "file" ||
              part.type === "source" ||
              part.type === "custom" ||
              part.type === "reasoning-file"
            ) {
              controller.enqueue(part)
            }
          }
        }
        break
      }

      case "user_message_chunk":
      case "available_commands_update":
      case "session_info_update":
        if (includeRawChunks) controller.enqueue({ type: "raw", rawValue: update })
        break
      case "current_mode_update":
        this.currentModeId = update.currentModeId
        if (this.sessionResponse?.modes) {
          this.sessionResponse.modes.currentModeId = update.currentModeId
        }
        if (includeRawChunks) controller.enqueue({ type: "raw", rawValue: update })
        break
      case "usage_update":
        this.latestUsage = update
        if (includeRawChunks) controller.enqueue({ type: "raw", rawValue: update })
        break

      case "plan_update":
      case "plan_removed":
      case "compaction_update":
      case "compaction_summary_chunk":
        if (this.config.experimental?.sessionUpdates === true) {
          if (includeRawChunks) controller.enqueue({ type: "raw", rawValue: update })
        }
        break

      case "tool_call": {
        // Close current text/thinking block when tool call starts
        if (this.currentTextId) {
          controller.enqueue({
            type: "text-end",
            id: this.currentTextId,
          })
          this.currentTextId = null
        }
        if (this.currentThinkingId) {
          controller.enqueue({
            type: "reasoning-end",
            id: this.currentThinkingId,
          })
          this.currentThinkingId = null
        }

        const { toolCallId, toolName, toolInput } = this.parseToolCall(update)

        const existingToolCall = this.toolCallsMap.get(toolCallId)

        // Check if rawInput has actual data
        const hasInput = this.hasToolInput(toolInput)

        if (!existingToolCall) {
          // First time seeing this toolCallId
          const toolState = {
            index: this.toolCallsMap.size,
            name: toolName,
            inputStarted: true,
            inputAvailable: false,
          }
          this.toolCallsMap.set(toolCallId, toolState)

          // Emit tool-input-start when we first see the tool call
          controller.enqueue({
            type: "tool-input-start",
            id: toolCallId,
            toolName: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
            providerExecuted: true,
            dynamic: true,
            title: toolName,
          })

          // If rawInput is already populated, emit tool-call immediately
          if (hasInput) {
            this.emitToolInvocation(controller, toolCallId, toolState, toolInput)
          }
        } else if (!existingToolCall.inputAvailable && hasInput) {
          // We previously got tool-input-start, now we have the actual input
          existingToolCall.inputAvailable = true

          // Update the stored name if we now have a better one (title vs toolCallId)
          if (
            update.title &&
            existingToolCall.name !== update.title &&
            update.title !== toolCallId
          ) {
            existingToolCall.name = update.title
          }

          this.emitToolInvocation(controller, toolCallId, existingToolCall, toolInput)
        }
        // If inputAvailable is already true, ignore duplicate notifications
        break
      }

      case "tool_call_update": {
        const { toolCallId, toolName, toolResult, isError } = this.parseToolResult(update)
        const effectiveStatus = update.status ?? "in_progress"

        let toolInfo = this.toolCallsMap.get(toolCallId)
        // ACP allows incremental tool updates and rawInput can be provided on
        // tool_call_update (not only on the initial tool_call), so we must
        // recover args from update.rawInput when available.
        // Ref: https://agentclientprotocol.com/protocol/tool-calls
        // Ref: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
        const updateInput = this.normalizeToolInput(
          "rawInput" in update ? update.rawInput : undefined
        )

        if (effectiveStatus === "pending" || effectiveStatus === "in_progress") {
          if (!toolInfo) {
            // First time seeing this toolCallId
            toolInfo = {
              index: this.toolCallsMap.size,
              name: toolName,
              inputStarted: true,
              inputAvailable: false,
            }
            this.toolCallsMap.set(toolCallId, toolInfo)
            controller.enqueue({
              type: "tool-input-start",
              id: toolCallId,
              toolName: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
              providerExecuted: true,
              dynamic: true,
              title: toolName,
            })
          }

          const hasNewInput = this.hasToolInput(updateInput)
          if (update.title && toolInfo.name !== update.title && update.title !== toolCallId) {
            toolInfo.name = update.title
          }
          if (!toolInfo.emitted && hasNewInput) {
            this.emitToolInvocation(controller, toolCallId, toolInfo, updateInput)
          } else if (
            toolInfo.emitted &&
            hasNewInput &&
            JSON.stringify({ toolCallId, toolName: toolInfo.name, args: updateInput }) !==
              toolInfo.inputJson &&
            includeRawChunks
          ) {
            controller.enqueue({
              type: "raw",
              rawValue: { type: "tool_input_snapshot", toolCallId, input: updateInput },
            })
          }

          const content = update.content ?? []
          if (content.length > 0) {
            this.emitRawContent(controller, includeRawChunks, { content, toolCallId })
          }
          break
        }

        if (!["completed", "failed"].includes(effectiveStatus)) {
          // Ignore other intermediate statuses (e.g., pending)
          break
        }

        if (!toolInfo) {
          // This can happen if all tool_call/in_progress notifications were missed
          toolInfo = {
            index: this.toolCallsMap.size,
            name: toolName,
            inputStarted: false,
            inputEnded: true,
            inputAvailable: false,
          }
          this.toolCallsMap.set(toolCallId, toolInfo)
          this.emitToolInvocation(controller, toolCallId, toolInfo, updateInput)
        } else {
          if (update.title && toolInfo.name !== update.title && update.title !== toolCallId) {
            toolInfo.name = update.title
          }
          if (!toolInfo.emitted)
            this.emitToolInvocation(controller, toolCallId, toolInfo, updateInput)
        }

        // Send the result of the host-side tool execution.
        controller.enqueue({
          type: "tool-result",
          toolCallId,
          toolName: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
          dynamic: true,
          result: isError ? formatToolError(toolResult) : toJsonToolResult(toolResult),
          ...(isError && {
            isError: true,
          }),
        })

        const content = update.content ?? []
        if (content.length > 0) {
          this.emitRawContent(controller, includeRawChunks, { content, toolCallId })
        }
        break
      }
    }
  }

  /**
   * Implements the non-streaming generation method.
   */
  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    // Serialize with streaming turns so a new prompt is only issued after the
    // previous turn has fully drained.
    const { waitForPrevious, finishTurn } = this.beginTurn()
    await waitForPrevious.catch(() => {})

    try {
      // Build JSON schema prompt if responseFormat requests JSON output
      const jsonResponseFormat = isJsonResponseFormat(options.responseFormat)
        ? options.responseFormat
        : null
      const jsonSchemaPrompt = jsonResponseFormat
        ? buildJsonSchemaPrompt(jsonResponseFormat)
        : undefined

      const acpTools = extractACPTools(options.tools)
      await this.ensureConnected(acpTools.length > 0 ? acpTools : undefined)
      this.toolProxyHost?.setExecutionContext({ abortSignal: options.abortSignal })

      /*
        If we just created the session (isFreshSession=true), we send full prompt.
        If we reused it, we send filtered prompt.
        After sending, we are no longer "fresh" for subsequent calls on this instance.
      */
      const promptContent = convertAiSdkMessagesToAcp(
        options,
        this.isFreshSession,
        jsonSchemaPrompt,
        this.initializeResponse?.agentCapabilities?.promptCapabilities,
        this.previousPrompt
      )
      this.previousPrompt = options.prompt
      this.isFreshSession = false

      let accumulatedText = ""
      let accumulatedReasoning = ""
      const additionalContent: LanguageModelV4Content[] = []
      const toolCalls: Array<{
        id: string
        name: string
        input: unknown
      }> = []
      const toolResults: Map<string, { name: string; result: unknown; isError?: boolean }> =
        new Map()

      // This object mimics the ReadableStreamDefaultController API
      // to aggregate stream parts into final results.
      const mockController = {
        enqueue: (part: LanguageModelV4StreamPart) => {
          switch (part.type) {
            case "text-delta":
              accumulatedText += part.delta
              break

            case "reasoning-delta":
              accumulatedReasoning += part.delta
              break

            case "file":
            case "source":
            case "custom":
            case "reasoning-file":
              additionalContent.push(part)
              break

            case "tool-call": {
              // handleStreamNotification maps the real tool to ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME
              // and puts the real info in the 'input' JSON string.
              const inputData = JSON.parse(part.input as string)
              toolCalls.push({
                id: part.toolCallId,
                name: inputData.toolName, // The *real* tool name
                input: inputData.args,
              })
              break
            }

            case "tool-result": {
              const matchingToolCall = toolCalls.find((tc) => tc.id === part.toolCallId)
              toolResults.set(part.toolCallId, {
                name: matchingToolCall?.name || part.toolCallId,
                result: part.result,
                isError: part.isError,
              })

              break
            }

            // Other stream parts (reasoning, start/end blocks, etc.)
            // are ignored in non-streaming mode
            default:
              break
          }
        },
      }

      // Get a reference to the bound method
      const streamHandler = this.handleStreamNotification.bind(this)

      // Reset stream state, as handleStreamNotification relies on it
      this.resetStreamState()

      if (this.client) {
        this.client.setSessionUpdateHandler((notification) => {
          // Reuse the stream notification handler, passing the mock controller
          streamHandler(
            mockController as unknown as ReadableStreamDefaultController<LanguageModelV4StreamPart>,
            notification
          )
        })
      }

      const sessionId = this.sessionId
      if (!sessionId) throw new Error("ACP session initialization returned no session ID")
      const response = await this.promptWithLazyAuthRetry({
        sessionId,
        prompt: promptContent,
        ...(getACPPromptMeta(options) ? { _meta: getACPPromptMeta(options) } : {}),
      })

      const content: LanguageModelV4Content[] = []

      // In structured JSON mode, strip markdown fences if present.
      const finalText = jsonResponseFormat ? stripMarkdownFences(accumulatedText) : accumulatedText

      if (finalText.trim()) {
        content.push({
          type: "text",
          text: finalText,
        })
      }
      if (accumulatedReasoning.trim()) {
        content.push({ type: "reasoning", text: accumulatedReasoning })
      }
      content.push(...additionalContent)

      // In doGenerate, we report the *completed* tool call, including its
      // output. This is a "report" of what the agent did.
      for (const toolCall of toolCalls) {
        content.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          providerExecuted: true,
          dynamic: true,
          input: JSON.stringify(toolCall.input),
        })

        const toolResult = toolResults.get(toolCall.id)
        if (toolResult !== undefined) {
          content.push({
            type: "tool-result",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            dynamic: true,
            result: toolResult.isError
              ? formatToolError(toolResult.result)
              : toJsonToolResult(toolResult.result),
            ...(toolResult.isError ? { isError: true } : {}),
          })
        }
      }

      const result: LanguageModelV4GenerateResult = {
        content,
        finishReason: {
          unified: mapACPStopReasonToAISDK(response.stopReason),
          raw: response.stopReason,
        },
        providerMetadata: getACPResponse(response),
        response: { modelId: this.currentModelId ?? this.modelId, timestamp: new Date() },
        usage: createAISDKUsage(this.latestUsage),
        warnings: getCallWarnings(options),
      }

      this.cleanup()

      return result
    } catch (error) {
      this.cleanup()
      throw error
    } finally {
      finishTurn()
    }
  }

  /**
   * Implements the streaming generation method.
   */
  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    // Claim the active-turn slot BEFORE any await. This serializes prompt
    // turns: a new prompt is only issued after the previous turn has fully
    // drained (e.g. an aborted turn has responded with `cancelled`).
    const { waitForPrevious, finishTurn } = this.beginTurn()
    await waitForPrevious.catch(() => {})

    try {
      // IMPORTANT: Extract and register ACP tools BEFORE ensureConnected
      // This ensures Tool Proxy can discover them when it starts
      const acpTools = extractACPTools(options.tools)

      // Detect JSON output mode and build schema prompt if needed
      const jsonResponseFormat = isJsonResponseFormat(options.responseFormat)
        ? options.responseFormat
        : null
      const jsonSchemaPrompt = jsonResponseFormat
        ? buildJsonSchemaPrompt(jsonResponseFormat)
        : undefined

      // Now connect with the registered tools
      await this.ensureConnected(acpTools.length > 0 ? acpTools : undefined)
      this.toolProxyHost?.setExecutionContext({ abortSignal: options.abortSignal })

      /*
        If we just created the session (isFreshSession=true), we send full prompt.
        If we reused it, we send filtered prompt.
        After sending, we are no longer "fresh" for subsequent calls on this instance.
      */
      const promptContent = convertAiSdkMessagesToAcp(
        options,
        this.isFreshSession,
        jsonSchemaPrompt,
        this.initializeResponse?.agentCapabilities?.promptCapabilities,
        this.previousPrompt
      )
      this.previousPrompt = options.prompt
      this.isFreshSession = false

      const sessionId = this.sessionId
      if (!sessionId) throw new Error("ACP session initialization returned no session ID")
      const client = this.client
      const connection = this.connection
      const cleanup = () => this.cleanup()

      // Get a reference to the bound method
      const streamHandler = this.handleStreamNotification.bind(this)

      let cancelRequested = false
      let consumerCancelled = false
      let controllerClosed = false
      let promptSettled: Promise<void> = Promise.resolve()

      // Sends session/cancel exactly once. This only notifies the agent; the
      // turn is truly over when the original prompt settles (with `cancelled`).
      const cancelTurn = async () => {
        if (cancelRequested) return
        cancelRequested = true
        try {
          await connection?.cancel({ sessionId })
        } catch {
          // Best effort: the connection may already be gone.
        }
      }

      const onAbort = () => {
        void cancelTurn()
      }

      if (!options.abortSignal?.aborted) {
        options.abortSignal?.addEventListener("abort", onAbort, { once: true })
      }

      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        start: async (controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>) => {
          try {
            controller.enqueue({ type: "stream-start", warnings: getCallWarnings(options) })

            // Reset stream state for this new stream
            this.resetStreamState()

            if (options.abortSignal?.aborted) {
              // Aborted before the prompt was issued: nothing to cancel, just
              // end the turn and close the empty stream.
              controllerClosed = true
              controller.close()
              return
            }

            if (client) {
              client.setSessionUpdateHandler((notification: SessionNotification) => {
                // Drop stale notifications once the consumer cancelled or the
                // controller is closed while abort/cancel drains the turn.
                if (consumerCancelled || controllerClosed) return
                if (controller.desiredSize === null) {
                  controllerClosed = true
                  return
                }
                // Call the centralized handler
                streamHandler(controller, notification, options.includeRawChunks === true)
              })
            }

            const promptPromise = this.promptWithLazyAuthRetry({
              sessionId,
              prompt: promptContent,
              ...(getACPPromptMeta(options) ? { _meta: getACPPromptMeta(options) } : {}),
            })
            promptSettled = promptPromise.then(
              () => undefined,
              () => undefined
            )

            const response = await promptPromise

            // Nothing left to emit if the consumer cancelled the stream or the
            // controller was closed while draining.
            if (consumerCancelled || controllerClosed) {
              return
            }

            // Normal completion
            controller.enqueue({
              type: "finish",
              finishReason: {
                unified: mapACPStopReasonToAISDK(response.stopReason),
                raw: response.stopReason,
              },
              providerMetadata: getACPResponse(response),
              usage: createAISDKUsage(this.latestUsage),
            })
            controllerClosed = true
            controller.close()
          } catch (error) {
            if (!consumerCancelled && !controllerClosed) {
              controller.enqueue({
                type: "error",
                error: toCatchableError(error, this.stderrChunks.join("")),
              })
              controllerClosed = true
              controller.close()
            }
          } finally {
            options.abortSignal?.removeEventListener("abort", onAbort)
            finishTurn()
            cleanup()
          }
        },
        cancel: async () => {
          consumerCancelled = true
          try {
            await cancelTurn()
            // Wait for the original prompt to settle (normally with
            // `cancelled`) instead of only waiting for the cancel notification
            // to be written. Bound the drain so a misbehaving agent cannot hang
            // the consumer's cancel() forever.
            await withTimeout(promptSettled, CANCEL_DRAIN_TIMEOUT_MS)
          } finally {
            cleanup()
          }
        },
      })

      // In structured JSON mode, wrap the stream with a transform that strips
      // markdown fences from text content (models sometimes wrap JSON in ```json blocks
      // despite being instructed not to).
      const outputStream = jsonResponseFormat
        ? stream.pipeThrough(createJsonCleanupTransform())
        : stream

      return { stream: outputStream }
    } catch (error) {
      // If connection/session setup fails before the stream starts, ensure the
      // child process does not keep the event loop alive and release the
      // active-turn slot.
      finishTurn()
      this.forceCleanup()
      throw error
    }
  }

  get tools(): Record<string, ReturnType<typeof tool>> {
    return getACPDynamicTool()
  }
}
