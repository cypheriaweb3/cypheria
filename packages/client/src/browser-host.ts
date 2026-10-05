import {
  type BrowserAutomationOutcomeInput,
  type BrowserAutomationRequest,
  type BrowserHostRegistrationInput,
  type BrowserServerMessage,
  SERVER_CAPABILITIES,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

const unwrap = <T>(message: BrowserServerMessage): T => {
  const payload = (message as { payload: unknown }).payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export type BrowserHostOptions = {
  /** What the window offers, read before each registration so it reflects the window now. */
  readonly registration: () => BrowserHostRegistrationInput | Promise<BrowserHostRegistrationInput>
  /** Executes one request. Thrown errors are reported to the Server as `browser_error`. */
  readonly onCommand: (request: BrowserAutomationRequest) => Promise<BrowserAutomationOutcomeInput>
  readonly onRegistrationError?: (error: Error) => void
}

export type BrowserHostHandle = {
  /** Registers again, for example after the window's name or backends changed. */
  readonly refresh: () => void
  readonly release: () => Promise<void>
}

export interface BrowserHostActions {
  /**
   * Offers this window as a browser host for its built-in browser tabs and the MCP Apps it
   * shows. Each connection registers its own host, so windows that share a client ID keep
   * separate tabs and Apps. Registration repeats after every reconnect and `refresh`.
   */
  register(options: BrowserHostOptions): BrowserHostHandle
  sendResult(outcome: BrowserAutomationOutcomeInput, options?: RequestOptions): Promise<void>
}

const failure = (automationId: string, error: unknown): BrowserAutomationOutcomeInput => ({
  automationId,
  error: {
    code: "browser_error",
    message: error instanceof Error && error.message ? error.message : "Browser command failed.",
  },
  ok: false,
})

export const createBrowserHostActions = (client: ServerClient): BrowserHostActions => {
  const sendResult = async (
    outcome: BrowserAutomationOutcomeInput,
    options?: RequestOptions
  ): Promise<void> => {
    unwrap(await client.requestBrowser("browser.automation.result.request", outcome, options))
  }

  return {
    register: (options) => {
      let released = false
      let connected = false
      const reportError = (error: unknown) => {
        options.onRegistrationError?.(error instanceof Error ? error : new Error(String(error)))
      }
      const register = () => {
        if (released || !client.supports(SERVER_CAPABILITIES.browser)) return
        void Promise.resolve()
          .then(options.registration)
          .then((payload) =>
            released ? undefined : client.requestBrowser("browser.host.register.request", payload)
          )
          .then((message) => (message ? unwrap(message) : undefined))
          .catch(reportError)
      }
      const stopCommands = client.on("browser.automation.command.notification", (message) => {
        if (released) return
        const request = message.payload
        void options
          .onCommand(request)
          .catch((error: unknown) => failure(request.automationId, error))
          .then((outcome) => sendResult(outcome))
          .catch(reportError)
      })
      const stopStatus = client.subscribeConnectionStatus((state) => {
        const nowConnected = state.status === "connected"
        if (nowConnected && !connected) register()
        connected = nowConnected
      })
      return {
        refresh: () => {
          if (connected) register()
        },
        release: async () => {
          if (released) return
          released = true
          stopCommands()
          stopStatus()
          if (client.getConnectionState().status !== "connected") return
          try {
            unwrap(await client.requestBrowser("browser.host.unregister.request", {}))
          } catch {
            // The Server also drops the host when this connection closes.
          }
        },
      }
    },
    sendResult,
  }
}
