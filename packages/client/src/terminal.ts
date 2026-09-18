import type {
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSession,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

type Payload<T extends TerminalClientMessage["type"]> = Extract<
  TerminalClientMessage,
  { type: T }
>["payload"]
const unwrap = <T>(message: TerminalServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export interface TerminalActions {
  close(terminalId: string, options?: RequestOptions): Promise<void>
  closeAll(options?: RequestOptions): Promise<void>
  open(
    input?: Partial<Payload<"terminal.open.request">>,
    options?: RequestOptions
  ): Promise<TerminalSession>
  resize(terminalId: string, cols: number, rows: number, options?: RequestOptions): Promise<void>
  write(terminalId: string, data: string, options?: RequestOptions): Promise<void>
}

export const createTerminalActions = (client: ServerClient): TerminalActions => {
  const request = async <T>(
    type: TerminalClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestTerminal(type, payload, options))
  return {
    close: async (terminalId, options) => {
      await request("terminal.close.request", { terminalId }, options)
    },
    closeAll: async (options) => {
      await request("terminal.close-all.request", {}, options)
    },
    open: (input = {}, options) => request("terminal.open.request", input, options),
    resize: async (terminalId, cols, rows, options) => {
      await request("terminal.resize.request", { cols, rows, terminalId }, options)
    },
    write: async (terminalId, data, options) => {
      await request("terminal.write.request", { data, terminalId }, options)
    },
  }
}
