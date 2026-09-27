import {
  type BrowserAutomationCommandName,
  type BrowserAutomationOutcomeInput,
  type BrowserAutomationRequest,
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

export type BrowserHostRegistration = {
  readonly hostKind: string
  readonly supportedCommands: readonly BrowserAutomationCommandName[]
  /** Executes one command. Thrown errors are reported to the Server as `browser_unknown_error`. */
  readonly onCommand: (request: BrowserAutomationRequest) => Promise<BrowserAutomationOutcomeInput>
  readonly onRegistrationError?: (error: Error) => void
}

export interface BrowserActions {
  /**
   * Makes this connection a browser host. Registration is repeated after every reconnect until
   * the returned release function runs. Only one registration per connection is meaningful.
   */
  registerHost(registration: BrowserHostRegistration): () => Promise<void>
  sendResult(outcome: BrowserAutomationOutcomeInput, options?: RequestOptions): Promise<void>
}

const failure = (automationId: string, error: unknown): BrowserAutomationOutcomeInput => ({
  automationId,
  error: {
    code: "browser_unknown_error",
    message: error instanceof Error && error.message ? error.message : "Browser command failed.",
  },
  ok: false,
})

export const createBrowserActions = (client: ServerClient): BrowserActions => {
  const sendResult = async (
    outcome: BrowserAutomationOutcomeInput,
    options?: RequestOptions
  ): Promise<void> => {
    unwrap(await client.requestBrowser("browser.automation.result.request", outcome, options))
  }

  return {
    registerHost: (registration) => {
      let released = false
      let connected = false
      const reportError = (error: unknown) => {
        registration.onRegistrationError?.(
          error instanceof Error ? error : new Error(String(error))
        )
      }
      const register = () => {
        if (released || !client.supports(SERVER_CAPABILITIES.browser)) return
        void client
          .requestBrowser("browser.host.register.request", {
            hostKind: registration.hostKind,
            supportedCommands: [...registration.supportedCommands],
          })
          .then(unwrap)
          .catch(reportError)
      }
      const stopCommands = client.on("browser.automation.command.notification", (message) => {
        if (released) return
        const request = message.payload
        void registration
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
      return async () => {
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
      }
    },
    sendResult,
  }
}
