import {
  type ClientMessage,
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  decodeWSOutboundMessage,
  encodeProtocolMessage,
  type ServerMessage,
  type ServerStatus,
  wrapClientSessionMessage,
} from "@cypheria/protocol"
import Constants from "expo-constants"
import appPackage from "../../package.json"

import { resolveServerWebSocketUrl } from "./server-url"

export type ServerConnectionState = "connected" | "connecting" | "disconnected"

export type ServerClientSnapshot = {
  error?: string
  status?: ServerStatus
  state: ServerConnectionState
}

type PendingRequest = {
  reject(error: Error): void
  resolve(message: ServerMessage): void
  timeout: ReturnType<typeof setTimeout>
}

type PendingReady = {
  reject(error: Error): void
  resolve(): void
  timeout: ReturnType<typeof setTimeout>
}

const requestId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const versionOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const resolveAppVersion = (): string | null =>
  versionOrNull(appPackage.version) ??
  versionOrNull(Constants.expoConfig?.version) ??
  versionOrNull((Constants as unknown as { manifest?: { version?: unknown } }).manifest?.version)

const correlatedRequestId = (message: object): string | undefined => {
  if ("requestId" in message && typeof message.requestId === "string") return message.requestId
  if (!("payload" in message) || typeof message.payload !== "object" || message.payload === null) {
    return undefined
  }
  return "requestId" in message.payload && typeof message.payload.requestId === "string"
    ? message.payload.requestId
    : undefined
}

export class CypheriaServerClient {
  #attempt = 0
  #clientId = `expo-${requestId()}`
  #listeners = new Set<() => void>()
  #pending = new Map<string, PendingRequest>()
  #pendingReady: PendingReady | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #shouldReconnect = true
  #snapshot: ServerClientSnapshot = { state: "disconnected" }
  #socket: WebSocket | undefined
  #token: string | undefined
  #url: string

  constructor(options: { token?: string; url?: string } = {}) {
    this.#token = options.token
    this.#url = options.url ?? resolveServerWebSocketUrl()
  }

  get snapshot(): ServerClientSnapshot {
    return this.#snapshot
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  connect(): void {
    if (this.#socket && this.#socket.readyState < WebSocket.CLOSING) return
    this.#shouldReconnect = true
    this.#setSnapshot({ state: "connecting" })

    const socket = new WebSocket(this.#url, createWebSocketProtocols(this.#token))
    socket.binaryType = "arraybuffer"
    this.#socket = socket
    socket.onopen = () => {
      if (this.#socket !== socket) {
        socket.close(1000, "Connection was superseded")
        return
      }
      void this.#initialize(socket)
    }
    socket.onmessage = (event) => {
      if (this.#socket === socket) this.#receive(event.data)
    }
    socket.onerror = () => {
      if (this.#socket === socket) {
        this.#setSnapshot({ error: "Unable to connect", state: "disconnected" })
      }
    }
    socket.onclose = () => this.#handleClose(socket)
  }

  disconnect(): void {
    this.#shouldReconnect = false
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    const socket = this.#socket
    this.#socket = undefined
    socket?.close(1000, "Client closed")
    this.#rejectPending(new Error("Server connection closed"))
    this.#setSnapshot({ state: "disconnected" })
  }

  async request(type: "server.status.request" | "server.diagnostics.request") {
    return this.#sendRequest({ requestId: requestId(), type })
  }

  async #initialize(socket: WebSocket): Promise<void> {
    try {
      const appVersion = resolveAppVersion()
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.#pendingReady = undefined
          reject(new Error("Server handshake timed out"))
        }, 15_000)
        this.#pendingReady = { reject, resolve, timeout }
      })
      socket.send(
        encodeProtocolMessage({
          ...(appVersion ? { appVersion } : {}),
          clientId: this.#clientId,
          clientType: "mobile",
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          type: "hello",
        })
      )
      await ready
      this.#attempt = 0
      this.#setSnapshot({ state: "connected" })
      const response = await this.request("server.status.request")
      if (response.type === "server.status.response") {
        this.#setSnapshot({ state: "connected", status: response.payload })
      }
    } catch (error) {
      if (this.#socket !== socket) return
      this.#setSnapshot({
        error: error instanceof Error ? error.message : "Handshake failed",
        state: "disconnected",
      })
      socket.close(1002, "Handshake failed")
    }
  }

  #sendRequest(message: ClientMessage & { requestId: string }): Promise<ServerMessage> {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Server connection is not open"))
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(message.requestId)
        reject(new Error("Server request timed out"))
      }, 15_000)
      this.#pending.set(message.requestId, { reject, resolve, timeout })
      this.#socket?.send(encodeProtocolMessage(wrapClientSessionMessage(message)))
    })
  }

  #receive(data: unknown): void {
    try {
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : undefined
      if (!bytes) throw new TypeError("Server sent a non-binary WebSocket frame")
      const envelope = decodeWSOutboundMessage(bytes)
      if (envelope.type === "pong") return
      const message = envelope.message
      if (message.type === "server.status.notification") {
        this.#setSnapshot({ state: "connecting", status: message.payload })
        const ready = this.#pendingReady
        if (!ready) return
        this.#pendingReady = undefined
        clearTimeout(ready.timeout)
        ready.resolve()
        return
      }
      const responseRequestId = correlatedRequestId(message)
      if (!responseRequestId) return
      const pending = this.#pending.get(responseRequestId)
      if (!pending) return
      this.#pending.delete(responseRequestId)
      clearTimeout(pending.timeout)
      pending.resolve(message)
    } catch {
      this.#setSnapshot({ error: "Server sent an invalid message", state: "disconnected" })
      this.#socket?.close(1002, "Invalid server message")
    }
  }

  #handleClose(socket: WebSocket): void {
    if (this.#socket !== socket) return
    this.#socket = undefined
    this.#rejectPending(new Error("Server connection closed"))
    this.#setSnapshot({ state: "disconnected" })
    if (!this.#shouldReconnect) return

    const delay = Math.min(30_000, 500 * 2 ** this.#attempt) + Math.random() * 250
    this.#attempt += 1
    this.#reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  #rejectPending(error: Error): void {
    if (this.#pendingReady) {
      clearTimeout(this.#pendingReady.timeout)
      this.#pendingReady.reject(error)
      this.#pendingReady = undefined
    }
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #setSnapshot(next: ServerClientSnapshot): void {
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }
}
