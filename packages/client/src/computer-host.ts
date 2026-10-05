import {
  type ComputerHostApproval,
  type ComputerHostApprovalDecision,
  type ComputerHostOutcomeInput,
  type ComputerHostRegistrationInput,
  type ComputerHostRequest,
  type ComputerHostServerMessage,
  SERVER_CAPABILITIES,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

const unwrap = <T>(message: ComputerHostServerMessage): T => {
  const payload = (message as { payload: unknown }).payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export type ComputerHostOptions = {
  /** What the device offers, read before each registration so it reflects the device now. */
  readonly registration: () =>
    | ComputerHostRegistrationInput
    | Promise<ComputerHostRegistrationInput>
  /** Runs one request on the device and returns its value; a thrown error becomes a failure. */
  readonly onCommand: (request: ComputerHostRequest) => Promise<unknown>
  readonly onRegistrationError?: (error: Error) => void
}

export type ComputerHostHandle = {
  /** Registers again, for example after the device gained or lost a surface. */
  readonly refresh: () => void
  readonly release: () => Promise<void>
}

export interface ComputerHostActions {
  /**
   * Offers this client's device as a Computer Use host for its external browsers and native
   * apps. The Server keys the host by client ID, so each window of a client may register it and
   * any of them may carry a command. Registration repeats after every reconnect and `refresh`.
   */
  register(options: ComputerHostOptions): ComputerHostHandle
  sendResult(outcome: ComputerHostOutcomeInput, options?: RequestOptions): Promise<void>
  /**
   * Asks the people in a Thread whether Computer Use may operate an app, while the device runs
   * one of that Thread's commands. Resolves when one of the Thread's clients answers.
   */
  requestApproval(
    approval: ComputerHostApproval,
    options?: RequestOptions
  ): Promise<ComputerHostApprovalDecision>
}

/** How long a person may take to answer an approval. */
const APPROVAL_TIMEOUT_MS = 30 * 60_000

const errorCode = (error: unknown) =>
  error instanceof Error && /^[a-z_]{1,64}$/u.test(error.name) ? error.name : "device_error"

export const createComputerHostActions = (client: ServerClient): ComputerHostActions => {
  const sendResult = async (
    outcome: ComputerHostOutcomeInput,
    options?: RequestOptions
  ): Promise<void> => {
    unwrap(await client.requestComputerHost("computer.host.result.request", outcome, options))
  }

  return {
    requestApproval: async (approval, options) =>
      unwrap<{ decision: ComputerHostApprovalDecision }>(
        await client.requestComputerHost("computer.host.approval.request", approval, {
          timeoutMs: APPROVAL_TIMEOUT_MS,
          ...options,
        })
      ).decision,
    register: (options) => {
      let released = false
      let connected = false
      const reportError = (error: unknown) => {
        options.onRegistrationError?.(error instanceof Error ? error : new Error(String(error)))
      }
      const register = () => {
        if (released || !client.supports(SERVER_CAPABILITIES.computerHost)) return
        void Promise.resolve()
          .then(options.registration)
          .then((payload) =>
            released
              ? undefined
              : client.requestComputerHost("computer.host.register.request", payload)
          )
          .then((message) => (message ? unwrap(message) : undefined))
          .catch(reportError)
      }
      const stopCommands = client.on("computer.host.command.notification", (message) => {
        if (released) return
        const request = message.payload
        void options
          .onCommand(request)
          .then(
            (value): ComputerHostOutcomeInput => ({
              commandId: request.commandId,
              ok: true,
              value,
            }),
            (error: unknown): ComputerHostOutcomeInput => ({
              commandId: request.commandId,
              error: {
                code: errorCode(error),
                message:
                  error instanceof Error && error.message
                    ? error.message
                    : "Device request failed.",
              },
              ok: false,
            })
          )
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
            unwrap(await client.requestComputerHost("computer.host.unregister.request", {}))
          } catch {
            // The Server also drops this window as a carrier when its connection closes.
          }
        },
      }
    },
    sendResult,
  }
}
