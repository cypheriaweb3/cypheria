import { randomUUID } from "node:crypto"

import { isRepeatableDeviceRequest, type ParsedCuaDeviceRequest } from "@cypheria/cua"
import { type CuaHostContext, CuaHostError } from "@cypheria/cua/host"
import {
  type ClientKind,
  type ComputerHostClientMessage,
  ComputerHostOutcomeSchema,
  type ComputerHostServerMessage,
  type ComputerHostSurface,
} from "@cypheria/protocol"

/** One connection of a client: the session, the client, and the transport it speaks over. */
export type ComputerHostSession = {
  readonly id: string
  readonly clientId: string
  readonly kind: ClientKind
  readonly transport: object
  /** Sends to this connection only. */
  notify(message: ComputerHostServerMessage): void
}

/** A device registered as a Computer Use host, as the rest of the Server sees it. */
export type ComputerHostEntry = {
  readonly id: string
  readonly name: string
  readonly surfaces: readonly ComputerHostSurface[]
}

type Carrier = {
  readonly transport: object
  readonly sessionId: string
  readonly notify: (message: ComputerHostServerMessage) => void
}

type Host = {
  name: string
  surfaces: readonly ComputerHostSurface[]
  /** The connections that registered the host, newest last. */
  carriers: Carrier[]
}

type Pending = {
  readonly transport: object
  readonly repeatable: boolean
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

/** Device requests run agent-browser or cua-driver, which can take far longer than a page read. */
export const DEVICE_REQUEST_TIMEOUT_MS = 120_000

const unanswered = (repeatable: boolean, reason: string) =>
  new CuaHostError(
    "unanswered",
    repeatable
      ? `${reason} This request is safe to retry.`
      : `${reason} The request may have run; check the current state before trying again.`
  )

const ok = <T>(value: T) => ({ ok: true as const, value })
const error = (code: string, message: string) => ({
  error: { code, message },
  ok: false as const,
})

/**
 * Computer Use hosts by device. A host is the client, not a window: every window of a Desktop
 * registers the same client ID, and a command goes to the newest window still connected, which
 * hands it to Electron main. Like browser hosts, hosts live only in memory and register again
 * after a restart or reconnect.
 */
export class ComputerHostService {
  readonly #hosts = new Map<string, Host>()
  readonly #pending = new Map<string, Pending>()
  readonly #timeoutMs: number

  constructor(options: { readonly timeoutMs?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEVICE_REQUEST_TIMEOUT_MS
  }

  hosts(): ComputerHostEntry[] {
    return [...this.#hosts].map(([id, host]) => ({
      id,
      name: host.name,
      surfaces: [...host.surfaces],
    }))
  }

  async handle(
    message: ComputerHostClientMessage,
    session: ComputerHostSession,
    reply: (message: ComputerHostServerMessage) => void
  ): Promise<boolean> {
    switch (message.type) {
      case "computer.host.register.request": {
        if (session.kind !== "desktop") {
          reply({
            payload: error(
              "COMPUTER_HOST_UNSUPPORTED",
              "Only Cypheria Desktop can host Computer Use."
            ),
            requestId: message.requestId,
            type: "computer.host.register.response",
          })
          return true
        }
        const host = this.#hosts.get(session.clientId) ?? {
          carriers: [],
          name: message.payload.name,
          surfaces: [],
        }
        host.name = message.payload.name
        host.surfaces = message.payload.surfaces
        host.carriers = [
          ...host.carriers.filter((carrier) => carrier.transport !== session.transport),
          { notify: session.notify, sessionId: session.id, transport: session.transport },
        ]
        this.#hosts.set(session.clientId, host)
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "computer.host.register.response",
        })
        return true
      }
      case "computer.host.unregister.request":
        this.transportClosed(session.transport)
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "computer.host.unregister.response",
        })
        return true
      case "computer.host.result.request":
        reply({
          payload: ok({ accepted: this.#receive(session.transport, message.payload) }),
          requestId: message.requestId,
          type: "computer.host.result.response",
        })
        return true
    }
  }

  /** Runs one request on a device and returns the device's value. */
  request(
    clientId: string,
    context: CuaHostContext,
    request: ParsedCuaDeviceRequest
  ): Promise<unknown> {
    const carrier = this.#hosts.get(clientId)?.carriers.at(-1)
    if (!carrier) {
      return Promise.reject(
        new CuaHostError("unknown_host", `Device ${clientId} is not connected.`)
      )
    }
    const commandId = `device-${randomUUID()}`
    const repeatable = isRepeatableDeviceRequest(request)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(commandId)) return
        reject(unanswered(repeatable, `The device did not answer within ${this.#timeoutMs}ms.`))
      }, this.#timeoutMs)
      this.#pending.set(commandId, {
        reject,
        repeatable,
        resolve,
        timeout,
        transport: carrier.transport,
      })
      try {
        carrier.notify({
          payload: {
            commandId,
            ...(context.cwd ? { cwd: context.cwd } : {}),
            request: request as Record<string, unknown>,
            threadId: context.threadId,
          },
          type: "computer.host.command.notification",
        })
      } catch (cause) {
        this.#pending.delete(commandId)
        clearTimeout(timeout)
        reject(
          new CuaHostError(
            "unanswered",
            `The request could not be sent: ${cause instanceof Error ? cause.message : String(cause)}`
          )
        )
      }
    })
  }

  /** A connection closed: it stops carrying its host, and requests it carried fail. */
  transportClosed(transport: object): void {
    for (const [clientId, host] of this.#hosts) {
      host.carriers = host.carriers.filter((carrier) => carrier.transport !== transport)
      if (host.carriers.length === 0) this.#hosts.delete(clientId)
    }
    for (const [commandId, pending] of this.#pending) {
      if (pending.transport !== transport) continue
      this.#pending.delete(commandId)
      clearTimeout(pending.timeout)
      pending.reject(unanswered(pending.repeatable, "The device disconnected before answering."))
    }
  }

  sessionClosed(sessionId: string): void {
    const transports = new Set(
      [...this.#hosts.values()].flatMap((host) =>
        host.carriers
          .filter((carrier) => carrier.sessionId === sessionId)
          .map((carrier) => carrier.transport)
      )
    )
    for (const transport of transports) this.transportClosed(transport)
  }

  #receive(transport: object, value: unknown): boolean {
    const parsed = ComputerHostOutcomeSchema.safeParse(value)
    if (!parsed.success) return false
    const pending = this.#pending.get(parsed.data.commandId)
    if (!pending || pending.transport !== transport) return false
    this.#pending.delete(parsed.data.commandId)
    clearTimeout(pending.timeout)
    if (parsed.data.ok) pending.resolve(parsed.data.value)
    else pending.reject(new CuaHostError(parsed.data.error.code, parsed.data.error.message))
    return true
  }
}
