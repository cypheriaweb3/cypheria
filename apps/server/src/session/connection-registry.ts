import type { ServerMessage, WSHelloMessage } from "@cypheria/protocol"

import { ClientConnection } from "./client-connection.js"
import { ClientSession, type SessionHost, type SessionTransport } from "./client-session.js"

export type SessionAdmission = {
  principalId: string
}

export type ConnectionRegistryOptions = {
  helloTimeoutMs: number
  host: SessionHost
  reconnectGraceMs: number
}

export const OWNER_SESSION_ADMISSION: SessionAdmission = Object.freeze({ principalId: "owner" })
const sessionKey = (principalId: string, clientId: string): string =>
  JSON.stringify([principalId, clientId])

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

  accept(transport: SessionTransport, admission: SessionAdmission): ClientConnection {
    this.#acceptedTotal += 1
    return new ClientConnection({
      attach: (hello, acceptedTransport) => this.#attach(hello, acceptedTransport, admission),
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

  /** Number of active physical transports. */
  get size(): number {
    let active = 0
    for (const session of this.#sessions.values()) active += session.transportCount
    return active
  }

  get activeSessions(): number {
    let active = 0
    for (const session of this.#sessions.values()) if (session.attached) active += 1
    return active
  }

  get retained(): number {
    return this.#sessions.size - this.activeSessions
  }

  diagnostics() {
    return {
      acceptedTotal: this.#acceptedTotal,
      active: this.size,
      activeSessions: this.activeSessions,
      rejectedTotal: this.#rejectedTotal,
      resumedTotal: this.#resumedTotal,
      retained: this.retained,
    }
  }

  #attach(
    hello: WSHelloMessage,
    transport: SessionTransport,
    admission: SessionAdmission
  ): ClientSession {
    const key = sessionKey(admission.principalId, hello.clientId)
    const existing = this.#sessions.get(key)
    const session =
      existing ??
      new ClientSession({
        hello,
        host: this.#options.host,
        onClose: (closed) => this.#remove(key, closed),
        onDetach: (detached) => this.#retain(key, detached),
        principalId: admission.principalId,
        reconnectGraceMs: this.#options.reconnectGraceMs,
      })

    if (existing) this.#resumedTotal += 1
    else this.#sessions.set(key, session)
    const timer = this.#retentionTimers.get(key)
    if (timer) clearTimeout(timer)
    this.#retentionTimers.delete(key)
    session.attach(transport, hello)
    return session
  }

  #retain(key: string, session: ClientSession): void {
    const existing = this.#retentionTimers.get(key)
    if (existing) clearTimeout(existing)
    if (session.reconnectGraceMs === 0) {
      session.close(1000, "Reconnect grace period disabled")
      return
    }
    const timer = setTimeout(() => {
      if (this.#sessions.get(key) !== session || session.attached) return
      this.#retentionTimers.delete(key)
      session.close(1000, "Reconnect grace period expired")
    }, session.reconnectGraceMs)
    timer.unref()
    this.#retentionTimers.set(key, timer)
  }

  #remove(key: string, session: ClientSession): void {
    const timer = this.#retentionTimers.get(key)
    if (timer) clearTimeout(timer)
    this.#retentionTimers.delete(key)
    if (this.#sessions.get(key) === session) this.#sessions.delete(key)
  }
}
