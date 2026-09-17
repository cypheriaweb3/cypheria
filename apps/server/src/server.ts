import { access } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { hostname } from "node:os"
import { resolve } from "node:path"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  type OpenDatabaseResult,
  openCypheriaDatabase,
} from "@cypheria/db"
import {
  type AgentAcpClientMessage,
  type AgentClaudeClientMessage,
  type AgentCodexClientNotification,
  type AgentCodexClientRequest,
  type AgentCodexServerResponse,
  type AgentManagementClientMessage,
  type AgentOpenCodeClientMessage,
  type AgentPiClientMessage,
  type ClientMessage,
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PROTOCOL,
  type PersistedServerConfigPatch,
  type RelayPairingOfferResponse,
  SERVER_CAPABILITIES,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerMessage,
  type ServerOperationalState,
  type ServerStatus,
} from "@cypheria/protocol"
import {
  CypheriaRuntime,
  type CypheriaRuntimeEvent,
  type CypheriaRuntimeMethod,
} from "@cypheria/runtime"
import { serve } from "@hono/node-server"
import pino, { type Logger } from "pino"
import { type WebSocket, WebSocketServer } from "ws"
import { AgentManager } from "./agent/agent-manager.js"
import { type CypheriaServerConfig, loadServerConfig } from "./config.js"
import { collectDiagnostics } from "./diagnostics.js"
import { createHttpApp, type HttpAppHost } from "./http-app.js"
import { loadOrCreateServerId } from "./identity.js"
import { RelayConnection } from "./relay-connection.js"
import { loadOrCreateRelayKeyPair } from "./relay-key.js"
import { ServerConfigStore } from "./server-config-store.js"
import type { SessionTransport } from "./session/client-session.js"
import { ConnectionRegistry } from "./session/connection-registry.js"
import { CYPHERIA_SERVER_VERSION } from "./version.js"

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
  readonly database: OpenDatabaseResult

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
    this.registry = new ConnectionRegistry({
      helloTimeoutMs: this.config.sessionHelloTimeoutMs,
      host: this,
      reconnectGraceMs: this.config.sessionReconnectGraceMs,
    })
    this.agentManager = new AgentManager({
      cacheDir: this.runtime.paths.cacheDir,
      cypheriaHome: this.runtime.paths.cypheriaHome,
      persistence: createAgentRegistryPersistenceService(this.database.db),
      publish: (message) => this.registry.broadcast(message),
      networkBootstrap: options.agentNetworkBootstrap,
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
      await this.agentManager.start()
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
    return this.configStore.patch(patch)
  }

  async reloadConfig(): Promise<ServerConfigSnapshot> {
    return this.configStore.reload()
  }

  getSessionCapabilities(): string[] {
    return [
      SERVER_CAPABILITIES.acp,
      SERVER_CAPABILITIES.agentManager,
      SERVER_CAPABILITIES.claude,
      SERVER_CAPABILITIES.codex,
      SERVER_CAPABILITIES.config,
      SERVER_CAPABILITIES.diagnostics,
      SERVER_CAPABILITIES.opencode,
      SERVER_CAPABILITIES.pi,
      SERVER_CAPABILITIES.status,
    ]
  }

  async handleAgentMessage(
    message: ClientMessage,
    sessionId: string,
    source: SessionTransport,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    if (message.type.startsWith("agent.acp.")) {
      await this.agentManager.handleAcp(message as AgentAcpClientMessage, { send, sessionId })
      return true
    }
    if (message.type.startsWith("agent.opencode.")) {
      await this.agentManager.handleOpenCode(message as AgentOpenCodeClientMessage, {
        send,
        sessionId,
      })
      return true
    }
    if (message.type.startsWith("agent.codex.")) {
      await this.agentManager.handleCodex(
        message as
          | AgentCodexClientRequest
          | AgentCodexServerResponse
          | AgentCodexClientNotification,
        { send, sessionId }
      )
      return true
    }
    if (message.type.startsWith("agent.claude.")) {
      await this.agentManager.handleClaude(message as AgentClaudeClientMessage, { send, sessionId })
      return true
    }
    if (message.type.startsWith("agent.pi.")) {
      await this.agentManager.handlePi(message as AgentPiClientMessage, { send, sessionId })
      return true
    }
    if (
      message.type.startsWith("agent.registry.") ||
      message.type.startsWith("agent.operation.") ||
      message.type.startsWith("agent.toolchain.") ||
      [
        "agent.install.request",
        "agent.update.request",
        "agent.uninstall.request",
        "agent.enabled.set.request",
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

  closeAgentSession(sessionId: string): void {
    void this.agentManager.disposeSession(sessionId)
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
