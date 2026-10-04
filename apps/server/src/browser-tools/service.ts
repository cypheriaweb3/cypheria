import { randomUUID } from "node:crypto"

import type { AuditLogService } from "@cypheria/db"
import {
  BROWSER_AUTOMATION_READ_ONLY_COMMANDS,
  type BrowserAutomationOutcome,
  type BrowserAutomationRequest,
  type BrowserClientMessage,
  type BrowserServerMessage,
  type ClientKind,
} from "@cypheria/protocol"
import { BrowserToolsBroker, type BrowserToolsExecuteInput, browserToolsFailure } from "./broker.js"

export type TabTurnDisposition = "temporary" | "deliverable" | "handoff"

export type BrowserHostSession = {
  readonly id: string
  readonly kind: ClientKind
  notify(message: BrowserServerMessage): void
}

export type BrowserToolsServiceOptions = {
  readonly audit?: Pick<AuditLogService, "append">
  readonly broker?: BrowserToolsBroker
  /** Read on every command so a settings change applies without a restart. */
  readonly enabled: () => boolean
}

type Reply = (message: BrowserServerMessage) => void

const ok = <T>(value: T) => ({ ok: true as const, value })
const error = (code: string, message: string) => ({
  error: { code, message },
  ok: false as const,
})

/**
 * Server boundary for the Desktop browser host: host registration, the enable switch, tab turn
 * dispositions, and audit. `cua_repl` reaches built-in browser tabs and MCP Apps through it.
 */
export class BrowserToolsService {
  readonly broker: BrowserToolsBroker
  readonly #audit: Pick<AuditLogService, "append"> | undefined
  readonly #enabled: () => boolean
  readonly #releases = new Map<string, () => void>()
  readonly #tabsByThread = new Map<string, Map<string, TabTurnDisposition>>()

  constructor(options: BrowserToolsServiceOptions) {
    this.broker = options.broker ?? new BrowserToolsBroker()
    this.#audit = options.audit
    this.#enabled = options.enabled
  }

  trackTab(
    threadId: string,
    browserId: string,
    disposition: TabTurnDisposition = "temporary"
  ): void {
    let tabs = this.#tabsByThread.get(threadId)
    if (!tabs) {
      tabs = new Map()
      this.#tabsByThread.set(threadId, tabs)
    }
    tabs.set(browserId, disposition)
  }

  setTabDisposition(threadId: string, browserId: string, disposition: TabTurnDisposition): void {
    this.#tabsByThread.get(threadId)?.set(browserId, disposition)
  }

  forgetTab(threadId: string, browserId: string): void {
    this.#tabsByThread.get(threadId)?.delete(browserId)
  }

  getTabDisposition(threadId: string, browserId: string): TabTurnDisposition | undefined {
    return this.#tabsByThread.get(threadId)?.get(browserId)
  }

  async cleanupTurnTabs(threadId: string): Promise<void> {
    const tabs = this.#tabsByThread.get(threadId)
    if (!tabs || tabs.size === 0) return
    const toClose: string[] = []
    for (const [browserId, disposition] of tabs.entries()) {
      if (disposition === "temporary") {
        toClose.push(browserId)
      }
    }
    for (const browserId of toClose) {
      tabs.delete(browserId)
      try {
        await this.execute({
          threadId,
          command: { command: "close_tab", args: { browserId } },
        })
      } catch {
        // Ignore failures on auto-close
      }
    }
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
        this.#releases.get(session.id)?.()
        this.#releases.set(
          session.id,
          this.broker.registerClient({
            hostKind: message.payload.hostKind,
            id: session.id,
            send: (request: BrowserAutomationRequest) =>
              session.notify({ payload: request, type: "browser.automation.command.notification" }),
            supportedCommands: message.payload.supportedCommands,
          })
        )
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "browser.host.register.response",
        })
        return true
      }
      case "browser.host.unregister.request":
        this.sessionClosed(session.id)
        reply({
          payload: ok({ succeeded: true as const }),
          requestId: message.requestId,
          type: "browser.host.unregister.response",
        })
        return true
      case "browser.automation.result.request":
        reply({
          payload: ok({ accepted: this.broker.receiveOutcome(session.id, message.payload) }),
          requestId: message.requestId,
          type: "browser.automation.result.response",
        })
        return true
    }
  }

  sessionClosed(sessionId: string): void {
    const release = this.#releases.get(sessionId)
    this.#releases.delete(sessionId)
    release?.()
  }

  async execute(input: BrowserToolsExecuteInput): Promise<BrowserAutomationOutcome> {
    const automationId = input.automationId ?? `browser-${randomUUID()}`
    if (!this.#enabled()) {
      return browserToolsFailure({
        automationId,
        code: "browser_disabled",
        message:
          "The built-in browser and MCP Apps are turned off in Cypheria's Computer Use settings.",
      })
    }
    const name = (input.command as { command?: unknown }).command
    const audited =
      this.#audit !== undefined &&
      typeof name === "string" &&
      !BROWSER_AUTOMATION_READ_ONLY_COMMANDS.has(name as never)
    const audit = (outcome: "started" | "succeeded" | "failed") =>
      this.#audit?.append({
        actor: input.threadId ? `thread:${input.threadId}` : "agent",
        correlationId: automationId,
        eventType: `browser.${String(name)}.${outcome}`,
        source: "browser",
      })
    if (audited) {
      try {
        await audit("started")
      } catch {
        return browserToolsFailure({
          automationId,
          code: "browser_denied",
          message: "Browser audit is unavailable; the command was not started.",
        })
      }
    }
    const outcome = await this.broker.execute({ ...input, automationId })
    if (audited) await audit(outcome.ok ? "succeeded" : "failed")?.catch(() => undefined)

    if (outcome.ok && input.threadId) {
      const res = outcome.result
      if (res.command === "new_tab") {
        this.trackTab(input.threadId, res.browserId, "temporary")
      } else if (res.command === "mark_deliverable") {
        this.setTabDisposition(input.threadId, res.browserId, "deliverable")
      } else if (res.command === "mark_handoff" || res.command === "request_manual_handoff") {
        this.setTabDisposition(input.threadId, res.browserId, "handoff")
      } else if (res.command === "close_tab") {
        this.forgetTab(input.threadId, res.browserId)
      }
    }

    return outcome
  }
}
