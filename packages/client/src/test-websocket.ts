import type {
  ServerTransportFrame,
  WebSocketEventLike,
  WebSocketFactory,
  WebSocketFactoryOptions,
  WebSocketLike,
  WebSocketListener,
} from "./server-client-transport-types.js"

export class TestWebSocket implements WebSocketLike {
  static instances: TestWebSocket[] = []

  readonly listeners = new Map<string, Set<WebSocketListener>>()
  readonly sent: string[] = []
  binaryType = ""
  closedWith: { code: number; reason: string } | undefined
  readyState = 0

  constructor(
    readonly url: string,
    readonly options?: WebSocketFactoryOptions
  ) {
    TestWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: WebSocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: WebSocketListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: ServerTransportFrame): void {
    if (this.readyState !== 1) throw new Error("socket is not open")
    this.sent.push(typeof data === "string" ? data : new TextDecoder().decode(data))
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return
    this.closedWith = { code, reason }
    this.readyState = 3
    this.emit("close", { code, reason })
  }

  open(): void {
    this.readyState = 1
    this.emit("open", {})
  }

  message(data: unknown): void {
    this.emit("message", { data })
  }

  error(error: unknown): void {
    this.emit("error", { error })
  }

  emit(type: string, event: WebSocketEventLike): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  static reset(): void {
    TestWebSocket.instances.length = 0
  }
}

export const testWebSocketFactory: WebSocketFactory = (url, options) =>
  new TestWebSocket(url, options)
