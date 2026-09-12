import type { ConnectionOfferV2, RelayEndpoint } from "@cypheria/protocol"
import {
  createServerChannel,
  type EncryptedChannel,
  exportPublicKey,
  type KeyPair,
  type RelayControlMessage,
  resolveRelayWebSocketUrl,
  type Transport,
} from "@cypheria/relay"
import type { Logger } from "pino"
import WebSocket from "ws"

import type { ClientConnection } from "./session/client-connection.js"
import type { SessionHost } from "./session/client-session.js"
import type { ConnectionRegistry } from "./session/connection-registry.js"

const CONTROL_RECONNECT_MIN_MS = 1_000
const CONTROL_RECONNECT_MAX_MS = 30_000
const CONTROL_PING_MS = 10_000
const CONTROL_STALE_MS = 30_000
const DATA_OPEN_TIMEOUT_MS = 15_000

export type RelayConnectionOptions = {
  endpoint: RelayEndpoint
  helloTimeoutMs: number
  host: SessionHost
  keyPair: KeyPair
  logger: Logger
  publicEndpoint: RelayEndpoint
  registry: ConnectionRegistry
  serverId: string
}

type DataConnection = {
  channel?: EncryptedChannel
  connection?: ClientConnection
  socket: WebSocket
  timeout: NodeJS.Timeout
}

const parseControlMessage = (raw: WebSocket.RawData): RelayControlMessage | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString())
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) return undefined
  if (parsed.type === "sync" && "connectionIds" in parsed && Array.isArray(parsed.connectionIds)) {
    return {
      connectionIds: parsed.connectionIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0
      ),
      type: "sync",
    }
  }
  if (
    (parsed.type === "connected" || parsed.type === "disconnected") &&
    "connectionId" in parsed &&
    typeof parsed.connectionId === "string" &&
    parsed.connectionId.length > 0
  ) {
    return { connectionId: parsed.connectionId, type: parsed.type }
  }
  return undefined
}

const toArrayBuffer = (data: WebSocket.RawData): ArrayBuffer => {
  const source = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer)
  const copy = new Uint8Array(source.byteLength)
  copy.set(source)
  return copy.buffer
}

const createTransport = (socket: WebSocket): Transport => {
  const transport: Transport = {
    close: (code, reason) => socket.close(code, reason),
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data) => socket.send(data),
  }
  socket.on("message", (data, isBinary) =>
    transport.onmessage?.({ data: isBinary ? toArrayBuffer(data) : data.toString(), isBinary })
  )
  socket.on("close", (code, reason) => transport.onclose?.(code, reason.toString()))
  socket.on("error", (error) => transport.onerror?.(error))
  return transport
}

export class RelayConnection {
  readonly #dataConnections = new Map<string, DataConnection>()
  readonly #options: RelayConnectionOptions
  #connected = false
  #control: WebSocket | undefined
  #lastControlActivity = 0
  #reconnectDelay = CONTROL_RECONNECT_MIN_MS
  #reconnectTimer: NodeJS.Timeout | undefined
  #stopped = true
  #heartbeat: NodeJS.Timeout | undefined

  constructor(options: RelayConnectionOptions) {
    this.#options = options
  }

  get connected(): boolean {
    return this.#connected
  }

  get offer(): ConnectionOfferV2 {
    return {
      relay: this.#options.publicEndpoint,
      serverId: this.#options.serverId,
      serverPublicKeyB64: exportPublicKey(this.#options.keyPair.publicKey),
      v: 2,
    }
  }

  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#connectControl()
  }

  stop(): void {
    this.#stopped = true
    this.#connected = false
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    if (this.#heartbeat) clearInterval(this.#heartbeat)
    this.#reconnectTimer = undefined
    this.#heartbeat = undefined
    this.#control?.close(1001, "Cypheria server stopping")
    this.#control = undefined
    for (const connection of this.#dataConnections.values()) {
      clearTimeout(connection.timeout)
      connection.channel?.close(1001, "Cypheria server stopping")
      connection.socket.close(1001, "Cypheria server stopping")
    }
    this.#dataConnections.clear()
  }

  #connectControl(): void {
    if (this.#stopped) return
    const url = resolveRelayWebSocketUrl({
      endpoint: this.#options.endpoint,
      role: "server",
      serverId: this.#options.serverId,
    })
    const socket = new WebSocket(url)
    this.#control = socket
    socket.on("open", () => {
      if (this.#control !== socket) return
      this.#lastControlActivity = Date.now()
      this.#reconnectDelay = CONTROL_RECONNECT_MIN_MS
      this.#heartbeat = setInterval(() => {
        if (Date.now() - this.#lastControlActivity > CONTROL_STALE_MS) {
          socket.terminate()
          return
        }
        if (socket.readyState === WebSocket.OPEN) socket.ping()
      }, CONTROL_PING_MS)
      this.#heartbeat.unref()
    })
    socket.on("pong", () => {
      this.#lastControlActivity = Date.now()
    })
    socket.on("message", (raw, isBinary) => {
      this.#lastControlActivity = Date.now()
      if (isBinary) return
      const message = parseControlMessage(raw)
      if (!message) return
      if (message.type === "sync") {
        this.#connected = true
        const active = new Set(message.connectionIds)
        for (const connectionId of active) this.#ensureDataConnection(connectionId)
        for (const connectionId of this.#dataConnections.keys()) {
          if (!active.has(connectionId)) this.#closeDataConnection(connectionId)
        }
      } else if (message.type === "connected") {
        this.#ensureDataConnection(message.connectionId)
      } else {
        this.#closeDataConnection(message.connectionId)
      }
    })
    socket.on("error", (error) => {
      this.#options.logger.warn({ err: error }, "Relay control connection failed")
    })
    socket.on("close", () => {
      if (this.#control !== socket) return
      this.#control = undefined
      this.#connected = false
      if (this.#heartbeat) clearInterval(this.#heartbeat)
      this.#heartbeat = undefined
      for (const connectionId of this.#dataConnections.keys()) {
        this.#closeDataConnection(connectionId)
      }
      this.#scheduleReconnect()
    })
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      this.#connectControl()
    }, this.#reconnectDelay)
    this.#reconnectTimer.unref()
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, CONTROL_RECONNECT_MAX_MS)
  }

  #ensureDataConnection(connectionId: string): void {
    if (this.#stopped || this.#dataConnections.has(connectionId)) return
    const url = resolveRelayWebSocketUrl({
      connectionId,
      endpoint: this.#options.endpoint,
      role: "server",
      serverId: this.#options.serverId,
    })
    const socket = new WebSocket(url)
    const connection: DataConnection = {
      socket,
      timeout: setTimeout(() => socket.terminate(), DATA_OPEN_TIMEOUT_MS),
    }
    connection.timeout.unref()
    this.#dataConnections.set(connectionId, connection)
    socket.on("open", () => {
      clearTimeout(connection.timeout)
      let clientConnection: ClientConnection | undefined
      const transport = createTransport(socket)
      void createServerChannel(
        transport,
        this.#options.keyPair,
        {
          onclose: () => clientConnection?.transportClosed(),
          onerror: (error) =>
            this.#options.logger.warn({ connectionId, err: error }, "Relay E2EE channel failed"),
          onmessage: (message) => {
            if (!clientConnection) return
            if (typeof message !== "string") {
              clientConnection.close(1003, "Only JSON text messages are supported")
              return
            }
            void clientConnection.receive(message)
          },
        },
        { handshakeTimeoutMs: this.#options.helloTimeoutMs }
      )
        .then((channel) => {
          if (socket.readyState !== WebSocket.OPEN) {
            channel.close(1001, "Relay data socket closed")
            return
          }
          connection.channel = channel
          clientConnection = this.#options.registry.accept({
            close: (code, reason) => channel.close(code, reason),
            send: (data) => {
              void channel.send(data).catch((error) => {
                this.#options.logger.warn(
                  { connectionId, err: error },
                  "Failed to send encrypted relay frame"
                )
                channel.close(1011, "Relay send failed")
              })
            },
          })
          connection.connection = clientConnection
        })
        .catch((error) => {
          this.#options.logger.warn({ connectionId, err: error }, "Relay E2EE handshake failed")
          socket.close(1008, "E2EE handshake failed")
        })
    })
    socket.on("error", (error) => {
      this.#options.logger.warn({ connectionId, err: error }, "Relay data connection failed")
    })
    socket.on("close", () => {
      clearTimeout(connection.timeout)
      connection.connection?.transportClosed()
      if (this.#dataConnections.get(connectionId) === connection) {
        this.#dataConnections.delete(connectionId)
      }
    })
  }

  #closeDataConnection(connectionId: string): void {
    const connection = this.#dataConnections.get(connectionId)
    if (!connection) return
    this.#dataConnections.delete(connectionId)
    clearTimeout(connection.timeout)
    connection.channel?.close(1001, "Relay client disconnected")
    if (!connection.channel) connection.socket.close(1001, "Relay client disconnected")
  }
}
