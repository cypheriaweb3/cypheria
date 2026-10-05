// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/server/src/server/browser-tools/broker.ts.
import { randomUUID } from "node:crypto"

import {
  type BrowserAutomationOutcome,
  BrowserAutomationOutcomeSchema,
  type BrowserAutomationRequest,
  type BrowserHostBackend,
} from "@cypheria/protocol"

/**
 * One window registered as a browser host. Each registration gets its own `id`, so windows that
 * share a client keep separate tabs and Apps; `clientId` names the device they belong to. Nothing
 * here is persisted: after a restart or reconnect, hosts register again and the broker relearns
 * which host has a tab from the next listing.
 */
export type BrowserHostClient = {
  readonly id: string
  readonly clientId: string
  readonly name: string
  readonly backends: readonly BrowserHostBackend[]
  send(request: BrowserAutomationRequest): void
}

/** A registered window as the rest of the Server sees it. */
export type BrowserHostEntry = Omit<BrowserHostClient, "send"> & { readonly registeredAt: number }

type RegisteredHost = { readonly client: BrowserHostClient; readonly registeredAt: number }

type PendingRequest = {
  readonly hostId: string
  readonly repeatable: boolean
  readonly resolve: (outcome: BrowserAutomationOutcome) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export const DEFAULT_BROWSER_TOOLS_TIMEOUT_MS = 15_000

export const browserToolsFailure = (input: {
  automationId: string
  code: string
  message: string
  retryable?: boolean
}): BrowserAutomationOutcome => ({
  automationId: input.automationId,
  error: { code: input.code, message: input.message, retryable: input.retryable ?? false },
  ok: false,
})

const unanswered = (repeatable: boolean, reason: string) =>
  repeatable
    ? `${reason} This request is safe to retry.`
    : `${reason} The request may have run; check the current state before trying again.`

const entryOf = ({ client: { send: _send, ...client }, registeredAt }: RegisteredHost) => ({
  ...client,
  registeredAt,
})

/**
 * Sends browser requests to connected windows and matches their answers. It remembers which
 * window holds each tab so later requests for that tab reach it, and it never executes browser
 * work itself; which window a new resource belongs on is the caller's decision.
 */
export class BrowserToolsBroker {
  readonly #clients = new Map<string, RegisteredHost>()
  readonly #createAutomationId: () => string
  readonly #defaultTimeoutMs: number
  /** The window holding each tab, by `backend:tabId`. */
  readonly #hostByTab = new Map<string, string>()
  readonly #pending = new Map<string, PendingRequest>()
  #registrationSequence = 0

  constructor(
    options: { readonly createAutomationId?: () => string; readonly defaultTimeoutMs?: number } = {}
  ) {
    this.#createAutomationId = options.createAutomationId ?? (() => `browser-${randomUUID()}`)
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BROWSER_TOOLS_TIMEOUT_MS
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  /** The registered windows, oldest registration first. */
  hosts(): BrowserHostEntry[] {
    return [...this.#clients.values()].map(entryOf)
  }

  /** The window that holds a tab, as last learned from that window. */
  hostOfTab(backend: BrowserHostBackend, tabId: string): BrowserHostEntry | undefined {
    const id = this.#hostByTab.get(`${backend}:${tabId}`)
    const host = id ? this.#clients.get(id) : undefined
    return host ? entryOf(host) : undefined
  }

  rememberTab(backend: BrowserHostBackend, tabId: string, hostId: string): void {
    this.#hostByTab.set(`${backend}:${tabId}`, hostId)
  }

  forgetTab(backend: BrowserHostBackend, tabId: string): void {
    this.#hostByTab.delete(`${backend}:${tabId}`)
  }

  registerClient(client: BrowserHostClient): () => void {
    this.unregisterClient(client.id)
    const registeredAt = ++this.#registrationSequence
    this.#clients.set(client.id, { client, registeredAt })
    return () => this.unregisterClient(client.id, registeredAt)
  }

  unregisterClient(hostId: string, registeredAt?: number): void {
    const current = this.#clients.get(hostId)
    if (!current || (registeredAt !== undefined && current.registeredAt !== registeredAt)) return
    this.#clients.delete(hostId)
    // The window's tabs are found again by listing once it, or a reload of it, registers.
    for (const [key, owner] of this.#hostByTab) {
      if (owner === hostId) this.#hostByTab.delete(key)
    }
    for (const [automationId, pending] of this.#pending) {
      if (pending.hostId !== hostId) continue
      this.#pending.delete(automationId)
      clearTimeout(pending.timeout)
      pending.resolve(
        browserToolsFailure({
          automationId,
          code: "browser_no_host",
          message: unanswered(pending.repeatable, "The window disconnected before responding."),
          retryable: pending.repeatable,
        })
      )
    }
  }

  /**
   * Sends one request to one window and waits for its answer. `repeatable` says whether the
   * request may simply run again when it gets no answer.
   */
  send(input: {
    readonly hostId: string
    readonly backend: BrowserHostBackend
    readonly request: Record<string, unknown>
    readonly threadId: string
    readonly cwd?: string
    readonly repeatable: boolean
    readonly timeoutMs?: number
  }): Promise<BrowserAutomationOutcome> {
    const automationId = this.#createAutomationId()
    const host = this.#clients.get(input.hostId)
    if (!host) {
      return Promise.resolve(
        browserToolsFailure({
          automationId,
          code: "browser_no_host",
          message: "That window is no longer connected.",
          retryable: true,
        })
      )
    }
    const timeoutMs = input.timeoutMs ?? this.#defaultTimeoutMs
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(automationId)) return
        resolve(
          browserToolsFailure({
            automationId,
            code: "browser_timeout",
            message: unanswered(input.repeatable, `The request timed out after ${timeoutMs}ms.`),
            retryable: input.repeatable,
          })
        )
      }, timeoutMs)
      this.#pending.set(automationId, {
        hostId: host.client.id,
        repeatable: input.repeatable,
        resolve,
        timeout,
      })
      try {
        host.client.send({
          automationId,
          backend: input.backend,
          request: input.request,
          threadId: input.threadId,
          ...(input.cwd ? { cwd: input.cwd } : {}),
        })
      } catch (error) {
        if (!this.#pending.delete(automationId)) return
        clearTimeout(timeout)
        resolve(
          browserToolsFailure({
            automationId,
            code: "browser_error",
            message: `The request could not be sent: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
      }
    })
  }

  /** Accepts a window's answer. Returns false for unknown IDs or answers from another window. */
  receiveOutcome(hostId: string, value: unknown): boolean {
    const parsed = BrowserAutomationOutcomeSchema.safeParse(value)
    const automationId =
      typeof value === "object" && value !== null && "automationId" in value
        ? String((value as { automationId: unknown }).automationId)
        : undefined
    if (!automationId) return false
    const pending = this.#pending.get(automationId)
    if (!pending || pending.hostId !== hostId) return false
    this.#pending.delete(automationId)
    clearTimeout(pending.timeout)
    pending.resolve(
      parsed.success
        ? parsed.data
        : browserToolsFailure({
            automationId,
            code: "browser_error",
            message: `The window's answer is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}.`,
          })
    )
    return true
  }
}
