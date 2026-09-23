import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { AgentRegistryPersistenceService, AgentRegistryRecord } from "@cypheria/db"
import {
  type AGENT_CODEX_CLIENT_RPC,
  type AgentCatalogEntry,
  type AgentClaudeClientMessage,
  type AgentClaudeServerMessage,
  type AgentCodexClientNotification,
  type AgentCodexClientRequest,
  type AgentCodexClientResponse,
  type AgentCodexServerNotification,
  type AgentCodexServerRequest,
  type AgentCodexServerResponse,
  type AgentId,
  type AgentManagementClientMessage,
  type AgentOpenCodeClientMessage,
  type AgentOpenCodeServerMessage,
  type AgentOpenCodeV2Operation,
  type AgentOperation,
  type AgentPiClientMessage,
  type AgentPiServerMessage,
  type AgentView,
  type CodexAgentSettings,
  type HarnessSettingValue,
  isNativeAgentId,
  isRegistryAgentId,
  NATIVE_AGENT_IDS,
  type ServerMessage,
  type ToolchainId,
} from "@cypheria/protocol"
import type { AgentAcpClientMessage, AgentAcpServerMessage } from "@cypheria/protocol/acp-adapter"
import { ModelRuntime, type ModelRuntimeAuthOverrides } from "@earendil-works/pi-coding-agent"
import type { Logger } from "pino"
import type { ThreadHarnessAdapter } from "../thread/harness-adapter.js"
import {
  authenticateAcp,
  discoverAcpAuth,
  logoutAcp,
  probeAcpCatalog,
} from "./acp-catalog-probe.js"
import { AcpSessionRuntime } from "./acp-session-runtime.js"
import { AgentInstaller } from "./agent-installer.js"
import { type ClaudePermissionHandler, ClaudeSessionRuntime } from "./claude-session-runtime.js"
import { type CodexDynamicToolHandler, CodexDynamicToolRegistry } from "./codex-dynamic-tools.js"
import { CodexRuntime } from "./codex-runtime.js"
import { ManagedThreadAdapter } from "./managed-thread-adapter.js"
import { NATIVE_AGENT_MANIFEST } from "./native-agent-manifest.js"
import { OpenCodeRuntime } from "./opencode-runtime.js"
import { PiSessionRuntime } from "./pi-session-runtime.js"
import { AgentRegistryService } from "./registry-service.js"
import { getOrInitialize } from "./single-flight.js"
import { ToolchainManager } from "./toolchain-manager.js"

type Send = (message: ServerMessage) => void
type PiAuthType = Parameters<ModelRuntime["login"]>[1]
type PiAuthInteraction = Parameters<ModelRuntime["login"]>[2]
type PiCatalog = {
  credentials: Array<{ providerId: string; type: "api_key" | "oauth" }>
  models: Array<{
    api: string
    contextWindow: number
    id: string
    input: Array<"image" | "text">
    maxTokens: number
    name: string
    provider: string
    reasoning: boolean
    thinkingLevels: string[]
  }>
  providers: Array<{
    auth: { apiKey: string | null; oauth: string | null }
    id: string
    name: string
  }>
}

export type AgentRuntimeServerMessage =
  | AgentAcpServerMessage
  | AgentClaudeServerMessage
  | AgentCodexClientResponse
  | AgentCodexServerNotification
  | AgentCodexServerRequest
  | AgentOpenCodeServerMessage
  | AgentPiServerMessage

type RuntimeSend = (message: AgentRuntimeServerMessage) => void

export type AgentMessageContext = {
  requestClaudePermission?: ClaudePermissionHandler
  send: RuntimeSend
  sessionId: string
}

type AgentManagementContext = {
  send: Send
  sessionId: string
}

export type AgentManagerOptions = {
  cacheDir: string
  cypheriaHome: string
  persistence: AgentRegistryPersistenceService
  publish: Send
  logger?: Logger
  codexSettings?: () => CodexAgentSettings
  agentDefaults?: (agentId: AgentId) => Record<string, HarnessSettingValue>
  networkBootstrap?: boolean
  installer?: Pick<AgentInstaller, "cleanupInterrupted" | "install" | "readCurrent" | "uninstall">
}

export type AgentThreadCoordinator = {
  closeAgentThreads(agentId: AgentId): Promise<void>
  hasActiveThreads(agentId: AgentId): Promise<boolean>
  resumeAgentThreads(threadIds: readonly string[]): Promise<void>
  suspendAgentThreads(agentId: AgentId): Promise<string[]>
  waitForAgentTurns(agentId: AgentId, signal: AbortSignal): Promise<void>
}

const nativeCatalog = NATIVE_AGENT_MANIFEST

const isNewerReleaseVersion = (
  available: string | undefined,
  installed: string | null
): boolean => {
  if (!available || !installed) return false
  const parse = (value: string): readonly number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
    return match ? match.slice(1).map(Number) : undefined
  }
  const availableParts = parse(available)
  const installedParts = parse(installed)
  if (!availableParts || !installedParts) return false
  return availableParts.some(
    (part, index) =>
      part > (installedParts[index] ?? 0) &&
      availableParts.slice(0, index).every((value, prefix) => value === installedParts[prefix])
  )
}

export class AgentManager {
  readonly registry: AgentRegistryService
  readonly toolchains: ToolchainManager
  readonly codexDynamicTools = new CodexDynamicToolRegistry()
  readonly #acpRuntimes = new Map<string, Promise<AcpSessionRuntime>>()
  readonly #agentDefaults: (agentId: AgentId) => Record<string, HarnessSettingValue>
  readonly #agentHomes: string
  readonly #claudeRuntimes = new Map<string, Promise<ClaudeSessionRuntime>>()
  readonly #codexSettings: () => CodexAgentSettings
  readonly #installer: Pick<
    AgentInstaller,
    "cleanupInterrupted" | "install" | "readCurrent" | "uninstall"
  >
  readonly #openCode: OpenCodeRuntime
  readonly #piRuntimes = new Map<string, Promise<PiSessionRuntime>>()
  readonly #operations = new Map<string, AgentOperation>()
  readonly #operationControllers = new Map<string, AbortController>()
  readonly #operationQueues = new Map<string, Promise<void>>()
  readonly #persistence: AgentRegistryPersistenceService
  readonly #publish: Send
  readonly #records = new Map<AgentId, AgentRegistryRecord>()
  readonly #sessionStates = new Map<string, Set<AgentId>>()
  readonly #subscriptions = new Map<string, AbortController>()
  readonly #threadAdapters = new Map<string, ManagedThreadAdapter>()
  readonly #networkBootstrap: boolean
  readonly #logger: Logger | undefined
  readonly #maintenanceAgents = new Set<AgentId>()
  #catalogInvalidator: ((agentId?: AgentId) => void) | undefined
  #defaultsResolver:
    | ((agentId: AgentId) => Promise<Record<string, HarnessSettingValue>>)
    | undefined
  #codexRuntime: CodexRuntime | undefined
  #codexRuntimeInitialization: Promise<CodexRuntime> | undefined
  #piModelRuntime: Promise<ModelRuntime> | undefined
  #threadCoordinator: AgentThreadCoordinator | undefined
  #stopping = false

  constructor(options: AgentManagerOptions) {
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#networkBootstrap = options.networkBootstrap ?? true
    this.#logger = options.logger
    this.#agentDefaults = options.agentDefaults ?? (() => ({}))
    this.#codexSettings =
      options.codexSettings ??
      (() => ({
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: null,
        modelReasoningSummary: null,
        modelVerbosity: null,
        networkAccess: true,
        provider: "openai",
        reasoningEffort: null,
        sandboxMode: "workspace-write",
        serviceTier: null,
        showFullAccessInComposer: false,
        webSearch: null,
      }))
    this.#agentHomes = join(options.cypheriaHome, "agents")
    this.registry = new AgentRegistryService()
    this.toolchains = new ToolchainManager({
      cacheDir: options.cacheDir,
      cypheriaHome: options.cypheriaHome,
    })
    this.#installer =
      options.installer ??
      new AgentInstaller({
        cacheDir: options.cacheDir,
        cypheriaHome: options.cypheriaHome,
        toolchains: this.toolchains,
      })
    this.#openCode = new OpenCodeRuntime({
      cypheriaHome: options.cypheriaHome,
      toolchains: this.toolchains,
    })
  }

  async start(): Promise<void> {
    this.#stopping = false
    await this.toolchains.start()
    await this.#installer.cleanupInterrupted()
    await this.#persistence.reconcile(NATIVE_AGENT_IDS.map((id) => ({ id, native: true })))
    await this.#reloadRecords()
    if (this.#networkBootstrap) {
      void this.toolchains.bootstrapMissing().catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true
    for (const controller of this.#operationControllers.values()) controller.abort()
    await Promise.allSettled(this.#operationQueues.values())
    this.#operationControllers.clear()
    this.#maintenanceAgents.clear()
    for (const controller of this.#subscriptions.values()) controller.abort()
    this.#subscriptions.clear()
    const acpRuntimes = [...this.#acpRuntimes.values()]
    const claudeRuntimes = [...this.#claudeRuntimes.values()]
    const piRuntimes = [...this.#piRuntimes.values()]
    this.#acpRuntimes.clear()
    this.#claudeRuntimes.clear()
    this.#piRuntimes.clear()
    await Promise.allSettled([
      this.#openCode.stop(),
      this.#stopCodexRuntime(),
      ...acpRuntimes.map(async (runtime) => (await runtime).stop()),
      ...claudeRuntimes.map(async (runtime) => (await runtime).stop()),
      ...piRuntimes.map(async (runtime) => (await runtime).stop()),
    ])
    this.#piModelRuntime = undefined
    this.#threadAdapters.clear()
    this.#sessionStates.clear()
    this.codexDynamicTools.clear()
  }

  registerCodexDynamicTools(
    specs: readonly import("@cypheria/protocol/codex-types").v2.DynamicToolSpec[],
    handler: CodexDynamicToolHandler
  ): () => void {
    return this.codexDynamicTools.register(specs, handler)
  }

  async disposeSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}:`
    const runtimes = [...this.#acpRuntimes.entries()].filter(([key]) => key.startsWith(prefix))
    for (const [key] of runtimes) this.#acpRuntimes.delete(key)
    for (const [, runtime] of runtimes) {
      await (await runtime.catch(() => undefined))?.stop()
    }
    const claude = this.#claudeRuntimes.get(sessionId)
    this.#claudeRuntimes.delete(sessionId)
    if (claude) await (await claude.catch(() => undefined))?.stop()
    const pi = this.#piRuntimes.get(sessionId)
    this.#piRuntimes.delete(sessionId)
    if (pi) await (await pi.catch(() => undefined))?.stop()
    this.#codexRuntime?.detachSession(sessionId)
    for (const [key, controller] of this.#subscriptions) {
      if (key.startsWith(prefix)) {
        controller.abort()
        this.#subscriptions.delete(key)
      }
    }
    this.#sessionStates.delete(sessionId)
  }

  adapterFor(agentId: AgentId, threadId: string): ThreadHarnessAdapter {
    const key = `${agentId}:${threadId}`
    let adapter = this.#threadAdapters.get(key)
    if (!adapter) {
      adapter = new ManagedThreadAdapter(this, agentId)
      this.#threadAdapters.set(key, adapter)
    }
    return adapter
  }

  defaultsFor(agentId: AgentId): Record<string, HarnessSettingValue> {
    return this.#agentDefaults(agentId)
  }

  async validatedDefaultsFor(agentId: AgentId): Promise<Record<string, HarnessSettingValue>> {
    return this.#defaultsResolver?.(agentId) ?? this.defaultsFor(agentId)
  }

  releaseThreadAdapter(agentId: AgentId, threadId: string): void {
    this.#threadAdapters.delete(`${agentId}:${threadId}`)
  }

  async assertCallable(agentId: AgentId): Promise<void> {
    await this.#assertCallable(agentId)
  }

  setThreadCoordinator(coordinator: AgentThreadCoordinator): void {
    this.#threadCoordinator = coordinator
  }

  setCatalogInvalidator(invalidator: (agentId?: AgentId) => void): void {
    this.#catalogInvalidator = invalidator
  }

  setDefaultsResolver(
    resolver: (agentId: AgentId) => Promise<Record<string, HarnessSettingValue>>
  ): void {
    this.#defaultsResolver = resolver
  }

  async handleManagement(
    message: AgentManagementClientMessage,
    context: AgentManagementContext
  ): Promise<void> {
    const respond = (payload: unknown): void =>
      context.send({
        payload: { ok: true, value: payload },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ServerMessage)
    try {
      switch (message.type) {
        case "agent.list.request":
          respond({
            agents: await this.list(context.sessionId),
            availableAgents: this.availableAgents(),
          })
          break
        case "agent.add.request":
          respond(await this.add(message.payload.agentId, context.sessionId))
          break
        case "agent.remove.request":
          respond(await this.remove(message.payload.agentId))
          break
        case "agent.get.request":
          respond(await this.get(message.payload.agentId, context.sessionId))
          break
        case "agent.install.request":
          respond(this.#submitAgentOperation("install", message.payload.agentId, context.sessionId))
          break
        case "agent.update.request":
          respond(this.#submitAgentOperation("update", message.payload.agentId, context.sessionId))
          break
        case "agent.uninstall.request":
          respond(
            this.#submitAgentOperation("uninstall", message.payload.agentId, context.sessionId)
          )
          break
        case "agent.enable.request":
          respond(await this.setEnabled(message.payload.agentId, true, context.sessionId))
          break
        case "agent.disable.request":
          respond(await this.setEnabled(message.payload.agentId, false, context.sessionId))
          break
        case "agent.start.request":
          respond(await this.startAgent(message.payload.agentId, context.sessionId))
          break
        case "agent.stop.request":
          respond(
            await this.stopAgent(message.payload.agentId, context.sessionId, message.payload.force)
          )
          break
        case "agent.operation.get.request": {
          const operation = this.#operations.get(message.payload.operationId)
          if (!operation)
            throw this.#error("AGENT_OPERATION_NOT_FOUND", "Agent operation was not found")
          respond(operation)
          break
        }
        case "agent.operation.list.request":
          respond({ operations: [...this.#operations.values()] })
          break
        case "agent.toolchain.list.request":
          respond({ toolchains: this.toolchains.list() })
          break
        case "agent.toolchain.check_updates.request":
          respond({ toolchains: await this.toolchains.checkUpdates() })
          break
        case "agent.toolchain.update.request":
          respond(this.#submitToolchainOperation(message.payload.toolchain))
          break
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      context.send({
        payload: {
          error: { code: failure.name || "AGENT_ERROR", message: failure.message },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ServerMessage)
    }
  }

  async handleAcp(message: AgentAcpClientMessage, context: AgentMessageContext): Promise<void> {
    await this.#assertCallable(message.agent)
    const key = `${context.sessionId}:${message.agent}`
    const pending = getOrInitialize(this.#acpRuntimes, key, async () => {
      const receipt = await this.#installer.readCurrent(message.agent)
      if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${message.agent} is not installed`)
      return new AcpSessionRuntime({
        agent: message.agent,
        receipt,
        send: context.send,
        toolchains: this.toolchains,
        logger: this.#logger?.child({ agentId: message.agent, sessionId: context.sessionId }),
      })
    })
    const runtime = await pending
    if (this.#acpRuntimes.get(key) !== pending) return
    this.#markSessionRunning(context.sessionId, message.agent)
    runtime.send(message)
  }

  async handleOpenCode(
    message: AgentOpenCodeClientMessage,
    context: AgentMessageContext
  ): Promise<void> {
    await this.#assertCallable("opencode")
    if (!this.#openCode.running) await this.startAgent("opencode", context.sessionId)
    if (message.type === "agent.opencode.call.request") {
      const result = await this.#openCode.call(message.payload)
      context.send({
        payload: result.ok
          ? { data: result.data as never, headers: result.headers, ok: true, status: result.status }
          : {
              error: result.error as never,
              headers: result.headers,
              ok: false,
              status: result.status,
            },
        requestId: message.requestId,
        type: "agent.opencode.call.response",
      })
      return
    }
    if (message.type === "agent.opencode.event.cancel.request") {
      const key = `${context.sessionId}:${message.payload.subscriptionId}`
      this.#subscriptions.get(key)?.abort()
      this.#subscriptions.delete(key)
      return
    }
    const key = `${context.sessionId}:${message.payload.subscriptionId}`
    if (this.#subscriptions.has(key))
      throw this.#error("AGENT_BUSY", "OpenCode subscription already exists")
    const controller = new AbortController()
    this.#subscriptions.set(key, controller)
    context.send({
      payload: { subscriptionId: message.payload.subscriptionId },
      requestId: message.requestId,
      type: "agent.opencode.event.subscribe.response",
    })
    void this.#pumpOpenCodeEvents(
      message.payload.stream,
      message.payload.subscriptionId,
      key,
      controller,
      context.send
    )
  }

  async handleCodex(
    message: AgentCodexClientRequest | AgentCodexServerResponse | AgentCodexClientNotification,
    context: AgentMessageContext
  ): Promise<void> {
    await this.#assertCallable("codex")
    const runtime = await this.#ensureCodexRuntime()
    await runtime.send(context.sessionId, context.send, message)
    this.#markSessionRunning(context.sessionId, "codex")
  }

  async callCodex(
    method: keyof typeof AGENT_CODEX_CLIENT_RPC,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.#assertCallable("codex")
    return (await this.#ensureCodexRuntime()).request(method, params)
  }

  async rejectCodexReverse(sessionId: string, requestId: string, message: string): Promise<void> {
    await this.#assertCallable("codex")
    const runtime = await this.#ensureCodexRuntime()
    runtime.rejectReverse(sessionId, requestId, message)
  }

  async waitForCodexLogin(loginId: string, signal: AbortSignal) {
    return (await this.#ensureCodexRuntime()).waitForLogin(loginId, signal)
  }

  async callOpenCode(
    operation: AgentOpenCodeV2Operation,
    options: { body?: unknown } = {}
  ): Promise<{ data?: unknown; error?: unknown; ok: boolean; status: number }> {
    await this.#assertCallable("opencode")
    if (!this.#openCode.running) await this.startAgent("opencode", "harness-settings")
    return this.#openCode.call({
      body: options.body as never,
      operation,
    })
  }

  async verifyOpenCodeConnection(providerId: string): Promise<void> {
    await this.#assertCallable("opencode")
    if (!this.#openCode.running) await this.startAgent("opencode", "harness-settings")
    await this.#openCode.verifyProvider(providerId)
  }

  async getPiCatalog(): Promise<PiCatalog> {
    await this.#assertCallable("pi")
    const runtime = await this.#ensurePiModelRuntime()
    const credentials = await runtime.listCredentials()
    return {
      credentials: credentials.map((credential) => ({ ...credential })),
      models: runtime.getModels().map((model) => ({
        api: model.api,
        contextWindow: model.contextWindow,
        id: model.id,
        input: [...model.input],
        maxTokens: model.maxTokens,
        name: model.name,
        provider: model.provider,
        reasoning: model.reasoning,
        thinkingLevels: model.thinkingLevelMap
          ? Object.entries(model.thinkingLevelMap)
              .filter(([, value]) => value !== null)
              .map(([id]) => id)
          : [],
      })),
      providers: runtime.getProviders().map((provider) => ({
        auth: {
          apiKey: provider.auth.apiKey?.login ? provider.auth.apiKey.name : null,
          oauth: provider.auth.oauth
            ? (provider.auth.oauth.loginLabel ?? provider.auth.oauth.name)
            : null,
        },
        id: provider.id,
        name: provider.name,
      })),
    }
  }

  async getClaudeCatalog() {
    await this.#assertCallable("claude")
    const runtime = new ClaudeSessionRuntime({
      home: join(this.#agentHomes, "claude", "home"),
      receipt: await this.#requiredReceipt("claude"),
      send: () => undefined,
      toolchains: this.toolchains,
    })
    return runtime.discover()
  }

  async discoverAcpAuth(agentId: AgentId, signal: AbortSignal) {
    if (!isRegistryAgentId(agentId))
      throw this.#error("AGENT_NOT_FOUND", `${agentId} is not an ACP agent`)
    await this.#assertCallable(agentId)
    return discoverAcpAuth({
      receipt: await this.#requiredReceipt(agentId),
      signal,
      toolchains: this.toolchains,
    })
  }

  async probeAcpCatalog(agentId: AgentId, signal: AbortSignal) {
    if (!isRegistryAgentId(agentId))
      throw this.#error("AGENT_NOT_FOUND", `${agentId} is not an ACP agent`)
    await this.#assertCallable(agentId)
    return probeAcpCatalog({
      receipt: await this.#requiredReceipt(agentId),
      signal,
      toolchains: this.toolchains,
    })
  }

  async authenticateAcp(agentId: AgentId, methodId: string, signal: AbortSignal): Promise<void> {
    if (!isRegistryAgentId(agentId)) {
      throw this.#error("AGENT_NOT_FOUND", `${agentId} is not an ACP agent`)
    }
    await this.#assertCallable(agentId)
    await authenticateAcp({
      methodId,
      receipt: await this.#requiredReceipt(agentId),
      signal,
      toolchains: this.toolchains,
    })
  }

  async logoutAcp(agentId: AgentId, signal: AbortSignal): Promise<void> {
    const receipt = await this.#requiredReceipt(agentId)
    await logoutAcp({
      receipt,
      signal,
      toolchains: this.toolchains,
    })
  }

  async authTerminalSpec(
    agentId: AgentId,
    args: string[],
    extraEnvironment: Record<string, string> = {}
  ): Promise<{ args: string[]; command: string; cwd: string; env: Record<string, string> }> {
    const receipt = await this.#requiredReceipt(agentId)
    const rawEnvironment = this.toolchains.environment({
      ...receipt.environment,
      ...extraEnvironment,
      ...(agentId === "claude"
        ? { CLAUDE_CONFIG_DIR: join(this.#agentHomes, "claude", "home") }
        : {}),
    })
    return {
      args: [...receipt.args, ...args],
      command: receipt.command,
      cwd: receipt.workingDirectory ?? process.cwd(),
      env: Object.fromEntries(
        Object.entries(rawEnvironment).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      ),
    }
  }

  async logoutClaude(): Promise<void> {
    const spec = await this.authTerminalSpec("claude", ["auth", "logout"])
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      })
      const errors: Buffer[] = []
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk))
      child.once("error", reject)
      child.once("exit", (code) => {
        if (code === 0) resolve()
        else reject(new Error(Buffer.concat(errors).toString("utf8") || `Claude exited ${code}`))
      })
    })
  }

  async verifyPiConnection(providerId: string): Promise<void> {
    const runtime = await this.#ensurePiModelRuntime()
    const model = runtime.getModels(providerId)[0]
    if (!model) throw new Error("This provider does not expose a model for credential testing")
    const result = await runtime.completeSimple(
      model,
      {
        messages: [{ content: "Reply with OK.", role: "user", timestamp: Date.now() }],
      },
      {
        maxRetries: 0,
        maxTokens: 1,
        signal: AbortSignal.timeout(30_000),
      }
    )
    if (result.stopReason === "error" || result.errorMessage) {
      throw new Error(result.errorMessage ?? "The provider rejected the credential")
    }
  }

  async loginPi(
    providerId: string,
    type: PiAuthType,
    interaction: PiAuthInteraction
  ): Promise<void> {
    await (await this.#ensurePiModelRuntime()).login(providerId, type, interaction)
  }

  async logoutPi(providerId: string, options?: ModelRuntimeAuthOverrides): Promise<void> {
    await (await this.#ensurePiModelRuntime()).logout(providerId, options)
  }

  async handleClaude(
    message: AgentClaudeClientMessage,
    context: AgentMessageContext
  ): Promise<void> {
    await this.#assertCallable("claude")
    const pending = getOrInitialize(this.#claudeRuntimes, context.sessionId, async () => {
      const receipt = await this.#requiredReceipt("claude")
      return new ClaudeSessionRuntime({
        home: join(this.#agentHomes, "claude", "home"),
        receipt,
        requestPermission: context.requestClaudePermission,
        send: context.send,
        toolchains: this.toolchains,
      })
    })
    const runtime = await pending
    if (this.#claudeRuntimes.get(context.sessionId) !== pending) return
    await runtime.send(message)
    this.#markSessionRunning(context.sessionId, "claude")
  }

  async handlePi(message: AgentPiClientMessage, context: AgentMessageContext): Promise<void> {
    await this.#assertCallable("pi")
    const pending = getOrInitialize(this.#piRuntimes, context.sessionId, async () => {
      const receipt = await this.#requiredReceipt("pi")
      return new PiSessionRuntime({
        home: join(this.#agentHomes, "pi", "home"),
        receipt,
        send: context.send,
        toolchains: this.toolchains,
        logger: this.#logger?.child({ agentId: "pi", sessionId: context.sessionId }),
      })
    })
    const runtime = await pending
    if (this.#piRuntimes.get(context.sessionId) !== pending) return
    await runtime.send(message)
    this.#markSessionRunning(context.sessionId, "pi")
  }

  async list(sessionId: string): Promise<AgentView[]> {
    const ids = [...this.#records.keys()]
    return Promise.all(ids.map((id) => this.get(id, sessionId)))
  }

  availableAgents(): AgentCatalogEntry[] {
    const entries: AgentCatalogEntry[] = []
    for (const agentId of NATIVE_AGENT_IDS) {
      if (this.#records.has(agentId)) continue
      const agent = nativeCatalog[agentId]
      entries.push({
        description: agent.description,
        icon: agent.icon,
        id: agentId,
        name: agent.name,
        native: true,
        version: agent.cliVersion,
      })
    }
    for (const agent of this.registry.entries) {
      const agentId = agent.id
      if (this.#records.has(agentId)) continue
      entries.push({
        description: agent.description,
        icon: agent.icon ?? null,
        id: agentId,
        name: agent.name,
        native: false,
        version: agent.version,
      })
    }
    return entries
  }

  async add(agentId: AgentId, sessionId: string): Promise<AgentView> {
    if (this.#records.has(agentId)) return this.get(agentId, sessionId)
    const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
    const entry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
    const catalog = native ?? entry
    if (!catalog) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    const record = await this.#persistence.register(agentId, Boolean(native), {
      description: catalog.description,
      icon: catalog.icon ?? null,
      name: catalog.name,
      repository: catalog.repository ?? null,
      website: catalog.website ?? null,
    })
    this.#records.set(agentId, record)
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.updated.notification" })
    return view
  }

  async remove(agentId: AgentId): Promise<{ agentId: AgentId }> {
    this.#assertNoAgentOperation(agentId)
    const record = this.#records.get(agentId)
    if (!record) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    if (record.installed) {
      throw this.#error("AGENT_INSTALLED", `Uninstall ${agentId} before removing it`)
    }
    if (!(await this.#persistence.remove(agentId))) {
      throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    }
    this.#records.delete(agentId)
    this.#catalogInvalidator?.(agentId)
    return { agentId }
  }

  async get(agentId: AgentId, _sessionId: string): Promise<AgentView> {
    const record = this.#records.get(agentId)
    if (!record) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
    const entry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
    const latestVersion = native?.cliVersion ?? entry?.version ?? null
    const version = record.version ?? latestVersion
    if (!version) throw this.#error("AGENT_VERSION_UNAVAILABLE", `${agentId} has no known version`)
    const running =
      agentId === "opencode"
        ? this.#openCode.running
        : agentId === "codex"
          ? (this.#codexRuntime?.running ?? false)
          : [...this.#sessionStates.values()].some((agents) => agents.has(agentId))
    const receipt = await this.#installer.readCurrent(agentId)
    return {
      id: agentId,
      name: record.name ?? native?.name ?? entry?.name ?? agentId,
      version,
      description:
        record.description ??
        native?.description ??
        entry?.description ??
        "Registry agent is no longer available",
      repository: record.repository ?? native?.repository ?? entry?.repository ?? null,
      website: record.website ?? native?.website ?? entry?.website ?? null,
      icon: record.icon ?? native?.icon ?? entry?.icon ?? null,
      native: record.native,
      installed: record.installed,
      enabled: record.enabled,
      available: Boolean(native || entry),
      availableVersion: latestVersion,
      runtimeScope: native?.runtimeScope ?? "thread",
      runtimeState: running ? "running" : "stopped",
      integrity: receipt?.integrity ?? "not-applicable",
      installation: receipt ? { kind: receipt.kind, source: receipt.source } : null,
    }
  }

  async setEnabled(agentId: AgentId, enabled: boolean, sessionId: string): Promise<AgentView> {
    this.#assertNoAgentOperation(agentId)
    const record = this.#records.get(agentId)
    if (!record?.installed) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    if (!enabled) {
      await this.#threadCoordinator?.closeAgentThreads(agentId)
      await this.#stopEverywhere(agentId)
    }
    const updated = await this.#persistence.setEnabled(agentId, enabled)
    if (!updated) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    this.#records.set(agentId, updated)
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.updated.notification" })
    return view
  }

  async startAgent(agentId: AgentId, sessionId: string): Promise<AgentView> {
    await this.#assertCallable(agentId)
    const receipt = await this.#installer.readCurrent(agentId)
    if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    if (agentId === "opencode") await this.#openCode.start(receipt)
    else if (agentId === "codex") await (await this.#ensureCodexRuntime()).start()
    else this.#markSessionRunning(sessionId, agentId)
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.updated.notification" })
    return view
  }

  async stopAgent(agentId: AgentId, sessionId: string, force = false): Promise<AgentView> {
    if (this.#threadCoordinator && (await this.#threadCoordinator.hasActiveThreads(agentId))) {
      if (!force) {
        throw this.#error("AGENT_HAS_ACTIVE_THREADS", `${agentId} has active threads`)
      }
      await this.#threadCoordinator.closeAgentThreads(agentId)
    }
    await this.#stopEverywhere(agentId)
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.updated.notification" })
    return view
  }

  #submitAgentOperation(
    kind: "install" | "update" | "uninstall",
    agentId: AgentId,
    sessionId: string
  ): AgentOperation {
    const registered = this.#records.get(agentId)
    if (!registered) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    this.#assertNoAgentOperation(agentId)
    const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
    const registryEntry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
    if (kind !== "uninstall" && !native && !registryEntry) {
      throw this.#error(
        "AGENT_RELEASE_UNAVAILABLE",
        `${agentId} is not available in this Cypheria release`
      )
    }
    if (kind === "update") {
      if (!registered.installed) {
        throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
      }
      const availableVersion = native?.cliVersion ?? registryEntry?.version
      if (!isNewerReleaseVersion(availableVersion, registered.version)) {
        throw this.#error(
          "AGENT_UPDATE_UNAVAILABLE",
          `No approved update is available for ${agentId}`
        )
      }
    }
    return this.#submit(
      kind,
      { agentId, kind: "agent" },
      `agent:${agentId}`,
      async (progress, signal) => {
        if (kind === "uninstall") {
          progress("Stopping agent", 0.2)
          await this.#threadCoordinator?.closeAgentThreads(agentId)
          await this.#stopEverywhere(agentId)
          progress("Removing managed runtime", 0.6)
          await this.#installer.uninstall(agentId)
          const updated = await this.#persistence.setInstalled(agentId, false)
          if (updated) this.#records.set(agentId, updated)
          await this.#reloadRecords()
          this.#catalogInvalidator?.(agentId)
          return
        }
        const record = this.#records.get(agentId)
        if (kind === "install" && record?.installed) {
          throw this.#error("AGENT_ALREADY_INSTALLED", `${agentId} is already installed`)
        }
        if (kind === "update" && !record?.installed) {
          throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
        }
        const wasRunning =
          kind === "update" && (await this.get(agentId, sessionId)).runtimeState === "running"
        let suspendedThreadIds: string[] = []
        let updatePrepared = false
        try {
          if (kind === "update") {
            this.#maintenanceAgents.add(agentId)
            progress("Waiting for active turns", 0.05)
            await this.#threadCoordinator?.waitForAgentTurns(agentId, signal)
            if (signal.aborted) throw new Error("Agent update was interrupted")
            suspendedThreadIds = (await this.#threadCoordinator?.suspendAgentThreads(agentId)) ?? []
            updatePrepared = true
            await this.#stopEverywhere(agentId)
          }
          progress(null, 0.1)
          const entry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
          const receipt = await this.#installer.install(agentId, entry, {
            onProgress: (value) => progress(null, 0.1 + value * 0.75),
            signal,
          })
          progress(null, 0.9)
          const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
          const updated = await this.#persistence.setVersion(agentId, {
            description: native?.description ?? entry?.description ?? agentId,
            icon: native?.icon ?? entry?.icon ?? null,
            name: native?.name ?? entry?.name ?? agentId,
            repository: native?.repository ?? entry?.repository ?? null,
            version: receipt.version,
            website: native?.website ?? entry?.website ?? null,
          })
          if (!updated) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
          this.#records.set(agentId, updated)
          if (kind === "install") {
            const enabled = await this.#persistence.setEnabled(agentId, true)
            if (!enabled) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
            this.#records.set(agentId, enabled)
          }
          const view = await this.get(agentId, sessionId)
          this.#catalogInvalidator?.(agentId)
          this.#publish({ payload: view, type: "agent.updated.notification" })
        } finally {
          if (kind === "update") {
            this.#maintenanceAgents.delete(agentId)
            if (!this.#stopping && updatePrepared) {
              if (suspendedThreadIds.length > 0) {
                await this.#threadCoordinator?.resumeAgentThreads(suspendedThreadIds)
              } else if (wasRunning && this.#records.get(agentId)?.enabled) {
                await this.startAgent(agentId, sessionId)
              }
            }
          }
        }
      }
    )
  }

  #submitToolchainOperation(toolchain: ToolchainId): AgentOperation {
    const release = this.toolchains.list().find(({ id }) => id === toolchain)
    if (!release?.updateAvailable) {
      throw this.#error(
        "TOOLCHAIN_UPDATE_UNAVAILABLE",
        `${toolchain} already matches the approved release`
      )
    }
    return this.#submit(
      "toolchain-update",
      { kind: "toolchain", toolchain },
      `toolchain:${toolchain}`,
      async (progress) => {
        progress(`Updating ${toolchain}`, 0.2)
        await this.toolchains.update(toolchain)
        progress(`Activated ${toolchain}`, 0.9)
      }
    )
  }

  #submit(
    kind: AgentOperation["kind"],
    target: AgentOperation["target"],
    queueKey: string,
    task: (
      progress: (message: string | null, value: number) => void,
      signal: AbortSignal
    ) => Promise<void>
  ): AgentOperation {
    const operation: AgentOperation = {
      completedAt: null,
      error: null,
      id: `aop_${randomUUID()}`,
      kind,
      message: null,
      progress: 0,
      startedAt: null,
      status: "queued",
      submittedAt: new Date().toISOString(),
      target,
    }
    this.#operations.set(operation.id, operation)
    const controller = new AbortController()
    this.#operationControllers.set(operation.id, controller)
    const previous = this.#operationQueues.get(queueKey) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        operation.status = "running"
        operation.startedAt = new Date().toISOString()
        this.#notifyOperation(operation, "agent.operation.progress.notification")
        try {
          controller.signal.throwIfAborted()
          await task((message, value) => {
            operation.message = message
            operation.progress = value
            this.#notifyOperation(operation, "agent.operation.progress.notification")
          }, controller.signal)
          operation.status = "succeeded"
          operation.progress = 1
          operation.completedAt = new Date().toISOString()
          this.#notifyOperation(operation, "agent.operation.completed.notification")
        } catch (error) {
          operation.status = "failed"
          operation.error = error instanceof Error ? error.message : String(error)
          operation.completedAt = new Date().toISOString()
          this.#notifyOperation(operation, "agent.operation.failed.notification")
        }
      })
    this.#operationQueues.set(queueKey, current)
    void current.finally(() => {
      this.#operationControllers.delete(operation.id)
      if (this.#operationQueues.get(queueKey) === current) this.#operationQueues.delete(queueKey)
      this.#pruneOperations()
    })
    return operation
  }

  async #assertCallable(agentId: AgentId): Promise<void> {
    if (this.#stopping || this.#maintenanceAgents.has(agentId)) {
      throw this.#error("AGENT_MAINTENANCE", `${agentId} is being updated`)
    }
    const record = this.#records.get(agentId)
    if (!record?.installed) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    if (!record.enabled) throw this.#error("AGENT_DISABLED", `${agentId} is disabled`)
  }

  async #stopEverywhere(agentId: AgentId): Promise<void> {
    if (agentId === "opencode") await this.#openCode.stop()
    if (agentId === "codex") await this.#stopCodexRuntime()
    if (agentId === "claude") {
      const runtimes = [...this.#claudeRuntimes.values()]
      this.#claudeRuntimes.clear()
      for (const runtime of runtimes) {
        await (await runtime.catch(() => undefined))?.stop()
      }
    }
    if (agentId === "pi") {
      const runtimes = [...this.#piRuntimes.values()]
      this.#piRuntimes.clear()
      for (const runtime of runtimes) {
        await (await runtime.catch(() => undefined))?.stop()
      }
    }
    const matches = [...this.#acpRuntimes.entries()].filter(([key]) => key.endsWith(`:${agentId}`))
    for (const [key] of matches) this.#acpRuntimes.delete(key)
    for (const [, runtime] of matches) {
      await (await runtime.catch(() => undefined))?.stop()
    }
    for (const agents of this.#sessionStates.values()) agents.delete(agentId)
  }

  async #pumpOpenCodeEvents(
    stream: "event",
    subscriptionId: string,
    key: string,
    controller: AbortController,
    send: RuntimeSend
  ): Promise<void> {
    try {
      for await (const event of this.#openCode.events(stream)) {
        if (controller.signal.aborted) break
        send({
          payload: { event: event as never, subscriptionId },
          type: "agent.opencode.event.notification",
        })
      }
      if (!controller.signal.aborted)
        send({ payload: { subscriptionId }, type: "agent.opencode.event.complete.notification" })
    } catch (error) {
      if (!controller.signal.aborted)
        send({
          payload: {
            message: error instanceof Error ? error.message : String(error),
            subscriptionId,
          },
          type: "agent.opencode.event.error.notification",
        })
    } finally {
      this.#subscriptions.delete(key)
    }
  }

  #markSessionRunning(sessionId: string, agentId: AgentId): void {
    const agents = this.#sessionStates.get(sessionId) ?? new Set<AgentId>()
    agents.add(agentId)
    this.#sessionStates.set(sessionId, agents)
  }

  async #stopCodexRuntime(): Promise<void> {
    const runtime =
      (await this.#codexRuntimeInitialization?.catch(() => undefined)) ?? this.#codexRuntime
    this.#codexRuntime = undefined
    await runtime?.stop()
  }

  async #ensureCodexRuntime(): Promise<CodexRuntime> {
    if (this.#codexRuntimeInitialization) return this.#codexRuntimeInitialization
    if (this.#codexRuntime) return this.#codexRuntime
    const initialization = (async () => {
      const runtime = new CodexRuntime({
        codexHome: join(this.#agentHomes, "..", "codex"),
        receipt: await this.#requiredReceipt("codex"),
        toolchains: this.toolchains,
        logger: this.#logger?.child({ agentId: "codex" }),
      })
      try {
        const settings = this.#codexSettings()
        await runtime.request("config/batchWrite", {
          edits: [
            { keyPath: "model_provider", mergeStrategy: "replace", value: settings.provider },
            { keyPath: "model", mergeStrategy: "replace", value: settings.model },
            {
              keyPath: "model_reasoning_effort",
              mergeStrategy: "replace",
              value: settings.reasoningEffort,
            },
            { keyPath: "service_tier", mergeStrategy: "replace", value: settings.serviceTier },
            {
              keyPath: "approval_policy",
              mergeStrategy: "replace",
              value: settings.approvalPolicy,
            },
            {
              keyPath: "approvals_reviewer",
              mergeStrategy: "replace",
              value: settings.approvalsReviewer,
            },
            {
              keyPath: "sandbox_mode",
              mergeStrategy: "replace",
              value: settings.sandboxMode,
            },
            {
              keyPath: "sandbox_workspace_write.network_access",
              mergeStrategy: "replace",
              value: settings.networkAccess,
            },
            { keyPath: "web_search", mergeStrategy: "replace", value: settings.webSearch },
            {
              keyPath: "model_verbosity",
              mergeStrategy: "replace",
              value: settings.modelVerbosity,
            },
            {
              keyPath: "model_reasoning_summary",
              mergeStrategy: "replace",
              value: settings.modelReasoningSummary,
            },
            {
              keyPath: "desktop.showFullAccessInComposer",
              mergeStrategy: "replace",
              value: settings.showFullAccessInComposer,
            },
          ],
          reloadUserConfig: true,
        })
        this.#codexRuntime = runtime
        return runtime
      } catch (error) {
        await runtime.stop()
        throw error
      }
    })()
    this.#codexRuntimeInitialization = initialization
    try {
      return await initialization
    } finally {
      if (this.#codexRuntimeInitialization === initialization) {
        this.#codexRuntimeInitialization = undefined
      }
    }
  }

  #ensurePiModelRuntime(): Promise<ModelRuntime> {
    if (this.#piModelRuntime) return this.#piModelRuntime
    const pending = ModelRuntime.create({
      allowModelNetwork: false,
      authPath: join(this.#agentHomes, "pi", "home", "auth.json"),
      modelsPath: join(this.#agentHomes, "pi", "home", "models.json"),
      refreshOnCreate: false,
    })
    this.#piModelRuntime = pending
    void pending.catch(() => {
      if (this.#piModelRuntime === pending) this.#piModelRuntime = undefined
    })
    return this.#piModelRuntime
  }

  async #requiredReceipt(agentId: AgentId) {
    const receipt = await this.#installer.readCurrent(agentId)
    if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    return receipt
  }

  #notifyOperation(
    operation: AgentOperation,
    type:
      | "agent.operation.progress.notification"
      | "agent.operation.completed.notification"
      | "agent.operation.failed.notification"
  ): void {
    this.#publish({ payload: { ...operation }, type })
  }

  async #reloadRecords(): Promise<void> {
    this.#records.clear()
    for (const record of await this.#persistence.list())
      this.#records.set(record.id as AgentId, record)
  }

  #pruneOperations(): void {
    const completed = [...this.#operations.values()].filter(
      ({ status }) => status === "failed" || status === "succeeded"
    )
    if (completed.length <= 200) return
    completed.sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
    for (const operation of completed.slice(0, completed.length - 200))
      this.#operations.delete(operation.id)
  }

  #assertNoAgentOperation(agentId: AgentId): void {
    if (this.#operationQueues.has(`agent:${agentId}`)) {
      throw this.#error(
        "AGENT_OPERATION_IN_PROGRESS",
        `${agentId} has a lifecycle operation in progress`
      )
    }
  }

  #error(code: string, message: string): Error {
    const error = new Error(message)
    error.name = code
    return error
  }
}
