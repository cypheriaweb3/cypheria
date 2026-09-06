/**
 * ACP Provider Configuration and Factory
 */

import type {
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigOptionCategory,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk"
import type { tool } from "ai"
import { ACPLanguageModel } from "./language-model.js"
import type { ACPProviderSettings } from "./types.js"

/**
 * ACP Provider - implements AI SDK provider pattern
 *
 * This provider wraps ACP (Agent Client Protocol) agents to work with AI SDK's
 * standard interface, allowing you to use ACP agents through the AI SDK.
 */
export class ACPProvider {
  private config: ACPProviderSettings
  private model: ACPLanguageModel | null = null
  private readonly models = new Set<ACPLanguageModel>()
  private readonly eventListeners = new Map<
    Parameters<ACPLanguageModel["onEvent"]>[0],
    Map<ACPLanguageModel, () => void>
  >()

  constructor(config: ACPProviderSettings) {
    this.config = config
  }

  private ensureModel(): ACPLanguageModel {
    return this.model ?? this.languageModel()
  }

  /**
   * Create a language model instance for a specific ACP agent
   *
   * @returns A LanguageModelV4 instance
   */
  languageModel(modelId?: string, modeId?: string): ACPLanguageModel {
    const model = new ACPLanguageModel(modelId, modeId, this.config)
    this.models.add(model)
    for (const [listener, subscriptions] of this.eventListeners) {
      subscriptions.set(model, model.onEvent(listener))
    }
    this.model = model
    return model
  }

  /**
   * Shorthand for creating a language model
   */
  call(): ACPLanguageModel {
    return this.languageModel()
  }

  /**
   * Provider tools - includes the agent dynamic tool
   */
  get tools(): Record<string, ReturnType<typeof tool>> | undefined {
    return this.model?.tools
  }

  /**
   * Returns the current session ID if one is active.
   * Useful when `persistSession` is enabled and you need to reference the session later.
   */
  getSessionId(): string | null {
    return this.model?.getSessionId() ?? null
  }

  getInitializeResponse(): ReturnType<ACPLanguageModel["getInitializeResponse"]> {
    return this.model?.getInitializeResponse() ?? null
  }

  getAgentCapabilities(): ReturnType<ACPLanguageModel["getAgentCapabilities"]> {
    return this.model?.getAgentCapabilities() ?? null
  }

  onEvent(listener: Parameters<ACPLanguageModel["onEvent"]>[0]): () => void {
    const subscriptions = new Map<ACPLanguageModel, () => void>()
    for (const model of this.models) subscriptions.set(model, model.onEvent(listener))
    this.eventListeners.set(listener, subscriptions)
    return () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe()
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Initializes the session and returns session info (models, modes, meta).
   * Call this before prompting to discover available options.
   */
  initSession(tools?: Parameters<ACPLanguageModel["initSession"]>[0]): Promise<NewSessionResponse> {
    return this.ensureModel().initSession(tools)
  }

  /**
   * Initializes the connection to the agent process without starting a session.
   * Useful if you need to reduce the time to the first token.
   */
  connect(): Promise<void> {
    return this.ensureModel().connectClient()
  }

  /**
   * Runs authentication manually.
   *
   * If `methodId` is omitted, falls back to `config.authMethodId`.
   */
  authenticate(methodId?: string): Promise<void> {
    const resolvedMethodId = methodId ?? this.config.authMethodId
    if (!resolvedMethodId) {
      throw new Error(
        "No auth method configured. Pass methodId or set authMethodId in ACPProviderSettings."
      )
    }

    return this.ensureModel().authenticate(resolvedMethodId)
  }

  /**
   * Sets the session mode (e.g., "ask", "plan").
   */
  setMode(modeId: string): Promise<void> {
    if (!this.model) {
      throw new Error("No model initialized. Call languageModel() first.")
    }
    return this.model.setMode(modeId)
  }

  /**
   * Sets the session model.
   */
  setModel(modelId: string): Promise<void> {
    if (!this.model) {
      throw new Error("No model initialized. Call languageModel() first.")
    }
    return this.model.setModel(modelId)
  }

  /**
   * Returns config options advertised by the active ACP session, optionally
   * filtered by semantic category.
   */
  getConfigOptions(category?: SessionConfigOptionCategory): SessionConfigOption[] {
    return this.model?.getConfigOptions(category) ?? []
  }

  /**
   * Sets any ACP session config option using its agent-advertised ID.
   */
  setConfigOption(
    configId: string,
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    if (!this.model) {
      throw new Error("No model initialized. Call initSession() first.")
    }
    return this.model.setConfigOption(configId, value)
  }

  /**
   * Sets the single config option advertised for a semantic category.
   */
  setConfigOptionByCategory(
    category: SessionConfigOptionCategory,
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    if (!this.model) {
      throw new Error("No model initialized. Call initSession() first.")
    }
    return this.model.setConfigOptionByCategory(category, value)
  }

  /**
   * Sets the option advertised with the standard `thought_level` category.
   */
  setThoughtLevel(
    value: SetSessionConfigOptionRequest["value"]
  ): Promise<SetSessionConfigOptionResponse> {
    if (!this.model) {
      throw new Error("No model initialized. Call initSession() first.")
    }
    return this.model.setThoughtLevel(value)
  }

  listSessions(params?: Parameters<ACPLanguageModel["listSessions"]>[0]) {
    return this.ensureModel().listSessions(params)
  }

  deleteSession(params: Parameters<ACPLanguageModel["deleteSession"]>[0]) {
    return this.ensureModel().deleteSession(params)
  }

  forkSession(params: Parameters<ACPLanguageModel["forkSession"]>[0]) {
    return this.ensureModel().forkSession(params)
  }

  resumeSession(params: Parameters<ACPLanguageModel["resumeSession"]>[0]) {
    return this.ensureModel().resumeSession(params)
  }

  closeSession(params: Parameters<ACPLanguageModel["closeSession"]>[0]) {
    return this.ensureModel().closeSession(params)
  }

  logout(): Promise<void> {
    return this.ensureModel().logout()
  }

  listProviders(params?: Parameters<ACPLanguageModel["listProviders"]>[0]) {
    return this.ensureModel().listProviders(params)
  }

  setProvider(params: Parameters<ACPLanguageModel["setProvider"]>[0]) {
    return this.ensureModel().setProvider(params)
  }

  disableProvider(params: Parameters<ACPLanguageModel["disableProvider"]>[0]) {
    return this.ensureModel().disableProvider(params)
  }

  startNes(params: Parameters<ACPLanguageModel["startNes"]>[0]) {
    return this.ensureModel().startNes(params)
  }

  suggestNes(params: Parameters<ACPLanguageModel["suggestNes"]>[0]) {
    return this.ensureModel().suggestNes(params)
  }

  closeNes(params: Parameters<ACPLanguageModel["closeNes"]>[0]) {
    return this.ensureModel().closeNes(params)
  }

  acceptNes(params: Parameters<ACPLanguageModel["acceptNes"]>[0]) {
    return this.ensureModel().acceptNes(params)
  }

  rejectNes(params: Parameters<ACPLanguageModel["rejectNes"]>[0]) {
    return this.ensureModel().rejectNes(params)
  }

  documentDidOpen(params: Parameters<ACPLanguageModel["documentDidOpen"]>[0]) {
    return this.ensureModel().documentDidOpen(params)
  }

  documentDidChange(params: Parameters<ACPLanguageModel["documentDidChange"]>[0]) {
    return this.ensureModel().documentDidChange(params)
  }

  documentDidClose(params: Parameters<ACPLanguageModel["documentDidClose"]>[0]) {
    return this.ensureModel().documentDidClose(params)
  }

  documentDidSave(params: Parameters<ACPLanguageModel["documentDidSave"]>[0]) {
    return this.ensureModel().documentDidSave(params)
  }

  documentDidFocus(params: Parameters<ACPLanguageModel["documentDidFocus"]>[0]) {
    return this.ensureModel().documentDidFocus(params)
  }

  requestExtension<Response = unknown, Params = unknown>(method: `_${string}`, params?: Params) {
    return this.ensureModel().requestExtension<Response, Params>(method, params)
  }

  notifyExtension<Params = unknown>(method: `_${string}`, params?: Params) {
    return this.ensureModel().notifyExtension(method, params)
  }

  /**
   * Forces cleanup of the connection and session.
   * Call this when you're done with the provider instance, especially when using `persistSession`.
   */
  cleanup(): void {
    for (const model of this.models) model.forceCleanup()
    this.models.clear()
    for (const subscriptions of this.eventListeners.values()) {
      for (const unsubscribe of subscriptions.values()) unsubscribe()
      subscriptions.clear()
    }
    this.model = null
  }
}

/**
 * Create an ACP provider instance
 *
 * @example
 * ```typescript
 * const provider = createACPProvider({
 *   command: "gemini",
 *   args: ["--experimental-acp"],
 *   session: { cwd: process.cwd(), mcpServers: [] },
 * });
 *
 * const result = await generateText({
 *   model: provider.languageModel(),
 * prompt: "Hello!"
 * });
 * ```
 */
export function createACPProvider(config: ACPProviderSettings): ACPProvider {
  return new ACPProvider(config)
}
