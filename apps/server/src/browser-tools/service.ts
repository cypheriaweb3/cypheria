import { randomUUID } from "node:crypto"

import type { BrowserClientMessage, BrowserServerMessage, ClientKind } from "@cypheria/protocol"
import { BrowserToolsBroker } from "./broker.js"

/** One window's connection: its session, its client, and the transport it speaks over. */
export type BrowserHostSession = {
  readonly id: string
  /** The client the window belongs to; every window of a Desktop shares it. */
  readonly clientId: string
  readonly kind: ClientKind
  /** The window's own transport, which identifies its registration. */
  readonly transport: object
  /** Sends to this window only. */
  notify(message: BrowserServerMessage): void
}

type Reply = (message: BrowserServerMessage) => void

const ok = <T>(value: T) => ({ ok: true as const, value })
const error = (code: string, message: string) => ({
  error: { code, message },
  ok: false as const,
})

/**
 * Server boundary for browser hosts, one per window: registration and answers. `cua_repl`
 * reaches built-in browser tabs and MCP Apps through its broker.
 */
export class BrowserToolsService {
  readonly broker: BrowserToolsBroker
  /** Each window's registration, by its transport. */
  readonly #registrations = new Map<
    object,
    { readonly sessionId: string; readonly hostId: string; readonly release: () => void }
  >()

  constructor(options: { readonly broker?: BrowserToolsBroker } = {}) {
    this.broker = options.broker ?? new BrowserToolsBroker()
  }

  async handle(
    message: BrowserClientMessage,
    session: BrowserHostSession,
    reply: Reply
  ): Promise<boolean> {
    switch (message.type) {
      case "browser.host.register.request": {
        if (session.kind !== "desktop") {
          reply({
            payload: error("BROWSER_HOST_UNSUPPORTED", "Only Cypheria Desktop can host browsers."),
            requestId: message.requestId,
            type: "browser.host.register.response",
          })
          return true
        }
        this.transportClosed(session.transport)
        const hostId = randomUUID()
        this.#registrations.set(session.transport, {
          hostId,
          release: this.broker.registerClient({
            backends: message.payload.backends,
            clientId: session.clientId,
            id: hostId,
            name: message.payload.name ?? "Cypheria Desktop",
            send: (request) =>
              session.notify({ payload: request, type: "browser.automation.command.notification" }),
          }),
          sessionId: session.id,
        })
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "browser.host.register.response",
        })
        return true
      }
      case "browser.host.unregister.request":
        this.transportClosed(session.transport)
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "browser.host.unregister.response",
        })
        return true
      case "browser.automation.result.request": {
        const hostId = this.#registrations.get(session.transport)?.hostId
        reply({
          payload: ok({
            accepted: hostId ? this.broker.receiveOutcome(hostId, message.payload) : false,
          }),
          requestId: message.requestId,
          type: "browser.automation.result.response",
        })
        return true
      }
    }
  }

  /** Drops the registration of a window whose connection closed. */
  transportClosed(transport: object): void {
    const registration = this.#registrations.get(transport)
    this.#registrations.delete(transport)
    registration?.release()
  }

  /** Drops every window of a session that ended. */
  sessionClosed(sessionId: string): void {
    for (const [transport, registration] of this.#registrations) {
      if (registration.sessionId === sessionId) this.transportClosed(transport)
    }
  }
}
