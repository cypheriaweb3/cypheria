import {
  CYPHERIA_PROTOCOL_VERSION,
  parseWSInboundMessageText,
  stringifyProtocolMessage,
  type WSHelloMessage,
  type WSInboundMessage,
} from "@cypheria/protocol"

import type { ClientSession, SessionTransport } from "./client-session.js"

export type ClientConnectionOptions = {
  attach: (hello: WSHelloMessage, transport: SessionTransport) => ClientSession
  helloTimeoutMs: number
  transport: SessionTransport
}

export class ClientConnection {
  #closed = false
  #helloTimer: NodeJS.Timeout
  #options: ClientConnectionOptions
  #session: ClientSession | undefined

  constructor(options: ClientConnectionOptions) {
    this.#options = options
    this.#helloTimer = setTimeout(() => {
      this.close(1008, "Hello timeout")
    }, options.helloTimeoutMs)
    this.#helloTimer.unref()
  }

  async receive(raw: string): Promise<void> {
    if (this.#closed) return
    let message: WSInboundMessage
    try {
      message = parseWSInboundMessageText(raw)
    } catch {
      if (!this.#session) {
        this.close(1008, "Invalid hello")
        return
      }
      this.close(1008, "Invalid message")
      return
    }

    if (message.type === "ping") {
      this.#options.transport.send(stringifyProtocolMessage({ type: "pong" }))
      return
    }
    if (!this.#session) {
      this.#acceptHello(message)
      return
    }
    if (message.type === "hello") {
      this.close(1008, "Unexpected hello")
      return
    }
    await this.#session.receive(message.message, this.#options.transport)
  }

  close(code = 1000, reason = "Connection closed"): void {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#helloTimer)
    this.#session?.transportClosed(this.#options.transport)
    this.#options.transport.close(code, reason)
  }

  transportClosed(): void {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#helloTimer)
    this.#session?.transportClosed(this.#options.transport)
  }

  #acceptHello(message: WSInboundMessage): void {
    if (message.type !== "hello") {
      this.close(1008, "Hello required")
      return
    }
    if (message.protocolVersion !== CYPHERIA_PROTOCOL_VERSION) {
      this.close(1002, "Protocol version mismatch")
      return
    }
    clearTimeout(this.#helloTimer)
    this.#session = this.#options.attach(message, this.#options.transport)
  }
}
