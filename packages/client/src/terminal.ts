import {
  decodeTerminalBinaryFrame,
  encodeTerminalInputFrame,
  encodeTerminalResizeFrame,
  TERMINAL_MAX_STREAM_DATA_BYTES,
  type TerminalClientMessage,
  type TerminalInfo,
  type TerminalRestoreMode,
  type TerminalServerMessage,
  type TerminalSize,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"
import type { ServerClient } from "./server-client.js"

const unwrap = <T>(message: TerminalServerMessage): T => {
  const payload = message.payload as
    | { ok: true; value: T }
    | { error: { code: string; message: string }; ok: false }
  if (payload.ok) return payload.value
  const error = new Error(payload.error.message)
  error.name = payload.error.code
  throw error
}

export type TerminalCaptureRange = { readonly start?: number; readonly end?: number }
export type TerminalObserveCallbacks = {
  readonly onExit?: (event: {
    exitCode: number | null
    reason: "exit" | "closed" | "worker"
    signal: number | null
  }) => void
  readonly onOutput: (data: Uint8Array) => void
  readonly onRestore?: (event: { data: Uint8Array; start: boolean; end: boolean }) => void
}
export type TerminalObserveOptions = {
  readonly restore?: TerminalRestoreMode
}
export interface TerminalStream {
  readonly terminalId: string
  dispose(): Promise<void>
  resize(size: TerminalSize, options?: { claim?: boolean }): Promise<void>
  write(data: string | Uint8Array): Promise<void>
}

export interface TerminalActions {
  capture(
    terminalId: string,
    range?: TerminalCaptureRange,
    options?: RequestOptions
  ): Promise<string>
  close(terminalId: string, options?: RequestOptions): Promise<void>
  create(
    input: { threadId: string; name?: string; size?: TerminalSize },
    options?: RequestOptions
  ): Promise<TerminalInfo>
  list(threadId: string, options?: RequestOptions): Promise<TerminalInfo[]>
  observe(
    terminalId: string,
    callbacks: TerminalObserveCallbacks,
    options?: TerminalObserveOptions & { request?: RequestOptions }
  ): Promise<TerminalStream>
  rename(terminalId: string, name: string, options?: RequestOptions): Promise<TerminalInfo>
  watchThread(
    threadId: string,
    handler: (terminals: readonly TerminalInfo[]) => void,
    options?: RequestOptions
  ): Promise<() => void>
}

export const createTerminalActions = (client: ServerClient): TerminalActions => {
  const request = async <T>(
    type: TerminalClientMessage["type"],
    payload: unknown,
    options?: RequestOptions
  ): Promise<T> => unwrap<T>(await client.requestTerminal(type, payload, options))

  const subscribeDirectory = async (
    threadId: string,
    options?: RequestOptions
  ): Promise<{ subscriptionId: string; terminals: TerminalInfo[] }> =>
    request("terminal.directory.subscribe.request", { threadId }, options)

  return {
    capture: async (terminalId, range = {}, options) =>
      (
        await request<{ text: string }>(
          "terminal.capture.request",
          { ...range, terminalId },
          options
        )
      ).text,
    close: async (terminalId, options) => {
      await request("terminal.close.request", { terminalId }, options)
    },
    create: (input, options) =>
      request(
        "terminal.create.request",
        {
          ...input,
          size: input.size ?? { cols: 100, rows: 28 },
        },
        options
      ),
    list: async (threadId, options) =>
      (await request<{ terminals: TerminalInfo[] }>("terminal.list.request", { threadId }, options))
        .terminals,
    observe: async (terminalId, callbacks, options) => {
      let disposed = false
      let slot = -1
      let subscriptionId: string | undefined
      let disconnected = false
      let resubscribing: Promise<void> | undefined
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      const inputChunks = (data: string | Uint8Array): Uint8Array[] => {
        const value = typeof data === "string" ? data : decoder.decode(data)
        const chunks: Uint8Array[] = []
        let remaining = value
        while (remaining.length > 0) {
          const chunk = new Uint8Array(TERMINAL_MAX_STREAM_DATA_BYTES)
          const { read, written } = encoder.encodeInto(remaining, chunk)
          if (read === 0) throw new Error("Unable to encode terminal input")
          chunks.push(chunk.subarray(0, written))
          remaining = remaining.slice(read)
        }
        return chunks
      }

      const subscribe = async (): Promise<void> => {
        const value = await request<{ slot: number; subscriptionId: string }>(
          "terminal.stream.subscribe.request",
          { restore: options?.restore ?? "visible", terminalId },
          options?.request
        )
        if (disposed) {
          await request("terminal.stream.unsubscribe.request", {
            subscriptionId: value.subscriptionId,
          }).catch(() => undefined)
          return
        }
        slot = value.slot
        subscriptionId = value.subscriptionId
      }

      const unsubscribeBinary = client.subscribeBinaryFrames((frame) => {
        const decoded = decodeTerminalBinaryFrame(frame)
        if (!decoded || decoded.slot !== slot) return
        if (decoded.type === "output") callbacks.onOutput(decoded.data)
        else if (decoded.type === "restore") callbacks.onRestore?.(decoded)
      })
      const unsubscribeExit = client.on("terminal.exited.notification", (message) => {
        if (message.payload.terminalId !== terminalId) return
        callbacks.onExit?.(message.payload)
      })
      const unsubscribeConnection = client.subscribeConnectionStatus((state) => {
        if (state.status === "disconnected") disconnected = true
        if (state.status !== "connected" || !disconnected || disposed || resubscribing) return
        disconnected = false
        resubscribing = subscribe()
          .catch(() => undefined)
          .finally(() => {
            resubscribing = undefined
          })
      })
      try {
        await subscribe()
      } catch (error) {
        disposed = true
        unsubscribeBinary()
        unsubscribeExit()
        unsubscribeConnection()
        throw error
      }

      return {
        dispose: async () => {
          if (disposed) return
          disposed = true
          unsubscribeBinary()
          unsubscribeExit()
          unsubscribeConnection()
          const current = subscriptionId
          subscriptionId = undefined
          slot = -1
          if (current) {
            await request("terminal.stream.unsubscribe.request", {
              subscriptionId: current,
            }).catch(() => undefined)
          }
        },
        resize: async (size, resizeOptions) => {
          if (disposed || slot < 0) throw new Error("Terminal stream is not connected")
          await client.sendBinaryFrame(
            encodeTerminalResizeFrame(slot, size, resizeOptions?.claim ?? false)
          )
        },
        terminalId,
        write: async (data) => {
          if (disposed || slot < 0) throw new Error("Terminal stream is not connected")
          for (const chunk of inputChunks(data)) {
            await client.sendBinaryFrame(encodeTerminalInputFrame(slot, chunk))
          }
        },
      }
    },
    rename: (terminalId, name, options) =>
      request("terminal.rename.request", { name, terminalId }, options),
    watchThread: async (threadId, handler, options) => {
      let disposed = false
      let subscriptionId: string | undefined
      let disconnected = false
      let resubscribing: Promise<void> | undefined
      const subscribe = async (): Promise<void> => {
        const value = await subscribeDirectory(threadId, options)
        if (disposed) {
          await request("terminal.directory.unsubscribe.request", {
            subscriptionId: value.subscriptionId,
          }).catch(() => undefined)
          return
        }
        subscriptionId = value.subscriptionId
        handler(value.terminals)
      }
      const unsubscribeMessages = client.on(
        "terminal.directory.changed.notification",
        (message) => {
          if (message.payload.subscriptionId !== subscriptionId) return
          handler(message.payload.terminals)
        }
      )
      const unsubscribeConnection = client.subscribeConnectionStatus((state) => {
        if (state.status === "disconnected") disconnected = true
        if (state.status !== "connected" || !disconnected || disposed || resubscribing) return
        disconnected = false
        resubscribing = subscribe()
          .catch(() => undefined)
          .finally(() => {
            resubscribing = undefined
          })
      })
      try {
        await subscribe()
      } catch (error) {
        disposed = true
        unsubscribeMessages()
        unsubscribeConnection()
        throw error
      }
      return () => {
        if (disposed) return
        disposed = true
        unsubscribeMessages()
        unsubscribeConnection()
        const current = subscriptionId
        subscriptionId = undefined
        if (current) {
          void request("terminal.directory.unsubscribe.request", {
            subscriptionId: current,
          }).catch(() => undefined)
        }
      }
    },
  }
}
