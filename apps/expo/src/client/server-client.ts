import {
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  parseServerMessage,
  type ServerInfo,
  type ServerMessage,
} from "@cypheria/protocol"

import { resolveServerWebSocketUrl } from "./server-url"

export type ServerConnectionState = "connected" | "connecting" | "disconnected"

export type ServerClientSnapshot = {
  error?: string
  info?: ServerInfo
  state: ServerConnectionState
}

type PendingRequest = {
  reject(error: Error): void
  resolve(message: ServerMessage): void
  timeout: ReturnType<typeof setTimeout>
}

const requestId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export class CypheriaServerClient {
  #attempt = 0
  #clientId = `expo-${requestId()}`
  #listeners = new Set<() => void>()
  #pending = new Map<string, PendingRequest>()
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

  async request(type: "server.info" | "server.diagnostics" | "server.ping") {
    return this.#sendRequest({ requestId: requestId(), type })
  }

  async #initialize(socket: WebSocket): Promise<void> {
    try {
      const ready = await this.#sendRequest({
        payload: {
          capabilities: ["runtime.events"],
          client: { id: this.#clientId, kind: "expo", name: "Cypheria Expo" },
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        },
        requestId: requestId(),
        type: "session.hello",
      })
      if (ready.type !== "session.ready") throw new Error("Server did not accept the session")
      this.#attempt = 0
      this.#setSnapshot({ state: "connected" })
      const response = await this.request("server.info")
      if (response.type === "server.info.result") {
        this.#setSnapshot({ info: response.payload, state: "connected" })
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

  #sendRequest(message: { [key: string]: unknown; requestId: string }): Promise<ServerMessage> {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Server connection is not open"))
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(message.requestId)
        reject(new Error("Server request timed out"))
      }, 15_000)
      this.#pending.set(message.requestId, { reject, resolve, timeout })
      this.#socket?.send(JSON.stringify(message))
    })
  }

  #receive(data: unknown): void {
    if (typeof data !== "string") return
    try {
      const message = parseServerMessage(JSON.parse(data))
      if (message.type === "runtime.event") return
      if (!message.requestId) return
      const pending = this.#pending.get(message.requestId)
      if (!pending) return
      this.#pending.delete(message.requestId)
      clearTimeout(pending.timeout)
      if (message.type === "server.error") pending.reject(new Error(message.payload.message))
      else pending.resolve(message)
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
