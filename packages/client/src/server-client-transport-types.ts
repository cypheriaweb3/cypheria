export type ServerTransportFrame = string | Uint8Array | ArrayBuffer

export type ServerTransportMessageHandler = (data: unknown, isBinary: boolean) => void

/** Transport contract used by ServerClient. Implementations may wrap browser or Node sockets. */
export interface ServerTransport {
  close(code?: number, reason?: string): void
  onClose(handler: (event?: unknown) => void): () => void
  onError(handler: (event?: unknown) => void): () => void
  onMessage(handler: ServerTransportMessageHandler): () => void
  onOpen(handler: () => void): () => void
  send(data: ServerTransportFrame): void | Promise<void>
}

export type ServerTransportFactoryOptions = {
  readonly headers?: Readonly<Record<string, string>>
  readonly protocols?: readonly string[]
  readonly url: string
}

export type ServerTransportFactory = (options: ServerTransportFactoryOptions) => ServerTransport

export type WebSocketEventLike = {
  readonly code?: number
  readonly data?: unknown
  readonly error?: unknown
  readonly reason?: string
}

export type WebSocketListener = (...args: unknown[]) => void

/** Small structural subset shared by browser WebSocket and the Node ws package. */
export interface WebSocketLike {
  readonly readyState: number
  binaryType?: string
  addEventListener?(type: string, listener: WebSocketListener): void
  close(code?: number, reason?: string): void
  off?(type: string, listener: WebSocketListener): void
  on?(type: string, listener: WebSocketListener): void
  onclose?: WebSocketListener | null
  onerror?: WebSocketListener | null
  onmessage?: WebSocketListener | null
  onopen?: WebSocketListener | null
  removeEventListener?(type: string, listener: WebSocketListener): void
  removeListener?(type: string, listener: WebSocketListener): void
  send(data: ServerTransportFrame): void
}

export type WebSocketFactoryOptions = {
  readonly headers?: Readonly<Record<string, string>>
  readonly protocols?: readonly string[]
}

export type WebSocketFactory = (url: string, options?: WebSocketFactoryOptions) => WebSocketLike
