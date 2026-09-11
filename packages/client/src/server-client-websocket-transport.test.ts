import { describe, expect, it } from "vitest"

import type {
  ServerTransportFrame,
  WebSocketLike,
  WebSocketListener,
} from "./server-client-transport-types.js"
import { WebSocketServerTransport } from "./server-client-websocket-transport.js"

class EmitterWebSocket implements WebSocketLike {
  readonly listeners = new Map<string, Set<WebSocketListener>>()
  readonly sent: ServerTransportFrame[] = []
  binaryType = ""
  readyState = 1

  on(type: string, listener: WebSocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  off(type: string, listener: WebSocketListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: ServerTransportFrame): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  emit(type: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(...args)
  }
}

describe("WebSocketServerTransport", () => {
  it("supports Node event-emitter WebSockets and their isBinary argument", () => {
    const socket = new EmitterWebSocket()
    const transport = new WebSocketServerTransport(socket)
    const frames: { data: unknown; isBinary: boolean }[] = []
    const unsubscribe = transport.onMessage((data, isBinary) => frames.push({ data, isBinary }))

    const textBuffer = new TextEncoder().encode("hello")
    socket.emit("message", textBuffer, false)
    socket.emit("message", new Uint8Array([1]), true)

    expect(frames).toEqual([
      { data: textBuffer, isBinary: false },
      { data: new Uint8Array([1]), isBinary: true },
    ])
    unsubscribe()
    socket.emit("message", "ignored", false)
    expect(frames).toHaveLength(2)
  })

  it("normalizes Node close code and Buffer reason", () => {
    const socket = new EmitterWebSocket()
    const transport = new WebSocketServerTransport(socket)
    const closes: unknown[] = []
    transport.onClose((event) => closes.push(event))

    socket.emit("close", 1006, new TextEncoder().encode("network lost"))

    expect(closes).toEqual([{ code: 1006, reason: "network lost" }])
  })

  it("refuses to write before the underlying socket is open", () => {
    const socket = new EmitterWebSocket()
    socket.readyState = 0
    const transport = new WebSocketServerTransport(socket)

    expect(() => transport.send("hello")).toThrow("not open")
    expect(socket.sent).toHaveLength(0)
  })
})
