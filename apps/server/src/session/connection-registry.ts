import type { ServerMessage } from "@cypheria/protocol"

export type ManagedSession = {
  readonly id: string
  close(code?: number, reason?: string): void
  send(message: ServerMessage): void
}

export class ConnectionRegistry {
  #acceptedTotal = 0
  #rejectedTotal = 0
  #sessions = new Map<string, ManagedSession>()

  add(session: ManagedSession): void {
    this.#acceptedTotal += 1
    this.#sessions.set(session.id, session)
  }

  reject(): void {
    this.#rejectedTotal += 1
  }

  remove(id: string): void {
    this.#sessions.delete(id)
  }

  broadcast(message: ServerMessage): void {
    for (const session of this.#sessions.values()) session.send(message)
  }

  closeAll(code = 1012, reason = "Server restarting"): void {
    for (const session of this.#sessions.values()) session.close(code, reason)
    this.#sessions.clear()
  }

  get size(): number {
    return this.#sessions.size
  }

  diagnostics() {
    return {
      acceptedTotal: this.#acceptedTotal,
      active: this.#sessions.size,
      rejectedTotal: this.#rejectedTotal,
    }
  }
}
