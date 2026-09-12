import type { ClientMessage, ServerMessage } from "@cypheria/protocol"

import { ClientConnection } from "./client-connection.js"
import { ClientSession, type SessionHost, type SessionTransport } from "./client-session.js"

type SessionHello = Extract<ClientMessage, { type: "session.hello" }>

export type ConnectionRegistryOptions = {
  helloTimeoutMs: number
  host: SessionHost
  reconnectGraceMs: number
}

export class ConnectionRegistry {
  readonly #options: ConnectionRegistryOptions
  readonly #retentionTimers = new Map<string, NodeJS.Timeout>()
  readonly #sessions = new Map<string, ClientSession>()

  #acceptedTotal = 0
  #rejectedTotal = 0
  #resumedTotal = 0

  constructor(options: ConnectionRegistryOptions) {
    this.#options = options
  }

  accept(transport: SessionTransport): ClientConnection {
    this.#acceptedTotal += 1
    return new ClientConnection({
      attach: (hello, acceptedTransport) => this.#attach(hello, acceptedTransport),
      helloTimeoutMs: this.#options.helloTimeoutMs,
      transport,
    })
  }

  reject(): void {
    this.#rejectedTotal += 1
  }

  broadcast(message: ServerMessage): void {
    for (const session of this.#sessions.values()) session.send(message)
  }

  closeAll(code = 1012, reason = "Server restarting"): void {
    for (const timer of this.#retentionTimers.values()) clearTimeout(timer)
    this.#retentionTimers.clear()
    for (const session of this.#sessions.values()) session.close(code, reason)
    this.#sessions.clear()
  }

  get size(): number {
    let active = 0
    for (const session of this.#sessions.values()) if (session.attached) active += 1
    return active
  }

  get retained(): number {
    return this.#sessions.size - this.size
  }

  diagnostics() {
    return {
      acceptedTotal: this.#acceptedTotal,
      active: this.size,
      rejectedTotal: this.#rejectedTotal,
      resumedTotal: this.#resumedTotal,
      retained: this.retained,
    }
  }

  #attach(hello: SessionHello, transport: SessionTransport): ClientSession {
    const requestedId = hello.payload.resumeSessionId
    const retained = requestedId ? this.#sessions.get(requestedId) : undefined
    const canResume = retained?.client.id === hello.payload.client.id
    const session = canResume
      ? retained
      : new ClientSession({
          client: hello.payload.client,
          host: this.#options.host,
          onClose: (closed) => this.#remove(closed.id),
          onDetach: (detached) => this.#retain(detached),
          reconnectGraceMs: this.#options.reconnectGraceMs,
        })

    if (!canResume) this.#sessions.set(session.id, session)
    else this.#resumedTotal += 1
    const timer = this.#retentionTimers.get(session.id)
    if (timer) clearTimeout(timer)
    this.#retentionTimers.delete(session.id)
    session.attach(transport, hello.requestId, canResume)
    return session
  }

  #retain(session: ClientSession): void {
    const existing = this.#retentionTimers.get(session.id)
    if (existing) clearTimeout(existing)
    if (session.reconnectGraceMs === 0) {
      session.close(1000, "Reconnect grace period disabled")
      return
    }
    const timer = setTimeout(() => {
      this.#retentionTimers.delete(session.id)
      session.close(1000, "Reconnect grace period expired")
    }, session.reconnectGraceMs)
    timer.unref()
    this.#retentionTimers.set(session.id, timer)
  }

  #remove(id: string): void {
    const timer = this.#retentionTimers.get(id)
    if (timer) clearTimeout(timer)
    this.#retentionTimers.delete(id)
    this.#sessions.delete(id)
  }
}
