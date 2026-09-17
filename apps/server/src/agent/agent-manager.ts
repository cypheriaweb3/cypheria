import { randomUUID } from "node:crypto"
import { join } from "node:path"

import type { AgentRegistryPersistenceService, AgentRegistryRecord } from "@cypheria/db"
import {
  type AgentAcpClientMessage,
  type AgentClaudeClientMessage,
  type AgentCodexClientNotification,
  type AgentCodexClientRequest,
  type AgentCodexServerResponse,
  type AgentId,
  type AgentManagementClientMessage,
  type AgentOpenCodeClientMessage,
  type AgentOperation,
  type AgentPiClientMessage,
  type AgentView,
  isNativeAgentId,
  isRegistryAgentId,
  NATIVE_AGENT_IDS,
  REGISTRY_AGENT_IDS,
  type ServerMessage,
  type ToolchainId,
} from "@cypheria/protocol"

import { AcpSessionRuntime } from "./acp-session-runtime.js"
import { AgentInstaller } from "./agent-installer.js"
import { ClaudeSessionRuntime } from "./claude-session-runtime.js"
import { CodexRuntime } from "./codex-runtime.js"
import { OpenCodeRuntime } from "./opencode-runtime.js"
import { PiSessionRuntime } from "./pi-session-runtime.js"
import { AgentRegistryService } from "./registry-service.js"
import { ToolchainManager } from "./toolchain-manager.js"

type Send = (message: ServerMessage) => void

export type AgentMessageContext = {
  send: Send
  sessionId: string
}

export type AgentManagerOptions = {
  cacheDir: string
  cypheriaHome: string
  persistence: AgentRegistryPersistenceService
  publish: Send
  networkBootstrap?: boolean
}

const nativeCatalog: Record<
  (typeof NATIVE_AGENT_IDS)[number],
  {
    description: string
    icon: string | null
    name: string
    repository: string
    runScope: "session" | "shared"
    version: string
    website: string
  }
> = {
  claude: {
    description:
      "Claude Code is an agentic coding tool that reads codebases, edits files, runs commands, and integrates with development tools.",
    icon: null,
    name: "Claude Code",
    repository: "https://github.com/anthropics/claude-code",
    runScope: "session",
    version: "2.1.274",
    website: "https://code.claude.com/docs/en/overview",
  },
  codex: {
    description: "Codex is a coding agent from OpenAI that runs locally on your computer.",
    icon: null,
    name: "Codex",
    repository: "https://github.com/openai/codex",
    runScope: "shared",
    version: "0.153.4",
    website: "https://developers.openai.com/codex/",
  },
  opencode: {
    description:
      "OpenCode is an open source agent that helps you write code in your terminal, IDE, or desktop.",
    icon: null,
    name: "OpenCode",
    repository: "https://github.com/anomalyco/opencode",
    runScope: "shared",
    version: "1.18.30",
    website: "https://opencode.ai",
  },
  pi: {
    description: "Pi is a minimal agent harness that adapts to your workflows.",
    icon: null,
    name: "Pi",
    repository: "https://github.com/earendil-works/pi",
    runScope: "session",
    version: "0.85.1",
    website: "https://pi.dev",
  },
}

export class AgentManager {
  readonly registry: AgentRegistryService
  readonly toolchains: ToolchainManager
  readonly #acpRuntimes = new Map<string, AcpSessionRuntime>()
  readonly #agentHomes: string
  readonly #claudeRuntimes = new Map<string, ClaudeSessionRuntime>()
  readonly #installer: AgentInstaller
  readonly #openCode: OpenCodeRuntime
  readonly #piRuntimes = new Map<string, PiSessionRuntime>()
  readonly #operations = new Map<string, AgentOperation>()
  readonly #operationQueues = new Map<string, Promise<void>>()
  readonly #persistence: AgentRegistryPersistenceService
  readonly #publish: Send
  readonly #records = new Map<AgentId, AgentRegistryRecord>()
  readonly #sessionStates = new Map<string, Set<AgentId>>()
  readonly #subscriptions = new Map<string, AbortController>()
  readonly #networkBootstrap: boolean
  #codexRuntime: CodexRuntime | undefined

  constructor(options: AgentManagerOptions) {
    this.#persistence = options.persistence
    this.#publish = options.publish
    this.#networkBootstrap = options.networkBootstrap ?? true
    this.#agentHomes = join(options.cypheriaHome, "agents")
    this.registry = new AgentRegistryService({
      cypheriaHome: options.cypheriaHome,
      onUpdate: (state) =>
        this.#publish({ payload: state, type: "agent.registry.updated.notification" }),
    })
    this.toolchains = new ToolchainManager({
      cacheDir: options.cacheDir,
      cypheriaHome: options.cypheriaHome,
    })
    this.#installer = new AgentInstaller({
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
    await this.toolchains.start()
    await this.registry.start({ refresh: this.#networkBootstrap })
    await this.#persistence.reconcile([
      ...NATIVE_AGENT_IDS.map((id) => ({ id, native: true })),
      ...REGISTRY_AGENT_IDS.map((id) => ({ id, native: false })),
    ])
    await this.#reloadRecords()
    await this.#collectPythonEnvironments()
    if (this.#networkBootstrap) {
      this.toolchains.startAutomaticUpdateChecks()
      void this.toolchains.bootstrapMissing().catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    this.registry.stop()
    this.toolchains.stop()
    for (const controller of this.#subscriptions.values()) controller.abort()
    this.#subscriptions.clear()
    await Promise.allSettled([
      this.#openCode.stop(),
      this.#codexRuntime?.stop(),
      ...[...this.#acpRuntimes.values()].map((runtime) => runtime.stop()),
      ...[...this.#claudeRuntimes.values()].map((runtime) => runtime.stop()),
      ...[...this.#piRuntimes.values()].map((runtime) => runtime.stop()),
    ])
    this.#acpRuntimes.clear()
    this.#claudeRuntimes.clear()
    this.#piRuntimes.clear()
    this.#codexRuntime = undefined
    this.#sessionStates.clear()
  }

  async disposeSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}:`
    const runtimes = [...this.#acpRuntimes.entries()].filter(([key]) => key.startsWith(prefix))
    for (const [key, runtime] of runtimes) {
      this.#acpRuntimes.delete(key)
      await runtime.stop()
    }
    const claude = this.#claudeRuntimes.get(sessionId)
    this.#claudeRuntimes.delete(sessionId)
    await claude?.stop()
    const pi = this.#piRuntimes.get(sessionId)
    this.#piRuntimes.delete(sessionId)
    await pi?.stop()
    this.#codexRuntime?.detachSession(sessionId)
    for (const [key, controller] of this.#subscriptions) {
      if (key.startsWith(prefix)) {
        controller.abort()
        this.#subscriptions.delete(key)
      }
    }
    this.#sessionStates.delete(sessionId)
  }

  async handleManagement(
    message: AgentManagementClientMessage,
    context: AgentMessageContext
  ): Promise<void> {
    const respond = (payload: unknown): void =>
      context.send({
        payload: { ok: true, value: payload },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/, ".response"),
      } as ServerMessage)
    try {
      switch (message.type) {
        case "agent.registry.list.request":
          respond({ agents: await this.list(context.sessionId), registry: this.registry.state })
          break
        case "agent.registry.get.request":
          respond(await this.get(message.payload.agentId, context.sessionId))
          break
        case "agent.registry.refresh.request":
          respond(await this.registry.refresh())
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
        case "agent.enabled.set.request":
          respond(
            await this.setEnabled(
              message.payload.agentId,
              message.payload.enabled,
              context.sessionId
            )
          )
          break
        case "agent.start.request":
          respond(await this.startAgent(message.payload.agentId, context.sessionId, context.send))
          break
        case "agent.stop.request":
          respond(await this.stopAgent(message.payload.agentId, context.sessionId))
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
    let runtime = this.#acpRuntimes.get(key)
    if (!runtime) {
      const receipt = await this.#installer.readCurrent(message.agent)
      if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${message.agent} is not installed`)
      runtime = new AcpSessionRuntime({
        agent: message.agent,
        receipt,
        send: context.send,
        toolchains: this.toolchains,
      })
      this.#acpRuntimes.set(key, runtime)
      this.#markSessionRunning(context.sessionId, message.agent)
    }
    runtime.send(message)
  }

  async handleOpenCode(
    message: AgentOpenCodeClientMessage,
    context: AgentMessageContext
  ): Promise<void> {
    await this.#assertCallable("opencode")
    if (!this.#openCode.running) await this.startAgent("opencode", context.sessionId, context.send)
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

  async handleClaude(
    message: AgentClaudeClientMessage,
    context: AgentMessageContext
  ): Promise<void> {
    await this.#assertCallable("claude")
    let runtime = this.#claudeRuntimes.get(context.sessionId)
    if (!runtime) {
      const receipt = await this.#requiredReceipt("claude")
      runtime = new ClaudeSessionRuntime({
        home: join(this.#agentHomes, "claude", "home"),
        receipt,
        send: context.send,
        toolchains: this.toolchains,
      })
      this.#claudeRuntimes.set(context.sessionId, runtime)
    }
    await runtime.send(message)
    this.#markSessionRunning(context.sessionId, "claude")
  }

  async handlePi(message: AgentPiClientMessage, context: AgentMessageContext): Promise<void> {
    await this.#assertCallable("pi")
    let runtime = this.#piRuntimes.get(context.sessionId)
    if (!runtime) {
      const receipt = await this.#requiredReceipt("pi")
      runtime = new PiSessionRuntime({
        home: join(this.#agentHomes, "pi", "home"),
        receipt,
        send: context.send,
        toolchains: this.toolchains,
      })
      this.#piRuntimes.set(context.sessionId, runtime)
    }
    await runtime.send(message)
    this.#markSessionRunning(context.sessionId, "pi")
  }

  async list(sessionId: string): Promise<AgentView[]> {
    const ids = [...NATIVE_AGENT_IDS, ...REGISTRY_AGENT_IDS].filter(
      (id) => isNativeAgentId(id) || this.registry.get(id) || this.#records.get(id)?.version
    )
    return Promise.all(ids.map((id) => this.get(id, sessionId)))
  }

  async get(agentId: AgentId, sessionId: string): Promise<AgentView> {
    const record = this.#records.get(agentId)
    if (!record) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
    const entry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
    const openCodeRelease = agentId === "opencode" ? this.registry.get("opencode") : undefined
    const latestVersion =
      agentId === "opencode"
        ? (openCodeRelease?.version ?? native?.version ?? null)
        : (native?.version ?? entry?.version ?? null)
    const version = record.version ?? latestVersion
    if (!version) throw this.#error("AGENT_VERSION_UNAVAILABLE", `${agentId} has no known version`)
    const running =
      agentId === "opencode"
        ? this.#openCode.running
        : agentId === "codex"
          ? (this.#codexRuntime?.running ?? false)
          : (this.#sessionStates.get(sessionId)?.has(agentId) ?? false)
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
      runScope: native?.runScope ?? "session",
      runtimeState: running ? "running" : "stopped",
      integrity: (await this.#installer.readCurrent(agentId))?.integrity ?? "not-applicable",
    }
  }

  async setEnabled(agentId: AgentId, enabled: boolean, sessionId: string): Promise<AgentView> {
    if (enabled) {
      const record = this.#records.get(agentId)
      if (!record?.installed)
        throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    } else {
      await this.#stopEverywhere(agentId)
    }
    const updated = await this.#persistence.setEnabled(agentId, enabled)
    if (!updated) throw this.#error("AGENT_NOT_FOUND", `Unknown agent: ${agentId}`)
    this.#records.set(agentId, updated)
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.state.notification" })
    return view
  }

  async startAgent(agentId: AgentId, sessionId: string, send: Send): Promise<AgentView> {
    await this.#assertCallable(agentId)
    const receipt = await this.#installer.readCurrent(agentId)
    if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    if (agentId === "opencode") await this.#openCode.start(receipt)
    else if (agentId === "codex") await (await this.#ensureCodexRuntime()).start()
    else if (agentId === "claude") {
      const runtime = new ClaudeSessionRuntime({
        home: join(this.#agentHomes, "claude", "home"),
        receipt,
        send,
        toolchains: this.toolchains,
      })
      this.#claudeRuntimes.set(sessionId, runtime)
      await runtime.start()
      this.#markSessionRunning(sessionId, agentId)
    } else if (agentId === "pi") {
      const runtime = new PiSessionRuntime({
        home: join(this.#agentHomes, "pi", "home"),
        receipt,
        send,
        toolchains: this.toolchains,
      })
      this.#piRuntimes.set(sessionId, runtime)
      await runtime.start()
      this.#markSessionRunning(sessionId, agentId)
    } else if (isRegistryAgentId(agentId)) {
      const key = `${sessionId}:${agentId}`
      if (!this.#acpRuntimes.has(key))
        this.#acpRuntimes.set(
          key,
          new AcpSessionRuntime({ agent: agentId, receipt, send, toolchains: this.toolchains })
        )
      this.#acpRuntimes.get(key)?.start()
      this.#markSessionRunning(sessionId, agentId)
    } else {
      this.#markSessionRunning(sessionId, agentId)
    }
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.state.notification" })
    return view
  }

  async stopAgent(agentId: AgentId, sessionId: string): Promise<AgentView> {
    if (agentId === "opencode") await this.#openCode.stop()
    else if (agentId === "codex") {
      await this.#codexRuntime?.stop()
      this.#codexRuntime = undefined
      for (const agents of this.#sessionStates.values()) agents.delete(agentId)
    } else if (agentId === "claude") {
      const runtime = this.#claudeRuntimes.get(sessionId)
      this.#claudeRuntimes.delete(sessionId)
      await runtime?.stop()
      this.#sessionStates.get(sessionId)?.delete(agentId)
    } else if (agentId === "pi") {
      const runtime = this.#piRuntimes.get(sessionId)
      this.#piRuntimes.delete(sessionId)
      await runtime?.stop()
      this.#sessionStates.get(sessionId)?.delete(agentId)
    } else {
      const key = `${sessionId}:${agentId}`
      const runtime = this.#acpRuntimes.get(key)
      this.#acpRuntimes.delete(key)
      await runtime?.stop()
      this.#sessionStates.get(sessionId)?.delete(agentId)
    }
    const view = await this.get(agentId, sessionId)
    this.#publish({ payload: view, type: "agent.state.notification" })
    return view
  }

  #submitAgentOperation(
    kind: "install" | "update" | "uninstall",
    agentId: AgentId,
    sessionId: string
  ): AgentOperation {
    return this.#submit(kind, { agentId, kind: "agent" }, `agent:${agentId}`, async (progress) => {
      if (kind === "uninstall") {
        progress("Stopping agent", 0.2)
        await this.#stopEverywhere(agentId)
        progress("Removing managed runtime", 0.6)
        await this.#installer.uninstall(agentId)
        const updated = await this.#persistence.setInstalled(agentId, false)
        if (updated) this.#records.set(agentId, updated)
        await this.#reloadRecords()
        await this.#collectPythonEnvironments()
        return
      }
      progress("Preparing toolchains", 0.1)
      const entry = isRegistryAgentId(agentId) ? this.registry.get(agentId) : undefined
      const installationEntry = agentId === "opencode" ? this.registry.get("opencode") : entry
      progress("Installing agent", 0.35)
      const receipt = await this.#installer.install(agentId, installationEntry)
      progress("Committing installation", 0.85)
      const native = isNativeAgentId(agentId) ? nativeCatalog[agentId] : undefined
      const updated = await this.#persistence.setVersion(agentId, {
        description: native?.description ?? entry?.description ?? agentId,
        icon: native?.icon ?? entry?.icon ?? null,
        name: native?.name ?? entry?.name ?? agentId,
        repository: native?.repository ?? entry?.repository ?? null,
        version: receipt.version,
        website: native?.website ?? entry?.website ?? null,
      })
      if (updated) this.#records.set(agentId, updated)
      const view = await this.get(agentId, sessionId)
      this.#publish({ payload: view, type: "agent.state.notification" })
    })
  }

  #submitToolchainOperation(toolchain: ToolchainId): AgentOperation {
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
    task: (progress: (message: string, value: number) => void) => Promise<void>
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
    const previous = this.#operationQueues.get(queueKey) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        operation.status = "running"
        operation.startedAt = new Date().toISOString()
        this.#notifyOperation(operation, "agent.operation.progress.notification")
        try {
          await task((message, value) => {
            operation.message = message
            operation.progress = value
            this.#notifyOperation(operation, "agent.operation.progress.notification")
          })
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
      if (this.#operationQueues.get(queueKey) === current) this.#operationQueues.delete(queueKey)
      this.#pruneOperations()
    })
    return operation
  }

  async #assertCallable(agentId: AgentId): Promise<void> {
    const record = this.#records.get(agentId)
    if (!record?.installed) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    if (!record.enabled) throw this.#error("AGENT_DISABLED", `${agentId} is disabled`)
  }

  async #stopEverywhere(agentId: AgentId): Promise<void> {
    if (agentId === "opencode") await this.#openCode.stop()
    if (agentId === "codex") {
      await this.#codexRuntime?.stop()
      this.#codexRuntime = undefined
    }
    if (agentId === "claude") {
      for (const runtime of this.#claudeRuntimes.values()) await runtime.stop()
      this.#claudeRuntimes.clear()
    }
    if (agentId === "pi") {
      for (const runtime of this.#piRuntimes.values()) await runtime.stop()
      this.#piRuntimes.clear()
    }
    const matches = [...this.#acpRuntimes.entries()].filter(([key]) => key.endsWith(`:${agentId}`))
    for (const [key, runtime] of matches) {
      this.#acpRuntimes.delete(key)
      await runtime.stop()
    }
    for (const agents of this.#sessionStates.values()) agents.delete(agentId)
  }

  async #pumpOpenCodeEvents(
    stream: "event" | "global.event",
    subscriptionId: string,
    key: string,
    controller: AbortController,
    send: Send
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

  async #ensureCodexRuntime(): Promise<CodexRuntime> {
    if (!this.#codexRuntime) {
      this.#codexRuntime = new CodexRuntime({
        codexHome: join(this.#agentHomes, "codex", "home"),
        receipt: await this.#requiredReceipt("codex"),
        toolchains: this.toolchains,
      })
    }
    return this.#codexRuntime
  }

  async #requiredReceipt(agentId: AgentId) {
    const receipt = await this.#installer.readCurrent(agentId)
    if (!receipt) throw this.#error("AGENT_NOT_INSTALLED", `${agentId} is not installed`)
    return receipt
  }

  async #collectPythonEnvironments(): Promise<void> {
    const fingerprints = new Set<string>()
    for (const agentId of [...NATIVE_AGENT_IDS, ...REGISTRY_AGENT_IDS]) {
      for (const receipt of await this.#installer.readReceipts(agentId)) {
        if (receipt.environmentFingerprint) fingerprints.add(receipt.environmentFingerprint)
      }
    }
    await this.toolchains.garbageCollectPythonEnvironments(fingerprints)
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

  #error(code: string, message: string): Error {
    const error = new Error(message)
    error.name = code
    return error
  }
}
