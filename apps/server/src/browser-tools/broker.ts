// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/server/src/server/browser-tools/broker.ts.
import { randomUUID } from "node:crypto"

import {
  type BrowserAutomationCommand,
  type BrowserAutomationCommandInput,
  type BrowserAutomationCommandName,
  BrowserAutomationCommandSchema,
  type BrowserAutomationErrorCode,
  type BrowserAutomationOutcome,
  BrowserAutomationOutcomeSchema,
  type BrowserAutomationRequest,
} from "@cypheria/protocol"

/** A client session registered as a browser host, usually one Desktop window process. */
export type BrowserHostClient = {
  readonly hostKind: string
  readonly id: string
  readonly supportedCommands: readonly BrowserAutomationCommandName[]
  send(request: BrowserAutomationRequest): void
}

export type BrowserToolsExecuteInput = {
  readonly automationId?: string
  readonly command: BrowserAutomationCommandInput
  readonly cwd?: string
  readonly threadId?: string
  readonly timeoutMs?: number
}

type RegisteredHost = {
  readonly client: BrowserHostClient
  readonly registeredAt: number
  readonly supportedCommands: ReadonlySet<BrowserAutomationCommandName>
}

type PendingRequest = {
  readonly clientId: string
  readonly rememberAffinity: boolean
  readonly resolve: (outcome: BrowserAutomationOutcome) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export const DEFAULT_BROWSER_TOOLS_TIMEOUT_MS = 15_000

export const browserToolsFailure = (input: {
  automationId: string
  code: BrowserAutomationErrorCode
  message: string
  retryable?: boolean
}): BrowserAutomationOutcome => ({
  automationId: input.automationId,
  error: { code: input.code, message: input.message, retryable: input.retryable ?? false },
  ok: false,
})

const browserIdOf = (command: BrowserAutomationCommand): string | null =>
  command.command === "list_tabs" || command.command === "new_tab" ? null : command.args.browserId

/**
 * Routes browser commands to connected hosts. It remembers which host owns each tab so later
 * tab commands reach the same Desktop window, and it never executes browser work itself.
 */
export class BrowserToolsBroker {
  readonly #clients = new Map<string, RegisteredHost>()
  readonly #createAutomationId: () => string
  readonly #defaultTimeoutMs: number
  readonly #hostByBrowserId = new Map<string, string>()
  readonly #pending = new Map<string, PendingRequest>()
  readonly #strandedHostByBrowserId = new Map<string, string>()
  #registrationSequence = 0

  constructor(
    options: { readonly createAutomationId?: () => string; readonly defaultTimeoutMs?: number } = {}
  ) {
    this.#createAutomationId = options.createAutomationId ?? (() => `browser-${randomUUID()}`)
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BROWSER_TOOLS_TIMEOUT_MS
  }

  get hostCount(): number {
    return this.#clients.size
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  registerClient(client: BrowserHostClient): () => void {
    this.unregisterClient(client.id)
    const registeredAt = ++this.#registrationSequence
    this.#clients.set(client.id, {
      client,
      registeredAt,
      supportedCommands: new Set(client.supportedCommands),
    })
    return () => this.unregisterClient(client.id, registeredAt)
  }

  unregisterClient(clientId: string, registeredAt?: number): void {
    const current = this.#clients.get(clientId)
    if (!current || (registeredAt !== undefined && current.registeredAt !== registeredAt)) return
    this.#clients.delete(clientId)
    for (const [browserId, owner] of this.#hostByBrowserId) {
      if (owner !== clientId) continue
      this.#hostByBrowserId.delete(browserId)
      this.#strandedHostByBrowserId.set(browserId, clientId)
    }
    for (const [automationId, pending] of this.#pending) {
      if (pending.clientId !== clientId) continue
      this.#pending.delete(automationId)
      clearTimeout(pending.timeout)
      pending.resolve(
        browserToolsFailure({
          automationId,
          code: "browser_no_host",
          message: "The browser host disconnected before responding.",
          retryable: true,
        })
      )
    }
  }

  async execute(input: BrowserToolsExecuteInput): Promise<BrowserAutomationOutcome> {
    const automationId = input.automationId ?? this.#createAutomationId()
    const parsed = BrowserAutomationCommandSchema.safeParse(input.command)
    if (!parsed.success) {
      return browserToolsFailure({
        automationId,
        code: "browser_unknown_error",
        message: `Browser command is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}.`,
      })
    }
    const request: BrowserAutomationRequest = {
      automationId,
      command: parsed.data,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }
    const timeoutMs = input.timeoutMs ?? this.#defaultTimeoutMs
    if (request.command.command === "list_tabs") return this.#listTabs(request, timeoutMs)

    const host = this.#selectHost(request.command, automationId)
    if (!host.ok) return host.outcome
    const unsupported = this.#unsupported(host.value, request.command.command, automationId)
    if (unsupported) return unsupported
    return this.#send({ host: host.value, request, timeoutMs })
  }

  /** Accepts a host's answer. Returns false for unknown ids or answers from another host. */
  receiveOutcome(clientId: string, value: unknown): boolean {
    const parsed = BrowserAutomationOutcomeSchema.safeParse(value)
    const automationId =
      typeof value === "object" && value !== null && "automationId" in value
        ? String((value as { automationId: unknown }).automationId)
        : undefined
    if (!automationId) return false
    const pending = this.#pending.get(automationId)
    if (!pending || pending.clientId !== clientId) return false
    this.#pending.delete(automationId)
    clearTimeout(pending.timeout)
    if (!parsed.success) {
      pending.resolve(
        browserToolsFailure({
          automationId,
          code: "browser_unknown_error",
          message: `Browser host response is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}.`,
        })
      )
      return true
    }
    if (pending.rememberAffinity) this.#rememberHost(clientId, parsed.data)
    pending.resolve(parsed.data)
    return true
  }

  async #listTabs(
    request: BrowserAutomationRequest,
    timeoutMs: number
  ): Promise<BrowserAutomationOutcome> {
    const hosts = [...this.#clients.values()]
    if (hosts.length === 0) return this.#noHost(request.automationId)
    for (const host of hosts) {
      const unsupported = this.#unsupported(host, "list_tabs", request.automationId)
      if (unsupported) return unsupported
    }
    const answers = await Promise.all(
      hosts.map(async (host) => ({
        host,
        outcome: await this.#send({
          host,
          rememberAffinity: false,
          request:
            hosts.length === 1
              ? request
              : { ...request, automationId: `${request.automationId}:${host.client.id}` },
          timeoutMs,
        }),
      }))
    )
    const failed = answers.find(({ outcome }) => !outcome.ok)
    if (failed) return { ...failed.outcome, automationId: request.automationId }
    for (const { host, outcome } of answers) this.#rememberHost(host.client.id, outcome)
    return {
      automationId: request.automationId,
      ok: true,
      result: {
        command: "list_tabs",
        tabs: answers.flatMap(({ outcome }) =>
          outcome.ok && outcome.result.command === "list_tabs" ? outcome.result.tabs : []
        ),
      },
    }
  }

  #selectHost(
    command: BrowserAutomationCommand,
    automationId: string
  ): { ok: true; value: RegisteredHost } | { ok: false; outcome: BrowserAutomationOutcome } {
    const browserId = browserIdOf(command)
    if (!browserId) {
      const host = this.#mostRecentHost()
      return host ? { ok: true, value: host } : { ok: false, outcome: this.#noHost(automationId) }
    }
    const owner = this.#hostByBrowserId.get(browserId)
    if (owner) {
      const host = this.#clients.get(owner)
      return host
        ? { ok: true, value: host }
        : { ok: false, outcome: this.#stranded(automationId, browserId) }
    }
    const stranded = this.#strandedHostByBrowserId.get(browserId)
    if (stranded) {
      const host = this.#clients.get(stranded)
      if (!host) return { ok: false, outcome: this.#stranded(automationId, browserId) }
      this.#strandedHostByBrowserId.delete(browserId)
      this.#hostByBrowserId.set(browserId, stranded)
      return { ok: true, value: host }
    }
    if (this.#clients.size === 0) return { ok: false, outcome: this.#noHost(automationId) }
    if (this.#clients.size === 1) {
      const host = this.#mostRecentHost()
      if (host) return { ok: true, value: host }
    }
    return {
      ok: false,
      outcome: browserToolsFailure({
        automationId,
        code: "browser_tab_not_found",
        message: `Browser tab ${browserId} is not associated with a connected browser host. Call browser_list_tabs and use one of the returned browserId values.`,
      }),
    }
  }

  #mostRecentHost(): RegisteredHost | undefined {
    return [...this.#clients.values()].at(-1)
  }

  #unsupported(
    host: RegisteredHost,
    name: BrowserAutomationCommandName,
    automationId: string
  ): BrowserAutomationOutcome | null {
    if (host.supportedCommands.has(name)) return null
    return browserToolsFailure({
      automationId,
      code: "browser_unsupported",
      message: `Browser command "${name}" is not supported by the ${host.client.hostKind}.`,
    })
  }

  #noHost(automationId: string): BrowserAutomationOutcome {
    return browserToolsFailure({
      automationId,
      code: "browser_no_host",
      message: "No browser host is connected. Open Cypheria Desktop to use browser tools.",
      retryable: true,
    })
  }

  #stranded(automationId: string, browserId: string): BrowserAutomationOutcome {
    return browserToolsFailure({
      automationId,
      code: "browser_no_host",
      message: `The app hosting browser tab ${browserId} disconnected.`,
      retryable: true,
    })
  }

  #rememberHost(clientId: string, outcome: BrowserAutomationOutcome): void {
    if (!outcome.ok) return
    const result = outcome.result
    if (result.command === "list_tabs") {
      for (const tab of result.tabs) {
        this.#hostByBrowserId.set(tab.browserId, clientId)
        this.#strandedHostByBrowserId.delete(tab.browserId)
      }
      return
    }
    this.#strandedHostByBrowserId.delete(result.browserId)
    if (result.command === "close_tab") this.#hostByBrowserId.delete(result.browserId)
    else this.#hostByBrowserId.set(result.browserId, clientId)
  }

  #send(input: {
    host: RegisteredHost
    rememberAffinity?: boolean
    request: BrowserAutomationRequest
    timeoutMs: number
  }): Promise<BrowserAutomationOutcome> {
    const { host, request, timeoutMs } = input
    const automationId = request.automationId
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(automationId)) return
        resolve(
          browserToolsFailure({
            automationId,
            code: "browser_timeout",
            message: `Browser command timed out after ${timeoutMs}ms.`,
            retryable: true,
          })
        )
      }, timeoutMs)
      this.#pending.set(automationId, {
        clientId: host.client.id,
        rememberAffinity: input.rememberAffinity ?? true,
        resolve,
        timeout,
      })
      try {
        host.client.send(request)
      } catch (error) {
        if (!this.#pending.delete(automationId)) return
        clearTimeout(timeout)
        resolve(
          browserToolsFailure({
            automationId,
            code: "browser_unknown_error",
            message: `Browser command could not be sent: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
      }
    })
  }
}
