import type {
  ServerTransport,
  ServerTransportFactory,
  ServerTransportMessageHandler,
  WebSocketFactory,
  WebSocketLike,
} from "./server-client-transport-types.js"
import {
  addWebSocketListener,
  normalizeCloseEvent,
  normalizeMessageEvent,
} from "./server-client-transport-utils.js"

const OPEN = 1

const defaultWebSocketFactory: WebSocketFactory = (url, options) => {
  if (typeof globalThis.WebSocket === "undefined") {
    throw new Error(
      "No WebSocket implementation is available; provide transportFactory or webSocketFactory"
    )
  }
  return new globalThis.WebSocket(
    url,
    options?.protocols ? [...options.protocols] : undefined
  ) as unknown as WebSocketLike
}

export class WebSocketServerTransport implements ServerTransport {
  readonly #socket: WebSocketLike

  constructor(socket: WebSocketLike) {
    this.#socket = socket
    try {
      this.#socket.binaryType = "arraybuffer"
    } catch {
      // Some WebSocket-compatible implementations expose a read-only binaryType.
    }
  }

  send(data: string | Uint8Array | ArrayBuffer): void {
    if (this.#socket.readyState !== OPEN) throw new Error("Cypheria WebSocket is not open")
    this.#socket.send(data)
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason)
  }

  onOpen(handler: () => void): () => void {
    return addWebSocketListener(this.#socket, "open", handler)
  }

  onMessage(handler: ServerTransportMessageHandler): () => void {
    const listener = (...args: unknown[]) => {
      const message = normalizeMessageEvent(args[0], args[1])
      handler(message.data, message.isBinary)
    }
    return addWebSocketListener(this.#socket, "message", listener)
  }

  onClose(handler: (event?: unknown) => void): () => void {
    const listener = (...args: unknown[]) => handler(normalizeCloseEvent(args[0], args[1]))
    return addWebSocketListener(this.#socket, "close", listener)
  }

  onError(handler: (event?: unknown) => void): () => void {
    return addWebSocketListener(this.#socket, "error", handler)
  }
}

export const createWebSocketTransportFactory =
  (webSocketFactory: WebSocketFactory = defaultWebSocketFactory): ServerTransportFactory =>
  ({ headers, protocols, url }) =>
    new WebSocketServerTransport(webSocketFactory(url, { headers, protocols }))
