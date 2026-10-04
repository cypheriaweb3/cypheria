// Adapted from Paseo (Apache-2.0), https://github.com/getpaseo/paseo,
// packages/server/src/server/browser-tools/broker.ts.
import { randomUUID } from "node:crypto"

import {
  BROWSER_AUTOMATION_READ_ONLY_COMMANDS,
  type BrowserAutomationCommand,
  type BrowserAutomationCommandInput,
  type BrowserAutomationCommandName,
  BrowserAutomationCommandSchema,
  type BrowserAutomationErrorCode,
  type BrowserAutomationOutcome,
  BrowserAutomationOutcomeSchema,
  type BrowserAutomationRequest,
  type BrowserTabInfo,
} from "@cypheria/protocol"

/**
 * One window registered as a browser host. Each registration gets its own `id`, so windows that
 * share a client keep separate tabs and Apps; `clientId` names the device they belong to. Nothing
 * here is persisted: after a restart or reconnect, hosts register again and the broker relearns
 * which host has a tab from the next listing.
 */
export type BrowserHostClient = {
  readonly hostKind: string
  readonly id: string
  readonly clientId: string
  readonly name: string
  readonly supportedCommands: readonly BrowserAutomationCommandName[]
  send(request: BrowserAutomationRequest): void
}

/** A registered window as the rest of the Server sees it. */
export type BrowserHostEntry = Omit<BrowserHostClient, "send">

export type BrowserToolsExecuteInput = {
  readonly automationId?: string
  readonly command: BrowserAutomationCommandInput
  readonly cwd?: string
  /** The window to run on. */
  readonly hostId?: string
  /** The device to run on: its most recently registered window that supports the command. */
  readonly clientId?: string
  readonly threadId?: string
  readonly timeoutMs?: number
}

type RegisteredHost = {
  readonly client: BrowserHostClient
  readonly registeredAt: number
  readonly supportedCommands: ReadonlySet<BrowserAutomationCommandName>
}

type PendingRequest = {
  readonly hostId: string
  readonly command: BrowserAutomationCommandName
  readonly rememberAffinity: boolean
  readonly resolve: (outcome: BrowserAutomationOutcome) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

/** One host's answer to a command sent to every host that supports it. */
export type BrowserHostAnswer = {
  readonly host: BrowserHostEntry
  readonly outcome: BrowserAutomationOutcome
}

/**
 * Whether a command that got no answer may simply run again. A mutation may already have run,
 * so the caller must look at the page before deciding; only reads are safe to repeat.
 */
const safeToRepeat = (command: BrowserAutomationCommandName) =>
  BROWSER_AUTOMATION_READ_ONLY_COMMANDS.has(command)

const unanswered = (command: BrowserAutomationCommandName, reason: string) =>
  safeToRepeat(command)
    ? reason
    : `${reason} The command may have run; check the current state before trying again.`

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

/** The tab a command addresses; tab listing, new tabs, and MCP App commands address none. */
const browserIdOf = (command: BrowserAutomationCommand): string | null =>
  "browserId" in command.args ? command.args.browserId : null

const entryOf = ({ client: { send: _send, ...entry } }: RegisteredHost): BrowserHostEntry => entry

/**
 * Routes browser commands to connected windows. It remembers which window has each tab so later
 * tab commands reach it, and it never executes browser work itself.
 */
export class BrowserToolsBroker {
  readonly #clients = new Map<string, RegisteredHost>()
  readonly #createAutomationId: () => string
  readonly #defaultTimeoutMs: number
  readonly #hostByBrowserId = new Map<string, string>()
  readonly #pending = new Map<string, PendingRequest>()
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

  /** The registered windows, oldest registration first. */
  hosts(): BrowserHostEntry[] {
    return [...this.#clients.values()].map(entryOf)
  }

  /** The window that has a tab, as last reported by that window. */
  hostOfTab(browserId: string): BrowserHostEntry | undefined {
    const id = this.#hostByBrowserId.get(browserId)
    const host = id ? this.#clients.get(id) : undefined
    return host ? entryOf(host) : undefined
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

  unregisterClient(hostId: string, registeredAt?: number): void {
    const current = this.#clients.get(hostId)
    if (!current || (registeredAt !== undefined && current.registeredAt !== registeredAt)) return
    this.#clients.delete(hostId)
    // The window's tabs are found again by listing once it, or a reload of it, registers.
    for (const [browserId, owner] of this.#hostByBrowserId) {
      if (owner === hostId) this.#hostByBrowserId.delete(browserId)
    }
    for (const [automationId, pending] of this.#pending) {
      if (pending.hostId !== hostId) continue
      this.#pending.delete(automationId)
      clearTimeout(pending.timeout)
      pending.resolve(
        browserToolsFailure({
          automationId,
          code: "browser_no_host",
          message: unanswered(pending.command, "The window disconnected before responding."),
          retryable: safeToRepeat(pending.command),
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

    let host = this.#selectHost(request.command, automationId, input)
    // A tab no registered window has claimed yet, such as after a reconnect, is found by asking
    // every window for its tabs, as Paseo does; the command itself has not been sent.
    if (!host.ok && host.relearn) {
      await this.#listTabs(
        { automationId: `${automationId}:relearn`, command: { args: {}, command: "list_tabs" } },
        timeoutMs
      )
      host = this.#selectHost(request.command, automationId, input)
    }
    if (!host.ok) return host.outcome
    const unsupported = this.#unsupported(host.value, request.command.command, automationId)
    if (unsupported) return unsupported
    return this.#send({ host: host.value, request, timeoutMs })
  }

  /** Sends a read-only command to every window that supports it and returns each answer. */
  async broadcast(
    input: Omit<BrowserToolsExecuteInput, "hostId" | "clientId">
  ): Promise<BrowserHostAnswer[]> {
    const automationId = input.automationId ?? this.#createAutomationId()
    const parsed = BrowserAutomationCommandSchema.safeParse(input.command)
    if (!parsed.success || !safeToRepeat(parsed.data.command)) return []
    const command = parsed.data
    const hosts = [...this.#clients.values()].filter((host) =>
      host.supportedCommands.has(command.command)
    )
    return Promise.all(
      hosts.map(async (host) => ({
        host: entryOf(host),
        outcome: await this.#send({
          host,
          rememberAffinity: false,
          request: {
            automationId: `${automationId}:${host.client.id}`,
            command,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
          timeoutMs: input.timeoutMs ?? this.#defaultTimeoutMs,
        }),
      }))
    )
  }

  /** Accepts a window's answer. Returns false for unknown ids or answers from another window. */
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
    if (pending.rememberAffinity) this.#rememberHost(hostId, parsed.data)
    pending.resolve(parsed.data)
    return true
  }

  async #listTabs(
    request: BrowserAutomationRequest,
    timeoutMs: number
  ): Promise<BrowserAutomationOutcome> {
    const hosts = [...this.#clients.values()].filter((host) =>
      host.supportedCommands.has("list_tabs")
    )
    if (hosts.length === 0) return this.#noHost(request.automationId)
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
    // One unreachable window must not hide the others' tabs; fail only when every window failed.
    const failed = answers.find(({ outcome }) => !outcome.ok)
    if (failed && answers.every(({ outcome }) => !outcome.ok)) {
      return { ...failed.outcome, automationId: request.automationId }
    }
    // Windows share the device's tab index, so a restored tab no window has started is listed
    // by each of them; the earliest registered window keeps it.
    const tabs: BrowserTabInfo[] = []
    const seen = new Set<string>()
    for (const { host, outcome } of answers) {
      if (!outcome.ok || outcome.result.command !== "list_tabs") continue
      for (const tab of outcome.result.tabs) {
        if (seen.has(tab.browserId)) continue
        seen.add(tab.browserId)
        tabs.push(tab)
        this.#hostByBrowserId.set(tab.browserId, host.client.id)
      }
    }
    return { automationId: request.automationId, ok: true, result: { command: "list_tabs", tabs } }
  }

  #selectHost(
    command: BrowserAutomationCommand,
    automationId: string,
    target: { readonly hostId?: string; readonly clientId?: string }
  ):
    | { ok: true; value: RegisteredHost }
    | { ok: false; outcome: BrowserAutomationOutcome; relearn?: boolean } {
    if (target.hostId) {
      const host = this.#clients.get(target.hostId)
      return host
        ? { ok: true, value: host }
        : { ok: false, outcome: this.#gone(automationId, "That window is no longer connected.") }
    }
    if (target.clientId) {
      const host = [...this.#clients.values()]
        .filter(
          (candidate) =>
            candidate.client.clientId === target.clientId &&
            candidate.supportedCommands.has(command.command)
        )
        .at(-1)
      return host
        ? { ok: true, value: host }
        : {
            ok: false,
            outcome: this.#gone(automationId, `Device ${target.clientId} has no window for this.`),
          }
    }
    const browserId = browserIdOf(command)
    if (!browserId) {
      // Which device a new resource belongs on is the caller's decision. Among the windows of
      // one device, the most recently registered one wins, as in Paseo.
      if (this.#clients.size === 0) return { ok: false, outcome: this.#noHost(automationId) }
      const hosts = [...this.#clients.values()]
      const newest = hosts
        .filter((candidate) => candidate.supportedCommands.has(command.command))
        .at(-1)
      if (
        newest &&
        hosts.every((candidate) => candidate.client.clientId === newest.client.clientId)
      ) {
        return { ok: true, value: newest }
      }
      return {
        ok: false,
        outcome: browserToolsFailure({
          automationId,
          code: "browser_no_host",
          message: "Several windows are connected; name the device to use.",
        }),
      }
    }
    const owner = this.#hostByBrowserId.get(browserId)
    const known = owner ? this.#clients.get(owner) : undefined
    if (known) return { ok: true, value: known }
    if (this.#clients.size === 0) return { ok: false, outcome: this.#noHost(automationId) }
    const only = this.#onlyHost()
    if (only) return { ok: true, value: only }
    return {
      ok: false,
      outcome: browserToolsFailure({
        automationId,
        code: "browser_tab_not_found",
        message: `Browser tab ${browserId} is not open in a connected window. List the tabs again and use one of the returned IDs.`,
      }),
      relearn: true,
    }
  }

  #onlyHost(): RegisteredHost | undefined {
    return this.#clients.size === 1 ? [...this.#clients.values()][0] : undefined
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

  #gone(automationId: string, message: string): BrowserAutomationOutcome {
    return browserToolsFailure({ automationId, code: "browser_no_host", message, retryable: true })
  }

  #rememberHost(hostId: string, outcome: BrowserAutomationOutcome): void {
    if (!outcome.ok) return
    const result = outcome.result
    if (!("browserId" in result)) return
    if (result.command === "close_tab") this.#hostByBrowserId.delete(result.browserId)
    else this.#hostByBrowserId.set(result.browserId, hostId)
  }

  #send(input: {
    host: RegisteredHost
    rememberAffinity?: boolean
    request: BrowserAutomationRequest
    timeoutMs: number
  }): Promise<BrowserAutomationOutcome> {
    const { host, request, timeoutMs } = input
    const automationId = request.automationId
    const command = request.command.command
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(automationId)) return
        resolve(
          browserToolsFailure({
            automationId,
            code: "browser_timeout",
            message: unanswered(command, `The command timed out after ${timeoutMs}ms.`),
            retryable: safeToRepeat(command),
          })
        )
      }, timeoutMs)
      this.#pending.set(automationId, {
        command,
        hostId: host.client.id,
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
