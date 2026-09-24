import { access } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { hostname } from "node:os"
import { resolve } from "node:path"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createProjectThreadPersistenceService,
  createSchedulePersistenceService,
  createThreadLifecyclePersistenceService,
  createThreadMessageRequestPersistenceService,
  createThreadTimelinePersistenceService,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  type AgentManagementClientMessage,
  type ClientMessage,
  type CodexHarnessClientMessage,
  type CodexHarnessServerMessage,
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PROTOCOL,
  type GitClientMessage,
  type GitServerMessage,
  type HarnessClientMessage,
  type IntegrationClientMessage,
  type IntegrationServerMessage,
  type PersistedServerConfigPatch,
  type ProjectThreadClientMessage,
  type RelayPairingOfferResponse,
  type ScheduleClientMessage,
  type ScheduleServerMessage,
  SERVER_CAPABILITIES,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerMessage,
  type ServerOperationalState,
  type ServerStatus,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type ThreadClientMessage,
  type Web3ClientMessage,
  type Web3ServerMessage,
} from "@cypheria/protocol"
import { serve } from "@hono/node-server"
import pino, { type Logger } from "pino"
import { type WebSocket, WebSocketServer } from "ws"
import { AgentManager } from "./agent/agent-manager.js"
import { CodexHarnessService } from "./codex-harness-service.js"
import { type CypheriaServerConfig, loadServerConfig } from "./config.js"
import { collectDiagnostics } from "./diagnostics.js"
import { GitService } from "./git/git-service.js"
import { HarnessService } from "./harness-service.js"
import { createHttpApp, type HttpAppHost } from "./http-app.js"
import { loadOrCreateServerId } from "./identity.js"
import { IntegrationService } from "./integration-service.js"
import { ProjectThreadService } from "./project-thread-service.js"
import { RelayConnection } from "./relay-connection.js"
import { loadOrCreateRelayKeyPair } from "./relay-key.js"
import {
  CypheriaRuntime,
  type CypheriaRuntimeEvent,
  type CypheriaRuntimeMethod,
} from "./runtime/index.js"
import { ScheduleService } from "./schedule/schedule-service.js"
import { ServerConfigStore } from "./server-config-store.js"
import type { SessionTransport } from "./session/client-session.js"
import { ConnectionRegistry } from "./session/connection-registry.js"
import { TerminalService } from "./terminal-service.js"
import { ThreadManager } from "./thread/thread-manager.js"
import { CYPHERIA_SERVER_VERSION } from "./version.js"
import { ServerWeb3Service } from "./web3-service.js"

export type ServerLifecycleAction = "restart" | "shutdown"

export type ServerLifecycleRequest = {
  action: ServerLifecycleAction
  reason?: string
}

export type CypheriaServerOptions = {
  config?: CypheriaServerConfig
  configStore?: ServerConfigStore
  logger?: Logger
  onLifecycleRequest?: (request: ServerLifecycleRequest) => void
  runtime?: CypheriaRuntime
  database?: OpenDatabaseResult
  agentNetworkBootstrap?: boolean
}

export type CypheriaServerAddress = {
  host: string
  port: number
  url: string
}

export class CypheriaServer implements HttpAppHost {
  readonly config: CypheriaServerConfig
  readonly configStore: ServerConfigStore
  readonly logger: Logger
  readonly registry: ConnectionRegistry
  readonly runtime: CypheriaRuntime
  readonly agentManager: AgentManager
  readonly projectThread: ProjectThreadService
  readonly integrations: IntegrationService
  readonly codexHarness: CodexHarnessService
  readonly harnesses: HarnessService
  readonly schedules: ScheduleService
  readonly threadManager: ThreadManager
  readonly terminals: TerminalService
  readonly git: GitService
  readonly database: OpenDatabaseResult
  readonly web3: ServerWeb3Service

  #address: CypheriaServerAddress | undefined
  #httpServer: HttpServer | undefined
  #identity: ServerIdentity | undefined
  #lifecycleHandler: ((request: ServerLifecycleRequest) => void) | undefined
  #relayConnection: RelayConnection | undefined
  #startPromise: Promise<CypheriaServerAddress> | undefined
  #stopPromise: Promise<void> | undefined
  #webSocketServer: WebSocketServer | undefined
  #webSocketHeartbeat: NodeJS.Timeout | undefined

  constructor(options: CypheriaServerOptions = {}) {
    this.logger = options.logger ?? pino({ name: "cypheria-server" })
    this.runtime = options.runtime ?? new CypheriaRuntime()
    this.configStore =
      options.configStore ??
      ServerConfigStore.fromResolved(
        this.runtime.paths.configDir,
        options.config ?? loadServerConfig()
      )
    this.config = this.configStore.effective
    this.database = options.database ?? openCypheriaDatabase({ dbDir: this.runtime.paths.dbDir })
    this.web3 = new ServerWeb3Service(this.database, this.runtime.paths)
    this.registry = new ConnectionRegistry({
      helloTimeoutMs: this.config.sessionHelloTimeoutMs,
      host: this,
      reconnectGraceMs: this.config.sessionReconnectGraceMs,
    })
    this.agentManager = new AgentManager({
      logger: this.logger.child({ service: "agents" }),
      cacheDir: this.runtime.paths.cacheDir,
      cypheriaHome: this.runtime.paths.cypheriaHome,
      persistence: createAgentRegistryPersistenceService(this.database.db),
      publish: (message) => this.registry.broadcast(message),
      networkBootstrap: options.agentNetworkBootstrap,
      gitSettings: () => this.configStore.getSnapshot().config.git,
      managedShellEnvironment: (cwd) => this.git.managedShellEnvironment(cwd),
      agentDefaults: (agentId) =>
        this.configStore.getSnapshot().config.agents.defaults[agentId] ?? {},
    })
    this.integrations = new IntegrationService(this.agentManager)
    const projectThreadPersistence = createProjectThreadPersistenceService(this.database.db)
    this.terminals = new TerminalService(projectThreadPersistence)
    this.projectThread = new ProjectThreadService({
      persistence: projectThreadPersistence,
    })
    this.threadManager = new ThreadManager({
      adapterFor: (agentId, threadId) => this.agentManager.adapterFor(agentId, threadId),
      assertAgentCallable: (agentId) => this.agentManager.assertCallable(agentId),
      lifecycle: createThreadLifecyclePersistenceService(this.database.db),
      messageRequests: createThreadMessageRequestPersistenceService(this.database.db),
      persistence: projectThreadPersistence,
      publish: (message) => this.registry.broadcast(message),
      onArchived: async (cwd) => {
        await this.git.cleanupManagedWorktrees(cwd)
      },
      onUnarchiving: async (cwd) => {
        await this.git.restoreArchivedWorktree(cwd)
      },
      timelinePersistence: createThreadTimelinePersistenceService(this.database.db),
      turnCapture: {
        start: (threadId, cwd) => this.git.turnCaptureStart(threadId, cwd),
        complete: (captureId, turnId) => this.git.turnCaptureComplete(captureId, turnId),
        discard: (captureId) => this.git.turnCaptureDiscard(captureId),
      },
    })
    this.git = new GitService(
      this.runtime.paths.cacheDir,
      this.runtime.paths.cypheriaHome,
      {
        agents: this.agentManager,
        threads: this.threadManager,
        audit: this.web3.audit,
        publishChanged: (message) => this.registry.broadcast(message),
      },
      () => this.configStore.getSnapshot().config.git
    )
    this.codexHarness = new CodexHarnessService(
      this.agentManager,
      this.configStore,
      this.threadManager
    )
    this.harnesses = new HarnessService(
      this.agentManager,
      this.codexHarness,
      this.configStore,
      this.terminals
    )
    this.agentManager.setCatalogInvalidator((agentId) => this.harnesses.invalidate(agentId))
    this.agentManager.setDefaultsResolver((agentId) => this.harnesses.validatedDefaults(agentId))
    this.agentManager.setThreadCoordinator(this.threadManager)
    this.schedules = new ScheduleService({
      logger: this.logger.child({ service: "schedules" }),
      persistence: createSchedulePersistenceService(this.database.db),
      publish: (message) => this.registry.broadcast(message),
      requestRuntime: (method, params) => this.requestRuntime(method, params),
      threadManager: this.threadManager,
    })
    this.#lifecycleHandler = options.onLifecycleRequest
  }

  get address(): CypheriaServerAddress | undefined {
    return this.#address
  }

  async start(): Promise<CypheriaServerAddress> {
    if (this.#address) return this.#address
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start()
    try {
      return await this.#startPromise
    } finally {
      this.#startPromise = undefined
    }
  }

  async #start(): Promise<CypheriaServerAddress> {
    if (this.config.webAppEnabled) {
      await access(resolve(this.config.webAppDir, "index.html"))
    }
    await this.runtime.start()
    try {
      await applyDatabaseMigrations(this.database.client)
      await this.projectThread.initialize()
      await this.web3.initialize()
      await this.agentManager.start()
      await this.threadManager.initialize()
      await this.schedules.start()
      const startedAt = new Date().toISOString()
      const id = await loadOrCreateServerId(this.runtime.paths.configDir)
      this.#identity = {
        hostname: hostname(),
        id,
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        startedAt,
        version: CYPHERIA_SERVER_VERSION,
      }

      if (this.config.relayEnabled) {
        const endpoint = this.config.relayEndpoint
        const publicEndpoint = this.config.relayPublicEndpoint
        if (!endpoint || !publicEndpoint) throw new Error("Relay endpoints are not configured")
        const keyPair = await loadOrCreateRelayKeyPair(this.runtime.paths.configDir)
        this.#relayConnection = new RelayConnection({
          endpoint: { endpoint, useTls: this.config.relayUseTls },
          helloTimeoutMs: this.config.sessionHelloTimeoutMs,
          host: this,
          keyPair,
          logger: this.logger,
          publicEndpoint: { endpoint: publicEndpoint, useTls: this.config.relayPublicUseTls },
          registry: this.registry,
          serverId: id,
        })
        this.#relayConnection.start()
      }

      const app = createHttpApp({
        config: this.config,
        host: this,
        logger: this.logger,
        registry: this.registry,
      })
      const webSocketServer = new WebSocketServer({
        handleProtocols: (protocols) =>
          protocols.has(CYPHERIA_WEBSOCKET_PROTOCOL) ? CYPHERIA_WEBSOCKET_PROTOCOL : false,
        maxPayload: this.config.maxMessageBytes,
        noServer: true,
      })
      this.#webSocketHeartbeat = this.#startWebSocketHeartbeat(webSocketServer)
      const listening = new Promise<CypheriaServerAddress>((resolve, reject) => {
        let httpServer: HttpServer
        const onError = (error: Error) => reject(error)
        httpServer = serve(
          {
            fetch: app.fetch,
            hostname: this.config.host,
            port: this.config.port,
            websocket: { server: webSocketServer },
          },
          (info) => {
            httpServer.off("error", onError)
            const displayHost = info.family === "IPv6" ? `[${info.address}]` : info.address
            resolve({
              host: info.address,
              port: info.port,
              url: `http://${displayHost}:${info.port}`,
            })
          }
        ) as HttpServer
        httpServer.once("error", onError)
        this.#httpServer = httpServer
      })
      this.#webSocketServer = webSocketServer
      this.#address = await listening
      this.logger.info(this.#address, "Cypheria server is ready")
      return this.#address
    } catch (error) {
      if (this.#webSocketHeartbeat) clearInterval(this.#webSocketHeartbeat)
      this.#webSocketServer?.close()
      await Promise.allSettled([
        this.#closeHttpListener(),
        this.agentManager.stop(),
        this.runtime.stop(),
      ])
      this.web3.stop()
      this.schedules.stop()
      this.terminals.stop()
      this.#identity = undefined
      this.#webSocketServer = undefined
      this.#webSocketHeartbeat = undefined
      this.#relayConnection?.stop()
      this.#relayConnection = undefined
      throw error
    }
  }

  isReady(): boolean {
    return this.#address !== undefined && this.runtime.lifecycleState === "ready"
  }

  getIdentity(): ServerIdentity {
    if (!this.#identity) throw new Error("Server identity is not initialized")
    return this.#identity
  }

  getStatus(): ServerStatus {
    return {
      ...this.getIdentity(),
      capabilities: this.getSessionCapabilities(),
      connections: this.registry.size,
      runtimeState: this.runtime.lifecycleState,
      webApp: { enabled: this.config.webAppEnabled },
    }
  }

  getDiagnostics(): ServerDiagnostics {
    return collectDiagnostics(this.registry.diagnostics(), this.runtime.lifecycleState)
  }

  getConfig(): ServerConfigSnapshot {
    return this.configStore.getSnapshot()
  }

  async patchConfig(patch: PersistedServerConfigPatch): Promise<ServerConfigSnapshot> {
    const snapshot = await this.configStore.patch(patch)
    this.harnesses.invalidate()
    return snapshot
  }

  async reloadConfig(): Promise<ServerConfigSnapshot> {
    const snapshot = await this.configStore.reload()
    this.harnesses.invalidate()
    return snapshot
  }

  getSessionCapabilities(): string[] {
    return [
      SERVER_CAPABILITIES.agentManager,
      SERVER_CAPABILITIES.config,
      SERVER_CAPABILITIES.diagnostics,
      SERVER_CAPABILITIES.integrations,
      SERVER_CAPABILITIES.codexHarness,
      SERVER_CAPABILITIES.harnessManagement,
      SERVER_CAPABILITIES.projectThread,
      SERVER_CAPABILITIES.schedules,
      SERVER_CAPABILITIES.terminals,
      SERVER_CAPABILITIES.git,
      SERVER_CAPABILITIES.status,
      SERVER_CAPABILITIES.thread,
      SERVER_CAPABILITIES.web3,
    ]
  }

  async handleAgentMessage(
    message: ClientMessage,
    sessionId: string,
    source: SessionTransport,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    if (
      message.type === "agent.list.request" ||
      message.type === "agent.add.request" ||
      message.type === "agent.remove.request" ||
      message.type === "agent.get.request" ||
      message.type.startsWith("agent.operation.") ||
      message.type.startsWith("agent.toolchain.") ||
      [
        "agent.install.request",
        "agent.update.request",
        "agent.uninstall.request",
        "agent.enable.request",
        "agent.disable.request",
        "agent.start.request",
        "agent.stop.request",
      ].includes(message.type)
    ) {
      await this.agentManager.handleManagement(message as AgentManagementClientMessage, {
        send,
        sessionId,
      })
      return true
    }
    void source
    return false
  }

  async handleProjectThreadMessage(
    message: ClientMessage,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    if (message.type.startsWith("thread.")) {
      await this.threadManager.handle(message as ThreadClientMessage, send)
      return true
    }
    if (!message.type.startsWith("project.") && !message.type.startsWith("section.")) {
      return false
    }
    await this.projectThread.handle(message as ProjectThreadClientMessage, send)
    return true
  }

  async handleIntegrationMessage(
    message: IntegrationClientMessage,
    send: (message: IntegrationServerMessage) => void
  ): Promise<boolean> {
    return this.integrations.handle(message, send)
  }

  async handleCodexHarnessMessage(
    message: CodexHarnessClientMessage,
    send: (message: CodexHarnessServerMessage) => void
  ): Promise<boolean> {
    return this.codexHarness.handle(message, send)
  }

  async handleHarnessMessage(
    message: HarnessClientMessage,
    sessionId: string,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    return this.harnesses.handle(message, sessionId, send)
  }

  async handleScheduleMessage(
    message: ScheduleClientMessage,
    send: (message: ScheduleServerMessage) => void
  ): Promise<boolean> {
    await this.schedules.handle(message, send)
    return true
  }

  async handleTerminalMessage(
    message: TerminalClientMessage,
    sessionId: string,
    send: (message: TerminalServerMessage) => void
  ): Promise<boolean> {
    return this.terminals.handle(message, sessionId, send)
  }

  async handleGitMessage(
    message: GitClientMessage,
    send: (message: GitServerMessage) => void
  ): Promise<boolean> {
    return this.git.handle(message, send)
  }

  clientSessionClosed(sessionId: string): void {
    this.harnesses.closeSession(sessionId)
    this.terminals.closeSession(sessionId)
  }

  async handleWeb3Message(
    message: Web3ClientMessage,
    send: (message: Web3ServerMessage) => void
  ): Promise<boolean> {
    return this.web3.handle(message, send)
  }

  getState(): ServerOperationalState {
    const config = this.configStore.getSnapshot()
    return {
      config: {
        path: config.path,
        restartRequired: config.restartRequiredPaths.length > 0,
      },
      connections: {
        active: this.registry.size,
        activeSessions: this.registry.activeSessions,
        retained: this.registry.retained,
      },
      relay: {
        connected: this.#relayConnection?.connected ?? false,
        enabled: this.config.relayEnabled,
      },
      runtimeState: this.runtime.lifecycleState,
      worker: {
        pid: process.pid,
        ...(typeof process.send === "function" ? { supervisorPid: process.ppid } : {}),
      },
    }
  }

  getRelayPairingOffer(): RelayPairingOfferResponse | undefined {
    const relay = this.#relayConnection
    if (!relay) return undefined
    return {
      offer: relay.offer,
      relayConnected: relay.connected,
      url: "cypheria://pair",
    }
  }

  async requestRuntime(method: string, params?: unknown): Promise<unknown> {
    return this.runtime.request(method as CypheriaRuntimeMethod, params)
  }

  requestLifecycle(action: ServerLifecycleAction, reason?: string): void {
    this.logger.info({ action, reason }, "Server lifecycle request accepted")
    this.#lifecycleHandler?.({ action, reason })
  }

  async stop(reason = "Server shutting down"): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#stop(reason)
    try {
      await this.#stopPromise
    } finally {
      this.#stopPromise = undefined
    }
  }

  async #stop(reason: string): Promise<void> {
    if (!this.#httpServer && this.runtime.lifecycleState === "stopped") return
    this.logger.info({ reason }, "Stopping Cypheria server")
    this.#address = undefined
    this.#relayConnection?.stop()
    this.#relayConnection = undefined
    this.registry.closeAll(1001, reason)
    if (this.#webSocketHeartbeat) clearInterval(this.#webSocketHeartbeat)
    this.#webSocketHeartbeat = undefined
    this.#webSocketServer?.close()
    this.#webSocketServer = undefined
    this.schedules.stop()
    this.git.stop()
    this.terminals.stop()
    this.web3.stop()
    this.harnesses.stop()

    const results = await Promise.allSettled([
      this.#closeHttpListener(),
      this.agentManager.stop(),
      this.runtime.stop(),
    ])
    this.database.close()
    this.#identity = undefined
    const failures = results.filter((result) => result.status === "rejected")
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Cypheria server shutdown failed"
      )
    }
    this.logger.info("Cypheria server stopped")
  }

  async #closeHttpListener(): Promise<void> {
    const httpServer = this.#httpServer
    this.#httpServer = undefined
    if (!httpServer?.listening) return

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        httpServer.closeAllConnections()
        resolve()
      }, this.config.shutdownTimeoutMs).unref()
      httpServer.close((error) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      })
    })
  }

  #startWebSocketHeartbeat(webSocketServer: WebSocketServer): NodeJS.Timeout {
    const alive = new WeakSet<WebSocket>()
    webSocketServer.on("connection", (socket) => {
      alive.add(socket)
      socket.on("pong", () => alive.add(socket))
    })

    const heartbeat = setInterval(() => {
      for (const socket of webSocketServer.clients) {
        if (!alive.has(socket)) {
          socket.terminate()
          continue
        }
        alive.delete(socket)
        socket.ping()
      }
    }, 30_000)
    heartbeat.unref()
    return heartbeat
  }
}

export type { CypheriaRuntimeEvent }
