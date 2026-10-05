import { randomUUID } from "node:crypto"

import { isRepeatableDeviceRequest, type ParsedCuaDeviceRequest } from "@cypheria/cua"
import { type CuaHostContext, CuaHostError } from "@cypheria/cua/host"
import {
  type ClientKind,
  type ComputerHostApproval,
  type ComputerHostApprovalDecision,
  type ComputerHostCapability,
  type ComputerHostClientMessage,
  ComputerHostOutcomeSchema,
  type ComputerHostServerMessage,
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
  readonly capabilities: readonly ComputerHostCapability[]
}

type Carrier = {
  readonly transport: object
  readonly sessionId: string
  readonly notify: (message: ComputerHostServerMessage) => void
}

type Host = {
  name: string
  capabilities: readonly ComputerHostCapability[]
  /** The connections that registered the host, newest last. */
  carriers: Carrier[]
}

type Pending = {
  readonly transport: object
  readonly threadId: string
  readonly repeatable: boolean
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout> | undefined
  /** Approvals the device is waiting on; the deadline stops while a person decides. */
  approvals: number
}

/** Asks the people in a Thread whether Computer Use may operate an app. */
export type ComputerHostApprover = (
  threadId: string,
  approval: ComputerHostApproval
) => Promise<ComputerHostApprovalDecision>

/** Device requests drive external browsers or native apps, which can take far longer than a page read. */
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
  readonly #approve: ComputerHostApprover | undefined

  constructor(
    options: { readonly timeoutMs?: number; readonly approve?: ComputerHostApprover } = {}
  ) {
    this.#timeoutMs = options.timeoutMs ?? DEVICE_REQUEST_TIMEOUT_MS
    this.#approve = options.approve
  }

  hosts(): ComputerHostEntry[] {
    return [...this.#hosts].map(([id, host]) => ({
      id,
      name: host.name,
      capabilities: [...host.capabilities],
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
          capabilities: [],
          name: message.payload.name,
        }
        host.name = message.payload.name
        host.capabilities = message.payload.capabilities
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
      case "computer.host.approval.request":
        // A person may take minutes to answer; other messages of the connection keep flowing.
        void this.#approval(message.payload, session.transport).then((payload) =>
          reply({ payload, requestId: message.requestId, type: "computer.host.approval.response" })
        )
        return true
    }
  }

  /**
   * An approval the device asks for while it runs one of the Thread's commands, which keeps a
   * device from raising prompts in Threads that did not ask it for anything.
   */
  async #approval(approval: ComputerHostApproval, transport: object) {
    const pending = this.#pending.get(approval.commandId)
    if (!pending || pending.transport !== transport || pending.threadId !== approval.threadId) {
      return error("COMPUTER_HOST_UNKNOWN_COMMAND", "No such command is running on this device.")
    }
    if (!this.#approve) {
      return error("COMPUTER_HOST_UNSUPPORTED", "This Server cannot ask for approvals.")
    }
    pending.approvals++
    clearTimeout(pending.timeout)
    pending.timeout = undefined
    try {
      return ok({ decision: await this.#approve(approval.threadId, approval) })
    } catch (cause) {
      return error(
        "COMPUTER_HOST_APPROVAL_FAILED",
        cause instanceof Error ? cause.message : String(cause)
      )
    } finally {
      pending.approvals--
      if (pending.approvals === 0 && this.#pending.get(approval.commandId) === pending) {
        this.#arm(approval.commandId, pending)
      }
    }
  }

  #arm(commandId: string, pending: Pending): void {
    pending.timeout = setTimeout(() => {
      if (!this.#pending.delete(commandId)) return
      pending.reject(
        unanswered(pending.repeatable, `The device did not answer within ${this.#timeoutMs}ms.`)
      )
    }, this.#timeoutMs)
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
      const pending: Pending = {
        approvals: 0,
        reject,
        repeatable,
        resolve,
        threadId: context.threadId,
        timeout: undefined,
        transport: carrier.transport,
      }
      this.#pending.set(commandId, pending)
      this.#arm(commandId, pending)
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
        clearTimeout(pending.timeout)
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
