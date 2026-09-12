import {
  type ClientMessage,
  CYPHERIA_PROTOCOL_VERSION,
  parseClientMessageText,
  type ServerErrorCode,
  stringifyProtocolMessage,
} from "@cypheria/protocol"
import { ZodError } from "zod"

import type { ClientSession, SessionTransport } from "./client-session.js"

type SessionHello = Extract<ClientMessage, { type: "session.hello" }>

export type ClientConnectionOptions = {
  attach: (hello: SessionHello, transport: SessionTransport) => ClientSession
  helloTimeoutMs: number
  transport: SessionTransport
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown server error"

const correlatedRequestId = (message: object): string | undefined =>
  "requestId" in message && typeof message.requestId === "string" ? message.requestId : undefined

export class ClientConnection {
  #closed = false
  #helloTimer: NodeJS.Timeout
  #options: ClientConnectionOptions
  #session: ClientSession | undefined

  constructor(options: ClientConnectionOptions) {
    this.#options = options
    this.#helloTimer = setTimeout(() => {
      this.#sendError("NOT_READY", "session.hello was not received in time")
      this.close(1008, "Session hello timeout")
    }, options.helloTimeoutMs)
    this.#helloTimer.unref()
  }

  async receive(raw: string): Promise<void> {
    if (this.#closed) return
    let message: ClientMessage
    try {
      message = parseClientMessageText(raw)
    } catch (error) {
      const detail = error instanceof ZodError ? error.issues[0]?.message : errorMessage(error)
      this.#sendError("INVALID_MESSAGE", detail || "Invalid message")
      return
    }
    if (!this.#session) {
      this.#acceptHello(message)
      return
    }
    if (message.type === "session.hello") {
      this.#sendError("INVALID_MESSAGE", "session.hello may only be sent once", message.requestId)
      return
    }
    await this.#session.receive(message)
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

  #acceptHello(message: ClientMessage): void {
    if (message.type !== "session.hello") {
      this.#sendError(
        "NOT_READY",
        "The first message must be session.hello",
        correlatedRequestId(message)
      )
      this.close(1008, "Session hello required")
      return
    }
    if (message.payload.protocolVersion !== CYPHERIA_PROTOCOL_VERSION) {
      this.#sendError(
        "PROTOCOL_MISMATCH",
        `Expected protocol version ${CYPHERIA_PROTOCOL_VERSION}`,
        message.requestId
      )
      this.close(1002, "Protocol version mismatch")
      return
    }
    clearTimeout(this.#helloTimer)
    this.#session = this.#options.attach(message, this.#options.transport)
  }

  #sendError(code: ServerErrorCode, message: string, requestId?: string): void {
    this.#options.transport.send(
      stringifyProtocolMessage({ payload: { code, message }, requestId, type: "server.error" })
    )
  }
}
