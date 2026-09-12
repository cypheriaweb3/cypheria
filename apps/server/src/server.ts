import { access } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { hostname } from "node:os"
import { resolve } from "node:path"

import {
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PROTOCOL,
  type RelayPairingOfferResponse,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerInfo,
} from "@cypheria/protocol"
import {
  CypheriaRuntime,
  type CypheriaRuntimeEvent,
  type CypheriaRuntimeMethod,
} from "@cypheria/runtime"
import { serve } from "@hono/node-server"
import pino, { type Logger } from "pino"
import { type WebSocket, WebSocketServer } from "ws"

import { type CypheriaServerConfig, loadServerConfig } from "./config.js"
import { collectDiagnostics } from "./diagnostics.js"
import { createHttpApp, type HttpAppHost } from "./http-app.js"
import { loadOrCreateServerId } from "./identity.js"
import { RelayConnection } from "./relay-connection.js"
import { loadOrCreateRelayKeyPair } from "./relay-key.js"
import { ConnectionRegistry } from "./session/connection-registry.js"
import { CYPHERIA_SERVER_VERSION } from "./version.js"

export type ServerLifecycleAction = "restart" | "shutdown"

export type ServerLifecycleRequest = {
  action: ServerLifecycleAction
  reason?: string
}

export type CypheriaServerOptions = {
  config?: CypheriaServerConfig
  logger?: Logger
  onLifecycleRequest?: (request: ServerLifecycleRequest) => void
  runtime?: CypheriaRuntime
}

export type CypheriaServerAddress = {
  host: string
  port: number
  url: string
}

export class CypheriaServer implements HttpAppHost {
  readonly config: CypheriaServerConfig
  readonly logger: Logger
  readonly registry = new ConnectionRegistry()
  readonly runtime: CypheriaRuntime

  #address: CypheriaServerAddress | undefined
  #eventPump: Promise<void> | undefined
  #httpServer: HttpServer | undefined
  #identity: ServerIdentity | undefined
  #lifecycleHandler: ((request: ServerLifecycleRequest) => void) | undefined
  #relayConnection: RelayConnection | undefined
  #startPromise: Promise<CypheriaServerAddress> | undefined
  #stopPromise: Promise<void> | undefined
  #webSocketServer: WebSocketServer | undefined
  #webSocketHeartbeat: NodeJS.Timeout | undefined

  constructor(options: CypheriaServerOptions = {}) {
    this.config = options.config ?? loadServerConfig()
    this.logger = options.logger ?? pino({ name: "cypheria-server" })
    this.runtime = options.runtime ?? new CypheriaRuntime()
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

      this.#eventPump = this.#broadcastRuntimeEvents()
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
      await Promise.allSettled([this.#closeHttpListener(), this.runtime.stop()])
      await this.#eventPump
      this.#eventPump = undefined
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

  getInfo(): ServerInfo {
    return {
      ...this.getIdentity(),
      connections: this.registry.size,
      runtimeState: this.runtime.lifecycleState,
      webApp: { enabled: this.config.webAppEnabled },
    }
  }

  getDiagnostics(): ServerDiagnostics {
    return collectDiagnostics(this.registry.diagnostics(), this.runtime.lifecycleState)
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

    const results = await Promise.allSettled([this.#closeHttpListener(), this.runtime.stop()])
    await this.#eventPump
    this.#eventPump = undefined
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

  async #broadcastRuntimeEvents(): Promise<void> {
    for await (const event of this.runtime.events()) {
      this.registry.broadcast({ payload: { event }, type: "runtime.event" })
    }
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
